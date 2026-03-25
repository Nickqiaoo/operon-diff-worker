import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nanoid } from 'nanoid'
import { preloadPatchDiff } from '@pierre/diffs/ssr'

interface Env {
  DIFFS: KVNamespace
  API_KEY: string
}

interface DiffData {
  patch: string
  fileName: string
  additions: number
  deletions: number
}

const DIFF_TTL_SECONDS = 60 * 60

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

// Store diff patch (raw text, not pre-rendered HTML)
app.post('/api/diff', async (c) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
  if (!token || token !== c.env.API_KEY) {
    return c.text('Unauthorized', 401)
  }

  const body = await c.req.json<DiffData & { chatId: string }>()
  if (!body.patch?.trim()) return c.text('Empty patch', 400)
  if (!body.chatId) return c.text('Missing chatId', 400)

  const id = nanoid()
  const key = `diff:${body.chatId}_${id}`
  const expiresAt = Math.floor(Date.now() / 1000) + DIFF_TTL_SECONDS

  const data: DiffData = {
    patch: body.patch,
    fileName: body.fileName,
    additions: body.additions,
    deletions: body.deletions,
  }

  await c.env.DIFFS.put(key, JSON.stringify(data), {
    expirationTtl: DIFF_TTL_SECONDS,
  })

  return c.json({ id: `${body.chatId}_${id}`, expiresAt })
})

// Serve diff viewer page — SSR render on request
app.get('/diff', async (c) => {
  const id = c.req.query('id') ?? c.req.query('startapp')
  const expRaw = c.req.query('exp')
  const sig = c.req.query('sig')
  if (!id) return c.text('Missing id parameter', 400)
  if (!expRaw || !sig) return c.text('Missing signature', 400)

  const exp = Number(expRaw)
  if (!Number.isInteger(exp)) return c.text('Invalid exp parameter', 400)
  if (exp < Math.floor(Date.now() / 1000)) return c.text('Link expired', 403)

  const isValid = await verifyDiffSignature({
    id,
    exp,
    sig,
    secret: c.env.API_KEY,
  })
  if (!isValid) return c.text('Forbidden', 403)

  const raw = await c.env.DIFFS.get(`diff:${id}`, { type: 'text' })
  if (!raw) {
    return c.html(renderExpiredPage())
  }

  const data: DiffData = JSON.parse(raw)

  // SSR render the patch using @pierre/diffs
  let diffHtml: string
  try {
    const result = await preloadPatchDiff({
      patch: data.patch,
      options: {
        diffStyle: 'unified',
        diffIndicators: 'bars',
        lineDiffType: 'none',
        overflow: 'wrap',
        themeType: 'dark',
        theme: {
          light: 'pierre-light',
          dark: 'pierre-dark',
        },
      },
    })
    diffHtml = result.prerenderedHTML
  } catch (err) {
    console.error('[DiffViewer] SSR render failed:', err)
    // Fallback: show raw patch as preformatted text
    diffHtml = `<pre style="padding:12px;font-size:13px;overflow-x:auto">${escapeHtml(data.patch)}</pre>`
  }

  return c.html(renderViewerPage({ ...data, html: diffHtml }))
})

function renderViewerPage(data: DiffData & { html: string }): string {
  const { html, fileName, additions, deletions } = data

  const statsHtml = [
    additions > 0 ? `<span class="stat-add">+${additions}</span>` : '',
    deletions > 0 ? `<span class="stat-del">-${deletions}</span>` : '',
  ].filter(Boolean).join(' ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Diff: ${escapeHtml(fileName)}</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f5f5f5;
      --bg-card: #ffffff;
      --text: #1a1a1a;
      --text-secondary: #6b7280;
      --border: rgba(0,0,0,0.06);
      --add-color: #16a34a;
      --del-color: #dc2626;
      --radius: 12px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0a0a0a;
        --bg-card: #141414;
        --text: #e5e5e5;
        --text-secondary: #737373;
        --border: rgba(255,255,255,0.06);
        --add-color: #4ade80;
        --del-color: #f87171;
      }
    }

    body.tg-dark {
      --bg: #0a0a0a;
      --bg-card: #141414;
      --text: #e5e5e5;
      --text-secondary: #737373;
      --border: rgba(255,255,255,0.06);
      --add-color: #4ade80;
      --del-color: #f87171;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 12px;
    }

    .diff-card {
      background: var(--bg-card);
      border-radius: var(--radius);
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .diff-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
    }

    .diff-header svg {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      color: var(--text-secondary);
    }

    .file-name {
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      color: var(--text);
    }

    .diff-stats {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 12px;
      font-weight: 500;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      display: flex;
      gap: 6px;
    }

    .stat-add { color: var(--add-color); }
    .stat-del { color: var(--del-color); }

    .diff-content {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    /* Match app's pierre-diff-file-view styling */
    .pierre-diff-file-view {
      font-size: 13px;
    }

    .pierre-diff-file-view [class*="diff-view"] {
      border: none !important;
      border-radius: 0 !important;
    }

    .pierre-diff-file-view [class*="line-number"] {
      opacity: 0.4;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="diff-card">
    <div class="diff-header">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
        <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
      </svg>
      <span class="file-name">${escapeHtml(fileName)}</span>
      <span class="diff-stats">${statsHtml}</span>
    </div>
    <div class="diff-content pierre-diff-file-view">
      ${html}
    </div>
  </div>
  <script>
    (function() {
      var tg = window.Telegram && window.Telegram.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
        if (tg.colorScheme === 'dark') {
          document.body.classList.add('tg-dark');
        }
      }
    })();
  </script>
</body>
</html>`
}

function renderExpiredPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Diff Expired</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root { --bg: #f5f5f5; --bg-card: #ffffff; --text: #1a1a1a; --text-secondary: #6b7280; --border: rgba(0,0,0,0.06); }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0a0a0a; --bg-card: #141414; --text: #e5e5e5; --text-secondary: #737373; --border: rgba(255,255,255,0.06); }
    }
    body.tg-dark { --bg: #0a0a0a; --bg-card: #141414; --text: #e5e5e5; --text-secondary: #737373; --border: rgba(255,255,255,0.06); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--text-secondary);
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 12px; padding: 32px; text-align: center; max-width: 320px;
    }
    h2 { font-size: 16px; margin-bottom: 6px; color: var(--text); font-weight: 500; }
    p { font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Diff Expired</h2>
    <p>This diff preview has expired (1 hour TTL).</p>
  </div>
  <script>
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready(); tg.expand();
      if (tg.colorScheme === 'dark') document.body.classList.add('tg-dark');
    }
  </script>
</body>
</html>`
}

async function verifyDiffSignature(params: {
  id: string
  exp: number
  sig: string
  secret: string
}): Promise<boolean> {
  const expected = await signDiffPayload(params.id, params.exp, params.secret)
  return timingSafeEqual(expected, params.sig)
}

async function signDiffPayload(id: string, exp: number, secret: string): Promise<string> {
  const payload = `${id}.${exp}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return encodeBase64Url(new Uint8Array(signature))
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false

  let mismatch = 0
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  }

  return mismatch === 0
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default app
