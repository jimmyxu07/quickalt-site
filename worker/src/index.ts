export interface Env {
  GEMINI_API_KEY: string;
  RATE_LIMIT_KV: KVNamespace;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const DAILY_LIMIT = 100;
const GEMINI_MODEL = "gemini-3.5-flash";

const PROMPT = `You are an expert at writing accessible, descriptive alt text for images. Write 4-6 complete sentences covering the main subject, background, lighting, and mood. You MUST end with a complete sentence and a period. Never stop mid-sentence.`;

const PROMPT_RETRY = `Your previous description was too brief. Write a MUCH longer and more comprehensive description covering every visible detail. Write at least 5 complete sentences. Do not stop mid-sentence. End with a complete sentence and a period.`;

function truncateToLastSentence(text: string): string {
  const match = text.match(/^(.*?[.!?])(?:\s+[^.!?]*)?$/s);
  return match ? match[1].trim() : text;
}

const LANG_NAMES: Record<string, string> = {
  en: "English",
  zh: "Chinese",
  ja: "Japanese",
  es: "Spanish",
  fr: "French",
  de: "German",
  ko: "Korean",
  pt: "Portuguese",
  it: "Italian",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
};

function getPrompt(basePrompt: string, langCode: string): string {
  const langName = LANG_NAMES[langCode] || LANG_NAMES["en"];
  if (langName === "English") return basePrompt;
  return `${basePrompt}\n\nWrite the description in ${langName}.`;
}

function getClientIP(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

async function checkRateLimit(kv: KVNamespace, ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  await kv.put(key, String(count + 1), { expirationTtl: 86400 });
  return { allowed: true, remaining: DAILY_LIMIT - count - 1 };
}

function parseBase64Image(base64Image: string): { mimeType: string; data: string } {
  const match = base64Image.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: "image/jpeg", data: base64Image };
}

function countSentences(text: string): number {
  return (text.match(/[.!?]+/g) || []).length;
}

function isGoodQuality(text: string): boolean {
  return text.length >= 200 && countSentences(text) >= 3 && /[.!?"']$/.test(text.slice(-1));
}

async function callGemini(
  mimeType: string,
  data: string,
  apiKey: string,
  instruction: string
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: instruction },
              { inlineData: { mimeType, data } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1500,
          temperature: 0.3,
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${text}`);
  }

  const responseData = (await response.json()) as any;
  const content = responseData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  if (!content) {
    throw new Error("Gemini returned empty alt text");
  }
  return content;
}

async function generateAltText(base64Image: string, apiKey: string, langCode: string = "en"): Promise<{ text: string; incomplete?: boolean }> {
  const { mimeType, data } = parseBase64Image(base64Image);

  const prompts = [
    getPrompt(PROMPT, langCode),
    getPrompt(PROMPT_RETRY, langCode),
    getPrompt("Describe this image in extensive detail as if explaining it to someone who cannot see it. Include the subject, background, colors, lighting, and atmosphere. Write 5-7 complete sentences. End with a complete sentence and a period.", langCode),
    getPrompt("Provide a rich, vivid description of this image for accessibility purposes. Cover all visible elements, spatial relationships, and mood. Write at least 5 complete sentences. Finish with a period.", langCode),
    getPrompt("Create a comprehensive alt text for this image. Describe the scene, objects, people, colors, and emotional tone in detail. Use 5-6 complete sentences. End with a complete sentence and a period.", langCode),
  ];

  let bestResult = "";
  let lastError: Error | null = null;

  for (let i = 0; i < prompts.length; i++) {
    try {
      const result = await callGemini(mimeType, data, apiKey, prompts[i]);
      if (result.length > bestResult.length) bestResult = result;
      if (isGoodQuality(result)) {
        return { text: result };
      }
    } catch (err: any) {
      lastError = err;
      console.error(`Attempt ${i + 1} failed:`, err);
    }
  }

  if (!bestResult && lastError) {
    throw lastError;
  }

  // Fallback: truncate to last complete sentence
  const truncated = truncateToLastSentence(bestResult);
  if (truncated !== bestResult) {
    return { text: truncated };
  }

  // No complete sentence found
  return { text: bestResult, incomplete: true };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/generate") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const ip = getClientIP(request);
    const { allowed, remaining } = await checkRateLimit(env.RATE_LIMIT_KV, ip);

    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Daily limit exceeded. Try again tomorrow." }),
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    try {
      const body = (await request.json()) as { image?: string; language?: string };
      if (!body.image || typeof body.image !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid 'image' field (base64 string required)" }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const langCode = (body.language || "en").toLowerCase().trim();
      const { text: altText, incomplete } = await generateAltText(body.image, env.GEMINI_API_KEY, langCode);

      return new Response(
        JSON.stringify({ alt_text: altText, source: "gemini", language: langCode, remaining, ...(incomplete ? { incomplete: true } : {}) }),
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(remaining),
          },
        }
      );
    } catch (err: any) {
      console.error("Error generating alt text:", err);
      return new Response(
        JSON.stringify({ error: err.message || "Internal server error" }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }
  },
};
