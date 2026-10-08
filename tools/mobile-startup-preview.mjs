// Local-only slow-network harness around the existing synthetic app APIs.
// No requests are forwarded to Intervals.icu, Supabase or production.
import http from 'node:http'
process.env.INTERVALS_PREVIEW_PORT = '5191'
await import('./intervals-browser-preview.mjs')
const calls = []
let assetDelay = 0, authDelay = 0, anonymous = false, failedCss = false
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:5190')
  const json = data => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)) }
  if (url.pathname === '/_test/startup') {
    if (url.searchParams.has('assets')) assetDelay = Math.min(10000, Math.max(0, Number(url.searchParams.get('assets')) || 0))
    if (url.searchParams.has('auth')) authDelay = Math.min(10000, Math.max(0, Number(url.searchParams.get('auth')) || 0))
    if (url.searchParams.has('anonymous')) anonymous = url.searchParams.get('anonymous') === '1'
    if (url.searchParams.has('failedCss')) failedCss = url.searchParams.get('failedCss') === '1'
    if (url.searchParams.has('reset')) calls.length = 0
    return json({ assetDelay, authDelay, anonymous, failedCss })
  }
  if (url.pathname === '/_test/startup-calls') return json(calls)
  calls.push({ path: url.pathname, query: url.search, at: Date.now() })
  // Each slow-load test is independent of the browser's saved service worker.
  if (url.pathname === '/sw.js') { response.writeHead(404); return response.end() }
  const api = url.searchParams.get('__api_route') || url.pathname.slice(5)
  if (api === 'auth/session') {
    await wait(authDelay)
    if (anonymous) return json({ configured: true, authenticated: false, hasPasskey: false, passkeysSupported: false })
  }
  if (url.pathname.startsWith('/assets/')) {
    await wait(assetDelay)
    if (failedCss && url.pathname.endsWith('.css')) { response.writeHead(503); return response.end('Fixture stylesheet failure') }
  }
  const body = []
  for await (const chunk of request) body.push(chunk)
  try {
    const upstream = await fetch('http://127.0.0.1:5191' + request.url, {
      method: request.method,
      ...(body.length ? { body: Buffer.concat(body) } : {}),
    })
    response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    response.writeHead(502)
    response.end('Synthetic fixture unavailable')
  }
}).listen(5190, '127.0.0.1', () => console.log('Mobile startup fixture http://127.0.0.1:5190/?performance=1'))
