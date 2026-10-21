import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { preloadable } from '../src/lib/preloadable.ts'
import { instantPaint } from '../instant-paint-plugin.ts'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const source = html.match(/<script id="app-boot-script">([\s\S]*?)<\/script>/)[1]
test('workspace startup overlaps only the open page protected reads, without speculative writes', async () => {
  const startup = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(value => value.includes('__trainingSessionRequest'))
  for (const [pathname, expected] of [['/coach',['auth/session','coach/reports/catalog']],['/library/',['auth/session','workout-library']],['/atp',['auth/session','training-context','annual-plans']],['/settings',['auth/session','training-context','race-events']]]) {
    const calls = [], window = {matchMedia: () => ({matches:false})}
    runInNewContext(startup, {window, location:{pathname}, localStorage:{getItem:()=>null}, AbortSignal, AbortController, Response, DOMException, setTimeout, clearTimeout, Intl, Date, encodeURIComponent,
      fetch: (url, options) => { calls.push({path:new URL(url,'http://localhost').searchParams.get('__api_route'),options}); return Promise.resolve(null) },
    })
    assert.deepEqual(calls.map(call=>call.path),expected)
    assert.ok(calls.every(call=>call.options.credentials==='same-origin' && call.options.cache==='no-store' && !call.options.method))
  }
})
test('reports bootstrap respects saved date filters and a fresh device archive', () => {
  const startup = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(value => value.includes('__trainingSessionRequest'))
  function run(range, archive) {
    const calls=[]
    runInNewContext(startup,{window:{matchMedia:()=>({matches:false})},location:{pathname:'/workout-reports'},AbortSignal,AbortController,Response,DOMException,setTimeout,clearTimeout,Intl,Date,encodeURIComponent,
      localStorage:{getItem:key=>JSON.stringify(key==='training-agent-startup-metadata-v1'?{version:'saved-v1'}:archive)},
      sessionStorage:{getItem:()=>JSON.stringify({filters:{range}})},
      fetch:url=>{calls.push(new URL(url,'http://localhost'));return Promise.resolve(null)},
    })
    return calls
  }
  assert.equal(run('all',null).filter(url=>url.searchParams.get('__api_route')==='workout-history').length,1)
  assert.equal(run('custom',null).filter(url=>url.searchParams.get('__api_route')==='workout-history').length,0)
  assert.equal(run('all',{version:'saved-v1',expires:Date.now()+60_000}).filter(url=>url.searchParams.get('__api_route')==='workout-history').length,0)
  assert.equal(run('all',{version:'different-user-or-version',expires:Date.now()+60_000}).filter(url=>url.searchParams.get('__api_route')==='workout-history').length,1)
})
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
test('workspace and ATP boots use compact page skeletons before authentication', () => {
  for (const path of ['/coach','/settings','/library','/workout-reports']) assert.equal(boot([],path).shell.dataset.page,'Workspace')
  assert.equal(boot([],'/atp').shell.dataset.page,'Annual Plan')
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

test('a preloaded route renders on the first commit without entering Suspense again', async () => {
  const require=createRequire(new URL('../package.json',import.meta.url));
  const {createElement,Suspense}=require('react');
  const {renderToStaticMarkup}=require('react-dom/server');
  let loads=0;
  const route=preloadable(async()=>{loads++;return {default:()=>createElement('p',null,'Ready')}});
  await Promise.all([route.preload(),route.preload()]);
  const html=renderToStaticMarkup(createElement(Suspense,{fallback:'Loading'},createElement(route.Component)));
  assert.equal(loads,1);
  assert.match(html,/<p>Ready<\/p>/);
  assert.ok(!html.includes('Loading'));
});

test('a failed intent preload can be retried instead of poisoning later navigation', async()=>{
  let calls=0;
  const route=preloadable(async()=>{if(++calls===1)throw Error('Temporary network failure');return {default:()=>null}});
  await assert.rejects(route.preload(),/Temporary/);
  await route.preload();
  assert.equal(calls,2);
});

test('a cold route commits its local skeleton instead of suspending the surrounding page', async () => {
  const require=createRequire(new URL('../package.json',import.meta.url));
  const {createElement,Suspense}=require('react');
  const {renderToStaticMarkup}=require('react-dom/server');
  const route=preloadable(async()=>({default:()=>createElement('p',null,'Ready')}),()=>createElement('p',{role:'status'},'Local skeleton'));
  const render=()=>renderToStaticMarkup(createElement(Suspense,{fallback:'Outer fallback'},createElement(route.Component)));
  assert.match(render(),/<p role="status">Local skeleton<\/p>/);
  assert.ok(!render().includes('Outer fallback'));
  await route.preload();
  assert.match(render(),/<p>Ready<\/p>/);
});
