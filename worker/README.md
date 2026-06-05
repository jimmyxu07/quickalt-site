# QuickAlt API Worker

Cloudflare Workers proxy for Kimi/MiniMax multimodal AI APIs.

## Setup

### 1. Install dependencies

```bash
cd /Users/leyantech/projects/quickalt-site/worker
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create KV namespace for rate limiting

```bash
npx wrangler kv:namespace create "RATE_LIMIT_KV"
```

Copy the returned `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "YOUR_KV_NAMESPACE_ID"
```

### 4. Set secret

```bash
npx wrangler secret put GEMINI_API_KEY
# Paste your Google Gemini API key
```

### 5. Deploy

```bash
npx wrangler deploy
```

Copy the deployed URL (e.g. `https://quickalt-api.your-account.workers.dev`) and update `API_BASE_URL` in `index.html`.

### 6. Update frontend

In `index.html`, replace:

```javascript
const API_BASE_URL = "";
```

with:

```javascript
const API_BASE_URL = "https://quickalt-api.your-account.workers.dev";
```

Then push the updated `index.html` to GitHub Pages.

## API

### POST /generate

Request:
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

Response:
```json
{
  "alt_text": "A close-up photograph of...",
  "source": "kimi",
  "remaining": 99
}
```

Error (429):
```json
{
  "error": "Daily limit exceeded. Try again tomorrow."
}
```

## Rate Limiting

- 100 requests per IP per day
- Tracked via Cloudflare KV
- `X-RateLimit-Remaining` header in every response

## Fallback Chain

1. Kimi K2.6 (primary)
2. MiniMax abab6.5s-chat (fallback)
