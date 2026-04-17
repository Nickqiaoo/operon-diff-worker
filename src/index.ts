import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nanoid } from 'nanoid'
import { preloadPatchDiff } from '@pierre/diffs/ssr'
// @ts-expect-error — pierre ships CSS as a default-exported string (vendored from @pierre/diffs/dist/style.js)
import pierreStyles from './pierre-styles.js'

const DIFFS_TAG = 'diffs-container'
const pierreCss = pierreStyles as string

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

app.get('/diff', async (c) => {
  const id = c.req.query('id') ?? c.req.query('startapp')
  const expRaw = c.req.query('exp')
  const sig = c.req.query('sig')
  if (!id) return c.text('Missing id parameter', 400)
  if (!expRaw || !sig) return c.text('Missing signature', 400)

  const exp = Number(expRaw)
  if (!Number.isInteger(exp)) return c.text('Invalid exp parameter', 400)
  if (exp < Math.floor(Date.now() / 1000)) return c.text('Link expired', 403)

  const isValid = await verifyDiffSignature({ id, exp, sig, secret: c.env.API_KEY })
  if (!isValid) return c.text('Forbidden', 403)

  const raw = await c.env.DIFFS.get(`diff:${id}`, { type: 'text' })
  c.header('Cache-Control', 'private, no-store')
  if (!raw) return c.html(renderExpiredPage())

  const data: DiffData = JSON.parse(raw)

  let diffHtml: string
  try {
    const result = await preloadPatchDiff({
      patch: data.patch,
      options: {
        diffStyle: 'unified',
        diffIndicators: 'classic',
        lineDiffType: 'word',
        overflow: 'wrap',
        themeType: 'system',
      },
    })
    diffHtml = result.prerenderedHTML
  } catch (err) {
    console.error('[DiffViewer] SSR render failed:', err)
    diffHtml = `<pre style="padding:12px;font-size:13px;overflow-x:auto">${escapeHtml(data.patch)}</pre>`
  }

  return c.html(renderViewerPage({ fileName: data.fileName, html: diffHtml }))
})

function renderViewerPage(data: { fileName: string; html: string }): string {
  const { html, fileName } = data
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(fileName)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: light-dark(#f5f5f5, #0a0a0a); color-scheme: light dark; }
    body { padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
  <${DIFFS_TAG}><template shadowrootmode="open"><style>${pierreCss}</style>${html}</template></${DIFFS_TAG}>
</body>
</html>`
}

function renderExpiredPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Diff Expired</title>
  <style>
    body { color-scheme: light dark; background: light-dark(#f5f5f5, #0a0a0a); color: light-dark(#6b7280, #737373);
      display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .card { background: light-dark(#fff, #141414); border: 1px solid light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.06));
      border-radius: 12px; padding: 32px; text-align: center; max-width: 320px; }
    h2 { font-size: 16px; margin: 0 0 6px; color: light-dark(#1a1a1a, #e5e5e5); font-weight: 500; }
    p { font-size: 13px; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Diff Expired</h2>
    <p>This diff preview has expired (1 hour TTL).</p>
  </div>
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
