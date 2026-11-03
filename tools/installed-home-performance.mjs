// Production service worker and isolated persistent browser profile. No real APIs.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const origin=process.env.MOBILE_TEST_ORIGIN||'http://127.0.0.1:5341';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output=process.env.INSTALLED_EVIDENCE||'artifacts/classic-home-speed/installed';
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.resolve(output,'profile-'));
const samples=[],errors=[];
const launch=()=>chromium.launchPersistentContext(profile,{headless:true,channel:'msedge',viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'America/Chicago'});
const ready=async page=>{
 await page.waitForFunction(()=>{
  const title=document.querySelector('.mobile-dashboard-workout h1'),metric=document.querySelector('.dashboard-fitness-card [data-slot="card-title"]');
  return title?.textContent && metric && /\d/.test(metric.textContent) && document.querySelector('#mobile-tab-calendar');
 },{},{polling:'raf'});
 return page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(performance.now()))));
};
const setup=async context=>{
 context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 await context.addInitScript(()=>localStorage.setItem('ar-performance:mobile-home-layout','classic'));
 const page=context.pages()[0]||await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:5_000_000,uploadThroughput:1_250_000});
 const throttle=Number(process.env.INSTALLED_CPU_THROTTLE||1);await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});
 return page;
};
let context;
try{
 context=await launch();let page=await setup(context);
 await page.goto(origin+'/?performance=1',{waitUntil:'domcontentloaded'});
 samples.push({kind:'first-ever-visit',ready:await ready(page)});
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 await page.waitForFunction(async()=>Boolean(await (await caches.open('training-agent-shell-v5')).match('/__app_shell_assets__')));
 await page.waitForLoadState('networkidle');
 await context.close();context=null;
 for(let i=0;i<Number(process.env.INSTALLED_SAMPLES||5);i++){
  context=await launch();page=await setup(context);
  await page.goto(origin+'/?performance=1',{waitUntil:'domcontentloaded'});
  const cold=await ready(page);
  samples.push({kind:'installed-cold-browser-launch',sample:i,ready:cold,resources:await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({url:new URL(r.name).pathname,start:r.startTime,end:r.responseEnd,bytes:r.decodedBodySize,worker:r.workerStart})))});
  await page.locator('#mobile-tab-calendar').click();await page.waitForSelector('.training-calendar');
  const start=await page.evaluate(()=>performance.now());await page.locator('#mobile-tab-home').click();
  samples.push({kind:'return-home',sample:i,ready:(await ready(page))-start});
  if(i===0)await page.screenshot({path:path.join(output,'installed.png')});
  await context.close();context=null;
 }
}finally{
 await context?.close();
 await fs.writeFile(path.join(output,'samples.json'),JSON.stringify({conditions:{cache:'production service worker, persistent profile, browser process restarted per installed launch',backend:'synthetic local APIs',latencyMs:40,cpuThrottle:Number(process.env.INSTALLED_CPU_THROTTLE||1),targetMs:250},samples,errors},null,2));
  const root=path.resolve(output)+path.sep;
  assert.ok(profile.startsWith(root)&&/^profile-[a-z0-9]+$/i.test(path.basename(profile)));
  await fs.rm(profile,{recursive:true,force:true});
}
assert.deepEqual(errors,[]);
for(const kind of [...new Set(samples.map(r=>r.kind))]){const rows=samples.filter(r=>r.kind===kind).map(r=>r.ready).sort((a,b)=>a-b);console.log(JSON.stringify({kind,median:rows[Math.floor(rows.length/2)],max:rows.at(-1)}));}
