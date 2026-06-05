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
const GEMINI_MODEL = "gemini-1.5-flash";

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

function parseBase64Image(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  // Fallback: assume raw base64 jpeg
  return { mimeType: "image/jpeg", data: dataUrl };
}

async function callGemini(base64Image: string, apiKey: string): Promise<string> {
  const { mimeType, data } = parseBase64Image(base64Image);

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
              {
                text: "You are an expert at writing accessible, descriptive alt text for images. Provide a concise, accurate description suitable for screen readers and SEO. Keep it under 150 words. Focus on what is visually important. Do not start with phrases like 'image of' or 'picture of' unless necessary. Write alt text for this image:",
              },
              {
                inlineData: {
                  mimeType,
                  data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.3,
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${text}`);
  }

  const result = await response.json() as any;
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  if (!text) {
    throw new Error("Gemini returned empty alt text");
  }
  return text;
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
      const body = await request.json() as { image?: string };
      if (!body.image || typeof body.image !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid 'image' field (base64 string required)" }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const altText = await callGemini(body.image, env.GEMINI_API_KEY);

      return new Response(
        JSON.stringify({ alt_text: altText, source: "gemini", remaining }),
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