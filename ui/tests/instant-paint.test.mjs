import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { instantPaint } from '../instant-paint-plugin.ts'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const source = html.match(/<script id="app-boot-script">([\s\S]*?)<\/script>/)[1]
function boot(styles = [], pathname = '/') {
  const events = new Map(), timers = new Map()
  let removed = false, ready = false
  const shell = { dataset: {}, remove: () => { removed = true } }
  const retry = { hidden: true }
  const window = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) }
  runInNewContext(source, {
    window, location: { pathname, search: '' }, URLSearchParams,
    setTimeout: fn => { timers.set(1, fn); return 1 }, clearTimeout: id => timers.delete(id),
    document: {
      getElementById: id => id === 'app-boot' ? shell : retry,
      querySelectorAll: () => styles,
      documentElement: { setAttribute: () => { ready = true } },
    },
  })
  return { window, shell, retry, events, timers, state: () => ({ removed, ready }) }
}
test('the shell stays visible while React or any application stylesheet is pending', () => {
  const styles = [{ dataset: {} }, { dataset: { ready: 'true' } }]
  const app = boot(styles)
  assert.deepEqual(app.state(), { removed: false, ready: false })
  app.window.__trainingFinishBoot()
  assert.deepEqual(app.state(), { removed: false, ready: false })
  styles[0].dataset.ready = 'true'
  app.events.get('training-styles-ready')()
  assert.deepEqual(app.state(), { removed: true, ready: true })
  assert.equal(app.timers.size, 0)
  assert.equal(app.events.size, 0)
})
test('cached CSS finishing before React is handled without another load event', () => {
  const app = boot([{ dataset: { ready: 'true' } }])
  app.window.__trainingFinishBoot()
  assert.equal(app.state().ready, true)
})
test('failed CSS leaves the public shell and a working retry instead of unstyled private content', () => {
  const app = boot([{ dataset: { failed: 'true' } }])
  app.window.__trainingFinishBoot()
  assert.equal(app.retry.hidden, false)
  assert.equal(app.state().ready, false)
})
test('script loading failure offers recovery and calendar paths use the calendar shell', () => {
  const app = boot([], '/calendar')
  assert.equal(app.shell.dataset.page, 'Calendar')
  app.timers.get(1)()
  assert.equal(app.retry.hidden, false)
  assert.equal(app.state().removed, false)
})
test('built styles preload without blocking the shell and signal when ready', () => {
  const transformed = instantPaint().transformIndexHtml.handler('<link rel="stylesheet" crossorigin href="/assets/index-test.css">')
  assert.match(transformed, /rel="preload" as="style"/)
  assert.match(transformed, /rel="stylesheet" media="print" data-app-style/)
  const loaded = transformed.match(/onload="([^"]+)"/)[1]
  const element = { media: 'print', dataset: {} }, signals = []
  runInNewContext(`(function(){${loaded}}).call(element)`, { element, window: { dispatchEvent: event => signals.push(event.type) }, Event })
  assert.equal(element.media, 'all')
  assert.equal(element.dataset.ready, 'true')
  assert.deepEqual(signals, ['training-styles-ready'])
})
