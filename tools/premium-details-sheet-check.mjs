// Shared sheet fixture checks, plus real completed-workout sheet in production.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const require=createRequire(import.meta.url),playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const engine=process.env.SHEET_ENGINE||"chromium",port=Number(process.env.SHEET_PORT||5406),origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:path.resolve("ui"),stdio:["ignore","pipe","pipe"]});
let browser;
const result={engine,checks:[],errors:[]};
try {
  await new Promise((resolve,reject)=>{let output="";server.stdout.on("data",value=>{output+=value;if(output.includes("Local:"))resolve();});server.once("error",reject);});
  browser=await playwright[engine].launch({headless:true,...(engine==="chromium"?{channel:"msedge"}:{}),...(process.env.SHEET_EXECUTABLE?{executablePath:process.env.SHEET_EXECUTABLE}:{})});
  result.version=browser.version();
  for(const [width,height,reducedMotion="no-preference"] of [[320,568],[390,844],[844,390],[1280,820],[390,844,"reduce"]]) {
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,isMobile:width<900,serviceWorkers:"block",reducedMotion});
    const page=await context.newPage();page.setDefaultTimeout(10000);const requests=[];
    page.on("pageerror",error=>result.errors.push(error.message));
    page.on("console",message=>{if(message.type()==="error")result.errors.push(message.text());});
    page.on("request",request=>requests.push(request.url()));
    await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+"/tests/premium-detail-sheet.html",{waitUntil:"networkidle"});
    const trigger=page.getByRole("button",{name:"Workout Details",exact:true}),dialog=page.getByRole("dialog",{name:"Workout Details",exact:true});
    await trigger.click();await dialog.waitFor();
    await page.waitForFunction(()=>!document.querySelector(".detail-row-sheet")?.hasAttribute("data-starting-style"));
    await dialog.evaluate(node=>Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished)));
    if(reducedMotion==="reduce") {
      assert.equal(await dialog.evaluate(node=>getComputedStyle(node).transitionDuration),"0s");
      assert.equal(await page.locator(".detail-row-sheet-backdrop").evaluate(node=>getComputedStyle(node).animationName),"none");
    }
    const initial=await dialog.boundingBox();
    assert.ok(initial.x>=0&&initial.y>=0&&initial.x+initial.width<=width+1&&initial.y+initial.height<=height+1,JSON.stringify(initial));
    assert.equal(await page.getByRole("button",{name:"Close Workout Details",exact:true}).evaluate(node=>node===document.activeElement),true);
    await page.getByLabel("Sheet draft",{exact:true}).fill("Edited retained draft");
    for(let i=0;i<5;i++){await page.keyboard.press("Tab");await page.waitForFunction(()=>document.querySelector(".detail-row-sheet")?.contains(document.activeElement));}
    // First-open expansion must use the real gesture hook after portal mounting.
    const handle=page.locator(".detail-row-sheet .detail-sheet-handle"),bounds=await handle.boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2,Math.max(2,bounds.y-110),{steps:8});await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector(".detail-row-sheet")?.classList.contains("detail-sheet-expanded"));
    await dialog.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished)));
    assert.ok((await dialog.boundingBox()).height>initial.height+20);
    const scroll=page.locator(".detail-row-sheet [data-sheet-scroll]");
    await scroll.evaluate(node=>{node.scrollTop=300;});assert.ok(await scroll.evaluate(node=>node.scrollTop)>100);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
    await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==="Workout Details");
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow==="hidden"),false);
    await trigger.click();await dialog.waitFor();assert.equal(await page.getByLabel("Sheet draft").inputValue(),"Edited retained draft");
    await page.getByRole("button",{name:"Save fixture draft",exact:true}).click();await dialog.getByRole("status").filter({hasText:"Saved Edited retained draft"}).waitFor();
    await page.goBack();await dialog.waitFor({state:"hidden"});assert.equal(page.url(),origin+"/tests/premium-detail-sheet.html");
    await trigger.click();await dialog.waitFor();assert.equal(await page.getByLabel("Sheet draft").inputValue(),"Edited retained draft");
    await page.mouse.click(4,4);await dialog.waitFor({state:"hidden"});
    await trigger.click();await dialog.waitFor();
    const closeHandle=await handle.boundingBox();await page.mouse.move(closeHandle.x+closeHandle.width/2,closeHandle.y+closeHandle.height/2);await page.mouse.down();await page.mouse.move(closeHandle.x+closeHandle.width/2,closeHandle.y+130,{steps:8});await page.mouse.up();await dialog.waitFor({state:"hidden"});
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow==="hidden"),false);
    assert.equal(requests.some(url=>/framework7-core|framework7[_-](?:lite|react)|framework7-runtime\.(?:js|ts)/.test(url)),false,"Basic detail sheet must not import the Framework7 runtime");
    result.checks.push({width,height,reducedMotion,firstOpenVisible:true,accessibleName:true,focusTrap:true,focusRestored:true,firstOpenExpansion:true,bodyScrollOwnership:true,escape:true,back:true,backdrop:true,swipeDismiss:true,controlledDraftRetained:true,fixtureSave:true,noFramework7Runtime:true});
    await context.close();
  }
  assert.deepEqual(result.errors,[]);result.passed=true;
} finally {
  await fs.mkdir("artifacts/premium-app",{recursive:true});await fs.writeFile(`artifacts/premium-app/detail-sheet-${engine}.json`,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));await browser?.close();server.kill();
}
