// Functional checks for the original Home layout, using disposable APIs only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const origin=process.env.MOBILE_TEST_ORIGIN||'http://127.0.0.1:5341';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output='artifacts/classic-home-speed/functional';
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'}),results=[],errors=[];
try {
 for(const width of [320,390,430,1280]) {
  const mobile=width<768;
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:mobile,isMobile:mobile,serviceWorkers:'block',timezoneId:'America/Chicago'});
  const page=await context.newPage();
  await context.addInitScript(()=>localStorage.setItem('ar-performance:mobile-home-layout','classic'));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const card=page.locator(mobile?'.mobile-dashboard-workout':'.dashboard-session-card');
  await card.locator('h1').waitFor();
  assert.equal(await page.locator('.mobile-home-redesign').count(),0);
  assert.equal(await page.locator(mobile?'.dashboard-session-card':'.mobile-dashboard-workout').count(),0,'Do not render the hidden alternative workout card');
  const initialTitle=await card.locator('h1').innerText();
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(row=>row.name));
  if(mobile){
   assert.ok(!resources.some(url=>url.includes('/images/home/finish-texas.webp')),'Classic does not preload an unused redesign image');
   assert.ok(!resources.some(url=>/CartesianChart|chart-area-interactive|fitness-history-card/.test(url)),'Offscreen progress charts stay off the critical path');
   const next=card.getByRole('button',{name:/Show next workout/});
   if(await next.count()) {await next.tap();assert.notEqual(await card.locator('h1').innerText(),initialTitle);}
   await card.press('ArrowRight');
   await page.waitForFunction(()=>document.querySelector('.mobile-dashboard-workout [data-slot="card-description"]').textContent.includes('Tomorrow'));
   await card.press('ArrowLeft');
   assert.equal(await card.locator('h1').innerText(),initialTitle);
   await card.tap();
   await page.waitForFunction(()=>Boolean(new URL(location.href).searchParams.get('workout')));
   await page.getByRole('tab',{name:'Home',exact:true}).tap();
   await card.waitFor();
   await page.waitForFunction(()=>!new URL(location.href).searchParams.has('workout'));
  }
  await page.screenshot({path:path.join(output,`classic-${width}.png`)});
  await page.locator('.dashboard-history-grid').scrollIntoViewIfNeeded();
  const history=page.getByRole(mobile?'tablist':'group',{name:'Filter training history by sport',exact:true});
  if(mobile) {
   await history.waitFor();
   await history.getByRole('tab',{name:'Swim',exact:true}).tap();
   assert.equal(await history.getByRole('tab',{name:'Swim',exact:true}).getAttribute('aria-selected'),'true');
  } else await page.locator('.training-history-chart').waitFor();
  // Retained device data must survive a failed refresh without a blank page.
  await page.route('**/*',route=>new URL(route.request().url()).pathname.startsWith('/api/')&&/training-context|training-updates/.test(route.request().url())?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic offline refresh"}'}):route.continue());
  await page.reload({waitUntil:'domcontentloaded'});
  await card.locator('h1').waitFor();
  assert.equal(await card.locator('h1').innerText(),initialTitle);
  assert.equal(await page.evaluate(()=>localStorage.getItem('ar-performance:mobile-home-layout')),'classic');
  results.push({width,desktopAlternativeAbsent:true,retainedLayout:true,offlineCachedHome:true,firstWorkout:initialTitle});
  await context.close();
 }
} finally {await browser.close();await fs.writeFile(path.join(output,'result.json'),JSON.stringify({results,errors},null,2));}
assert.deepEqual(errors,[]);
console.log(JSON.stringify({passed:results.length,results,errors},null,2));
