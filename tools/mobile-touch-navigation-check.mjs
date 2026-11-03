// Trusted touchscreen gestures against the isolated production-build preview.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const origin=process.env.MOBILE_TEST_ORIGIN||'http://127.0.0.1:5337';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output=process.env.TOUCH_EVIDENCE||'artifacts/mobile-tap-fix/before';
await fs.mkdir(output,{recursive:true});
const engine=process.env.TOUCH_BROWSER||'chromium';
const layout=process.env.MOBILE_HOME_LAYOUT;
const homeSelector=layout==='classic'?'.mobile-dashboard-workout h1':'.home-athlete-name';
const browser=await (engine==='webkit'?webkit.launch({headless:true,...(process.env.TOUCH_WEBKIT_EXECUTABLE?{executablePath:process.env.TOUCH_WEBKIT_EXECUTABLE}:{})}):chromium.launch({headless:true,channel:'msedge'}));
const results=[],errors=[],writes=[];
let activePage;
try {
  for(const width of (process.env.TOUCH_SINGLE_WIDTH?[Number(process.env.TOUCH_SINGLE_WIDTH)]:[390,320,430])) {
    const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    if(layout)await context.addInitScript(value=>localStorage.setItem('ar-performance:mobile-home-layout',value),layout);
    const page=await context.newPage();
    activePage=page;
    page.setDefaultTimeout(5000);
    await page.addInitScript(()=>{
      window.tapTrace=[];
      for(const type of ['touchstart','touchend','click'])window.addEventListener(type,event=>{
        const target=event.target;
        queueMicrotask(()=>window.tapTrace.push({type,target:target?.tagName,html:target?.outerHTML?.slice(0,180),prevented:event.defaultPrevented}));
      },true);
    });
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(['POST','PUT','DELETE','PATCH'].includes(request.method())&&/workouts\/editor|calendar\/entries|nutrition\/entries|workout-commits/.test(request.url()))writes.push(request.url());});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin,{waitUntil:'networkidle'});
    await page.locator(homeSelector).waitFor();
    const cdp=engine==='chromium'?await context.newCDPSession(page):null;
    async function touch(control,dx=0,dy=0,child=false) {
      // A sticky site header can cover scrollIntoViewIfNeeded's top edge.
      await control.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
      const target=child?control.locator('span').first():control;
      const box=await target.boundingBox();
      const x=box.x+box.width/2,y=box.y+box.height/2;
      const hit=await control.evaluate((node,{x,y})=>({hit:node.contains(document.elementFromPoint(x,y)),target:document.elementFromPoint(x,y)?.outerHTML.slice(0,180),x,y}),{x,y});
      if(cdp && dy) {
        // End the native scroll without a fling: a tap that merely stops an
        // active fling is correctly consumed by the browser, not the app.
        await cdp.send('Input.synthesizeScrollGesture',{x,y,yDistance:-dy,gestureSourceType:'touch',preventFling:true});
      } else if(cdp) {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        if(dx||dy)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else await page.touchscreen.tap(x,y);
      return hit;
    }
    // Loading Calendar installs the lazy Framework7 touch module. Return to Home
    // and exercise native touch, rather than Playwright's mouse-style click().
    await page.getByRole('tab',{name:'Calendar',exact:true}).tap();
    await page.locator('.calendar-date-number').first().waitFor();
    await page.getByRole('button',{name:'Jump to calendar date',exact:true}).tap();
    await page.locator('.mobile-calendar-picker-panel .calendar-day').first().waitFor();
    await page.getByRole('button',{name:'Jump to calendar date',exact:true}).tap();
    await page.locator('.mobile-calendar-picker-layer').waitFor({state:'detached'});
    await page.getByRole('tab',{name:'Home',exact:true}).tap();
    await page.locator(homeSelector).waitFor();
    await page.locator('.dashboard-history-grid').scrollIntoViewIfNeeded();
    for(const label of ['Filter training history by sport','Fitness history sport']) {
      const group=page.getByRole('tablist',{name:label,exact:true});
      await group.scrollIntoViewIfNeeded();
      const tabs=group.getByRole('tab');
      for(const movement of (cdp?[0,7,-7,12]:[0,0,0,0])) {
        // Pick a different known tab on each trial so a missed tap is observable.
        const states=await tabs.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-selected')));
        const index=(states.indexOf('true')+1)%states.length;
        const button=tabs.nth(index);
        const hit=await touch(button,movement,0,true);
        const applied=await page.waitForFunction(node=>node.getAttribute('aria-selected')==='true',await button.elementHandle(),{timeout:1000}).then(()=>true,()=>false);
        results.push({engine,width,control:label,sport:await button.innerText(),movement,applied,...hit,...(!applied?{trace:await page.evaluate(()=>window.tapTrace.slice(-12))}:{})});
      }
      await page.screenshot({path:path.join(output,`filters-${label.startsWith('Fitness')?'fitness':'training'}-${width}.png`)});
      const selected=await tabs.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-selected')));
      const other=tabs.nth(selected[1]==='true'?2:1);
      if(cdp){
        await touch(other,0,100,true);
        assert.deepEqual(await tabs.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-selected'))),selected,'A vertical scroll must not change sport');
        // Finish the native fling before testing the next intentional tap.
        await page.evaluate(()=>new Promise(resolve=>{let last=scrollY,stable=0;const tick=()=>{stable=scrollY===last?stable+1:0;last=scrollY;if(stable>=8)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
      }
    }
    for(const [index,name] of ['Calendar','More','ATP','Coach'].entries()) {
      const movement=cdp?[0,7,-7,12][index]:0;
      const button=page.getByRole('tab',{name,exact:true});
      await touch(button,movement,0,true);
      const applied=await page.waitForFunction(node=>node.getAttribute('aria-selected')==='true',await button.elementHandle(),{timeout:1000}).then(()=>true,()=>false);
      results.push({engine,width,control:'Primary navigation',destination:name,movement,applied,...(!applied?{trace:await page.evaluate(()=>window.tapTrace.slice(-12))}:{})});
      if(applied) {
        await page.waitForURL('**/'+({Calendar:'calendar',More:'settings',ATP:'annual-plan',Coach:'coach'}[name]));
        await page.getByRole('tab',{name:'Home',exact:true}).tap();
        await page.locator(homeSelector).waitFor();
      }
    }
    await page.screenshot({path:path.join(output,`touch-${width}.png`)});
    if(layout)assert.equal(await page.evaluate(()=>localStorage.getItem('ar-performance:mobile-home-layout')),layout,'Navigation preserves the selected Home layout');
    await context.close();
  }
} catch(error) {
  await activePage?.screenshot({path:path.join(output,'failure.png')});
  await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,trace:await activePage?.evaluate(()=>window.tapTrace)},null,2));
  throw error;
} finally {await browser.close();await fs.writeFile(path.join(output,'result.json'),JSON.stringify({results,errors,writes},null,2));}
console.log(JSON.stringify({passed:results.filter(r=>r.applied).length,total:results.length,missed:results.filter(r=>!r.applied),errors,writes},null,2));
assert.deepEqual(errors,[]);
assert.deepEqual(writes,[]);
assert.ok(results.every(r=>r.applied),'Every deliberate tap, including small finger movement, must activate exactly its chosen control');
