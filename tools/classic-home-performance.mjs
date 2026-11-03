// Repeatable comparison: production assets, fresh mobile contexts, synthetic APIs.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const origin=process.env.MOBILE_TEST_ORIGIN||'http://127.0.0.1:5341';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output=process.env.CLASSIC_EVIDENCE||'artifacts/classic-home-speed/before';
const count=Number(process.env.CLASSIC_SAMPLES||5);
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const samples=[],errors=[];
try {
 for(let sample=0;sample<count;sample++)for(const layout of ['classic','redesign']) {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block',timezoneId:'America/Chicago'});
  const page=await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(layout=>{
    localStorage.setItem('ar-performance:mobile-home-layout',layout);
    window.homeVitals={lcp:0,cls:0};
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.homeVitals.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});
    new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.homeVitals.cls+=e.value}).observe({type:'layout-shift',buffered:true});
  },layout);
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:5_000_000,uploadThroughput:1_250_000});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(origin+'/?performance=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(layout=>{
    const card=document.querySelector(layout==='classic'?'.mobile-dashboard-workout':'.home-session-tile, .home-rest-day');
    const title=card?.querySelector(layout==='classic'?'h1':'h3');
    const metric=document.querySelector(layout==='classic'?'.dashboard-fitness-card [data-slot="card-title"]':'.home-fitness-value strong');
    return title?.textContent && metric && /\d/.test(metric.textContent) && document.querySelector('#mobile-tab-calendar');
  },layout);
  const ready=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(performance.now()))));
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({url:new URL(r.name).pathname+new URL(r.name).search,start:r.startTime,end:r.responseEnd,bytes:r.decodedBodySize})));
  await page.waitForLoadState('networkidle');
  const vitals=await page.evaluate(()=>window.homeVitals);
  if(sample===0)await page.screenshot({path:path.join(output,layout+'.png')});
  samples.push({sample,layout,ready,...vitals,resources});
  console.log(JSON.stringify({sample,layout,ready:Math.round(ready),...vitals}));
  await context.close();
 }
} finally {await browser.close();await fs.writeFile(path.join(output,'samples.json'),JSON.stringify({conditions:{samplesPerLayout:count,cpuThrottle:4,latencyMs:40,downMbps:40,viewport:'390x844',cache:'fresh context, no service worker',backend:'isolated synthetic APIs'},samples,errors},null,2));}
assert.deepEqual(errors,[]);
for(const layout of ['classic','redesign']){
 const rows=samples.filter(r=>r.layout===layout).map(r=>r.ready).sort((a,b)=>a-b);
 console.log(JSON.stringify({layout,median:rows[Math.floor(rows.length/2)],max:rows.at(-1)}));
}
