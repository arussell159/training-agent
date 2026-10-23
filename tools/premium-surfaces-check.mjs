// Real shared controls in isolation; no auth, backend, or provider writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const port=Number(process.env.SURFACES_PORT||5498),origin=`http://127.0.0.1:${port}`;
const engine=process.env.SURFACES_ENGINE||'chromium';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:path.resolve('ui'),stdio:['ignore','pipe','pipe']});
let browser; const results=[];
try {
  await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',x=>{output+=x;if(output.includes('Local:'))resolve()});server.on('error',reject);server.on('exit',code=>reject(Error(`Server exited ${code}: ${output}`)))});
  browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{channel:'msedge'}:{}),...(process.env.SURFACES_EXECUTABLE?{executablePath:process.env.SURFACES_EXECUTABLE}:{})});
  for(const [width,height] of [[320,568],[390,844],[430,932],[844,390],[1280,820]]) for(const reducedMotion of ['reduce','no-preference']) {
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,reducedMotion});
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/tests/premium-surfaces.html',{waitUntil:'networkidle'});
    const trigger=page.getByRole('button',{name:'Edit draft',exact:true});
    await trigger.click();const dialog=page.getByRole('dialog',{name:'Edit workout'});await dialog.waitFor();
    const bounds=await dialog.boundingBox();
    assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,JSON.stringify({width,height,bounds}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const title=page.getByRole('textbox',{name:'Workout title'});await title.fill('Preserved draft');
    for(let i=0;i<7;i++){
      await page.keyboard.press('Tab');
      // Base UI's focus sentinel redirects on the next microtask/frame.
      await page.waitForFunction(()=>document.querySelector('[data-slot="dialog-content"]')?.contains(document.activeElement),{},{timeout:1000});
      assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true,'focus must stay inside the modal');
    }
    await page.getByRole('button',{name:'Cancel edit'}).click();await dialog.waitFor({state:'hidden'});
    assert.equal(await trigger.evaluate(e=>e===document.activeElement),true,'restore focus to opener');
    await trigger.click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    const alertTrigger=page.getByRole('button',{name:'Delete fixture',exact:true});await alertTrigger.click();const alert=page.getByRole('alertdialog');await alert.waitFor();
    const alertBounds=await alert.boundingBox();assert.ok(alertBounds.x>=0&&alertBounds.x+alertBounds.width<=width+1);
    if(width<768) {
      await alert.evaluate(e=>Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished)));
      for(const button of await alert.getByRole('button').all()) assert.ok((await button.boundingBox()).height>=44,JSON.stringify({width,height,reducedMotion,...await button.evaluate(e=>({html:e.outerHTML,height:e.getBoundingClientRect().height,minHeight:getComputedStyle(e).minHeight}))}));
    }
    await page.getByRole('button',{name:'Keep workout'}).click();await alert.waitFor({state:'hidden'});
    assert.equal(await alertTrigger.evaluate(e=>e===document.activeElement),true);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow==='hidden'),false,'body unlocked after dismissal');
    assert.deepEqual(errors,[]);
    results.push({width,height,reducedMotion,bounds,alertBounds,focusTrap:true,focusRestored:true,escape:true,bodyUnlocked:true,errors});
    await context.close();
  }
  await fs.mkdir('artifacts/premium-app',{recursive:true});
  await fs.writeFile(`artifacts/premium-app/surfaces-${engine}.json`,JSON.stringify({engine,version:browser.version(),results},null,2));
  console.log(JSON.stringify({engine,checks:results.length,passed:true}));
} finally {await browser?.close();server.kill()}
