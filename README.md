# Operon Diff Worker

A Cloudflare Worker that stores and renders code diffs as beautiful web pages. Used by [Operon](https://github.com/nickqiaoo/operon) to share diff previews via links.

## Features

- Store unified diffs via API with Bearer token auth
- Server-side render diffs using [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs) with syntax highlighting
- HMAC-signed URLs with configurable TTL (default 1 hour)
- Dark/light mode support, Telegram WebApp compatible
- Zero database required - uses Cloudflare KV for storage

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- A [Cloudflare](https://dash.cloudflare.com/) account (free plan works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (included as dev dependency)

## Deploy

### 1. Clone and install

```bash
git clone https://github.com/Nickqiaoo/operon-diff-worker.git
cd operon-diff-worker
npm install
```

### 2. Create a KV namespace

```bash
npx wrangler kv namespace create DIFFS
```

This will output something like:

```
{ binding = "DIFFS", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

Copy the `id` value.

### 3. Configure

```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` and replace `<YOUR_KV_NAMESPACE_ID>` with your KV namespace ID.

### 4. Set API key secret

```bash
npx wrangler secret put API_KEY
```

Enter a strong random string when prompted. This key is used for both API authentication and HMAC URL signing.

### 5. Deploy

```bash
npm run deploy
```

Done. Your worker is now live at `https://operon-diff-worker.<your-subdomain>.workers.dev`.

## API

### Store a diff

```
POST /api/diff
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "chatId": "conversation-123",
  "patch": "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@...",
  "fileName": "src/file.ts",
  "additions": 5,
  "deletions": 2
}
```

Response:

```json
{
  "id": "conversation-123_abc123",
  "expiresAt": 1711360000
}
```

### View a diff

```
GET /diff?id=<id>&exp=<expiry_timestamp>&sig=<hmac_signature>
```

Returns a fully rendered HTML page with the diff.

## Local Development

```bash
npm run dev
```

This starts a local dev server with `wrangler dev`.

## License

MIT
