// Local-only calendar performance fixture. No request leaves this server.
// First visit seeds the normal app cache. Then open /_test/config?grow=1 and
// reload /calendar?slow=1500 to verify that earlier rows growing never move
// the date on screen. The picker/scroll can fetch any historical month.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('ui/dist')
const port = Number(process.env.CALENDAR_PREVIEW_PORT || 5180)
const calls = []
let slow = 400, grown = false, annual = false, varied = false, revision = 1
const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const todayDate = new Date(), today = key(todayDate)
const offset = (days) => { const date = new Date(todayDate); date.setDate(date.getDate() + days); return key(date) }
const workout = (date, index = 0) => ({
  id: `activity:fixture-${date}-${index}`, activity_id: `fixture-${date}-${index}`,
  date, day: date, workout_date: date, sport: index % 2 ? 'Bike' : 'Run',
  title: `${index % 2 ? 'Ride' : 'Run'} ${date} ${index + 1}`,
  duration: '45m', actualDurationMinutes: 45, plannedDurationMinutes: 45,
  goal: 'Synthetic fixture workout', status: 'completed',
  completed_data: { duration_minutes: 45, distance: 7000, tss: 44 },
  planned: { duration_minutes: 45, tss: 44 },
})
const history = (start, end) => {
  const rows = []
  const date = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`)
  for (; date <= last && rows.length < 5000; date.setDate(date.getDate() + 1)) {
    const day = key(date)
    if (day > today || day < '2010-01-01') continue
    const count = grown && (day === offset(-1) || day === offset(-8)) ? 9 : varied ? (Number(day.slice(-2)) % 5 === 0 ? 7 : date.getMonth() % 3 === 0 ? 0 : 1) : date.getDay() % 3 === 0 ? 2 : 1
    for (let i = 0; i < count; i++) rows.push(workout(day, i))
  }
  return rows
}
const context = (range = null) => ({
  athlete: { name: 'Calendar performance fixture', time_zone: 'America/Chicago', zones: {} },
  metrics: { fitness: 65, fatigue: 63, form: 2 }, wellness: {}, wellness_history: [],
  history: history(range?.start || offset(-77), range?.end || today), planned: [],
  source: 'isolated-calendar-fixture', context_scope: range ? 'range' : 'full', retention_days: 90,
  display_range: range || { start: '0000-01-01', end: '9999-12-31' },
  cached_ranges: [{ start: range?.start || offset(-77), end: range?.end || offset(84) }],
  ...(range ? {} : { version: `calendar-fixture-${revision}` }),
  cache_scope: 'isolated-calendar-performance', synced_at: new Date().toISOString(),
})
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)) }
  if (url.pathname === '/_test/config') {
    if (url.searchParams.has('grow')) { grown = url.searchParams.get('grow') === '1'; revision++ }
    if (url.searchParams.has('annual')) annual = url.searchParams.get('annual') === '1'
    if (url.searchParams.has('varied')) { varied = url.searchParams.get('varied') === '1'; revision++ }
    if (url.searchParams.has('slow')) slow = Math.min(10_000, Math.max(0, Number(url.searchParams.get('slow')) || 0))
    if (url.searchParams.has('resetCalls')) calls.length = 0
    return json({ grown, annual, varied, revision, slow })
  }
  if (url.pathname === '/_test/calls') return json(calls)
  if (url.pathname.startsWith('/api/')) {
    const api = url.searchParams.get('__api_route') || url.pathname.slice(5)
    calls.push({ api, query: Object.fromEntries(url.searchParams), at: Date.now() })
    if (api === 'auth/session') return json({ configured: true, authenticated: true, hasPasskey: false, passkeysSupported: false })
    if (api === 'config') return json({ theme: 'light', intervalsConnected: true, supabaseConnected: false, calendarSummaryOpen: true })
    if (api === 'training-live') return json({ available: false })
    if (api === 'annual-plans') {
      if (!annual) return json({ plans: [], activeId: null })
      await new Promise((resolve) => setTimeout(resolve, slow + 750))
      const monday = new Date(todayDate); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
      const weeks = Array.from({ length: 5 }, (_, index) => {
        const start = new Date(monday); start.setDate(start.getDate() - index * 7)
        const end = new Date(start); end.setDate(end.getDate() + 6)
        return { id: `fixture-week-${index}`, startDate: key(start), endDate: key(end), phase: 'Base 1', phaseWeek: 1, notes: 'Late annual-plan fixture notes add height above the current calendar viewport. '.repeat(6) }
      })
      return json({ activeId: 'fixture-plan', plans: [{ id: 'fixture-plan', name: 'Fixture plan', events: [], weeks }] })
    }
    if (api === 'race-events') return json({ events: [] })
    if (api === 'section11-sync') return json({ status: 'idle' })
    if (api === 'training-context' || api === 'training-updates') {
      await new Promise((resolve) => setTimeout(resolve, slow))
      const next = context(url.searchParams.get('scope') === 'range' ? { start: url.searchParams.get('start'), end: url.searchParams.get('end') } : null)
      if (api === 'training-updates') return json(url.searchParams.get('version') === next.version ? { unchanged: true, version: next.version } : { unchanged: false, version: next.version, context: next })
      return json(next)
    }
    if (api === 'training-history') return json({ weeks: [] })
    return json({ error: 'Unavailable in the isolated calendar fixture' }, 404)
  }
  try {
    if (url.searchParams.has('slow')) slow = Math.min(10_000, Math.max(0, Number(url.searchParams.get('slow')) || 0))
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const target = path.resolve(root, filename)
    if (!target.startsWith(root + path.sep)) return json({ error: 'Invalid path' }, 400)
    const data = await fs.readFile(target)
    response.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(data)
  } catch { json({ error: 'Not found' }, 404) }
})
server.listen(port, '127.0.0.1', () => console.log(`Calendar fixture http://127.0.0.1:${port}/calendar?performance=1`))
