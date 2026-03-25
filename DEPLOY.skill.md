# Skill: Deploy Operon Diff Worker

You are deploying the **operon-diff-worker** — a Cloudflare Worker that stores and renders code diffs.

## Prerequisites Check

Before starting, verify the user has:
- Node.js >= 18 installed
- A Cloudflare account

Run `npx wrangler whoami` to check if the user is logged in. If not, ask them to run `npx wrangler login` manually (it requires browser interaction).

## Step-by-step Deployment

### Step 1 — Install dependencies

```bash
npm install
```

### Step 2 — Create KV namespace

```bash
npx wrangler kv namespace create DIFFS
```

Parse the output to extract the KV namespace `id`.

### Step 3 — Generate wrangler.toml

Copy the example config and fill in the KV namespace ID:

```bash
cp wrangler.toml.example wrangler.toml
```

Then edit `wrangler.toml`, replacing `<YOUR_KV_NAMESPACE_ID>` with the actual ID from Step 2.

### Step 4 — Set the API_KEY secret

Generate a random API key and set it as a secret:

```bash
# Generate a random key
openssl rand -base64 32
```

Then ask the user to run:

```
npx wrangler secret put API_KEY
```

This requires interactive input (pasting the key), so the user must run it themselves. Tell them to paste the generated key when prompted.

**Important:** Tell the user to save this API_KEY — they will need it to configure Operon to call this worker.

### Step 5 — Deploy

```bash
npm run deploy
```

The output will contain the worker URL, e.g. `https://operon-diff-worker.<subdomain>.workers.dev`.

### Step 6 — Verify

Test the deployment:

```bash
curl -s -o /dev/null -w "%{http_code}" <WORKER_URL>/api/diff
```

Expected: `401` (Unauthorized) — this confirms the worker is running and auth is enforced.

## Output

After deployment, provide the user with:

1. **Worker URL**: `https://operon-diff-worker.<subdomain>.workers.dev`
2. **API_KEY**: the key generated in Step 4
3. Remind them to configure these values in their Operon instance.
