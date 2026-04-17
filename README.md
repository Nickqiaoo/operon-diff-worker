# Operon Diff Worker

> Share beautiful code diffs via a single link.

A Cloudflare Worker that stores and renders code diffs as beautiful web pages. Used by [Operon](https://github.com/nickqiaoo/operon) to share diff previews via links.

## Features

- Store unified diffs via API with Bearer token auth
- Server-side render diffs using [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs) with syntax highlighting
- HMAC-signed URLs with configurable TTL (default 1 hour)
- Automatically follows the current dark/light theme
- Zero database required - uses Cloudflare KV for storage
- Lightweight and fast - cold start under 5ms on Cloudflare edge

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8 (recommended package manager)
- A [Cloudflare](https://dash.cloudflare.com/) account (free plan works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (included as dev dependency)

## Deploy

### 1. Clone and install

```bash
git clone https://github.com/Nickqiaoo/operon-diff-worker.git
cd operon-diff-worker
pnpm install
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
pnpm run deploy
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
pnpm run dev
```

This starts a local dev server with `wrangler dev`.

## Tech Stack

- **Runtime**: Cloudflare Workers (V8 isolates)
- **Storage**: Cloudflare KV
- **Diff Rendering**: [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs)
- **Syntax Highlighting**: [Shiki](https://shiki.matsu.io/)
- **Framework**: [Hono](https://hono.dev/)

## License

MIT
