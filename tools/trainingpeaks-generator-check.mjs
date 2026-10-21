// Disposable synthetic preview only: desktop-preview --calendar-edits --port=5217.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);let playwright;
try{playwright=require("playwright");}catch{playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const origin=process.env.APP_TEST_ORIGIN||"http://127.0.0.1:5217";
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const output=path.resolve("artifacts/trainingpeaks-generator");await fs.mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({headless:true,channel:"msedge"});
const context=await browser.newContext({viewport:{width:1280,height:720},colorScheme:"light"});
const page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[],checks=[],generationRequests=[];page.on("pageerror",error=>errors.push(error.message));
await context.route("**/*",async route=>{
  try{await(new URL(route.request().url()).origin===origin?route.continue():route.abort());}
  catch(error){if(!String(error.message).includes("Route is already handled"))throw error;}
});
const endpoint=value=>{const url=new URL(value);return decodeURIComponent(url.searchParams.get("__api_route")||url.pathname.replace(/^\/api\//,""));};
page.on("request",request=>{if(request.method()==="POST"&&endpoint(request.url())==="workouts/generate")generationRequests.push(request.postDataJSON());});
const dialog=()=>page.getByRole("dialog",{name:"Workout Generator",exact:true});
const button=(name,root=page)=>root.getByRole("button",{name,exact:true});
const builder=()=>page.locator(".we-tp-desktop");
const records=async()=>(await page.request.get(`${origin}/api/preview/provider-records`)).json();
const day=new Date();day.setDate(day.getDate()+4);const date=day.toLocaleDateString("en-CA");
const label=day.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
async function open(){await button(`Add workout for ${label}`).press("Enter");await button("Workout Generator",page.locator(".calendar-add-dialog")).click();await dialog().waitFor();}
async function discard(){await button("Cancel",builder()).click();await page.getByRole("alertdialog").getByRole("button",{name:"Discard changes",exact:true}).click();await builder().waitFor({state:"hidden"});assert.equal(await page.locator(".desktop-workout-create").count(),0);}
const prompt="5 min warm up, 3 x 2 min hard with 1 min recovery, 5 min cool down";
try{
  await page.goto(`${origin}/calendar?theme=light`,{waitUntil:"networkidle"});assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true);
  const original=await records();await open();
  assert.equal(await button("Build workout",dialog()).isDisabled(),true);
  assert.deepEqual(await dialog().getByLabel("Sport Type",{exact:true}).locator("option").allTextContents(),["Run","Bike","Swim","Brick","Crosstrain","Day off","Mtn Bike","Strength","Custom","XC-Ski","Rowing","Walk","Other"]);
  assert.equal(await dialog().getByLabel("Intensity",{exact:true}).locator("option").count(),5);
  assert.equal(await dialog().getByRole("radio",{name:"Duration",exact:true}).isChecked(),true);assert.equal(await dialog().getByRole("radio",{name:"Range",exact:true}).isChecked(),true);
  await dialog().getByLabel("Workout Prompt",{exact:true}).fill("x".repeat(1000));await dialog().getByText("1000/1000",{exact:true}).waitFor();assert.equal(await dialog().getByLabel("Workout Prompt",{exact:true}).getAttribute("maxlength"),"1000");
  await dialog().getByLabel("Workout Prompt",{exact:true}).fill(prompt);
  await page.screenshot({path:path.join(output,"generator-prompt.png"),animations:"disabled"});
  checks.push("observed-options-required-prompt-thousand-character-counter-and-keyboard-fields");

  let release,start;const held=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{start=resolve;});let attempts=0;
  const matcher=url=>endpoint(url.href)==="workouts/generate";
  const hold=async route=>{attempts++;start();await held;await route.continue().catch(()=>{});};
  await page.route(matcher,hold);await button("Build workout",dialog()).click();await entered;
  assert.equal(await dialog().getByLabel("Workout Prompt",{exact:true}).isDisabled(),true);assert.equal(await dialog().getByLabel("Sport Type",{exact:true}).isDisabled(),true);assert.equal(await button("Generating workout…",dialog()).isDisabled(),true);
  await button("Close workout generator",dialog()).click();await dialog().waitFor({state:"hidden"});release();await page.unroute(matcher,hold);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(attempts,1);assert.equal(await builder().count(),0);assert.equal((await records()).writes.length,original.writes.length);
  checks.push("held-generation-close-aborts-one-request-and-cannot-open-late-builder-or-write-calendar");

  await open();await dialog().getByLabel("Workout Prompt",{exact:true}).fill(prompt);
  const reject=route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic generator unavailable; prompt retained."})});
  await page.route(matcher,reject);await button("Build workout",dialog()).click();await dialog().getByRole("alert").filter({hasText:"Synthetic generator unavailable; prompt retained."}).waitFor();await page.unroute(matcher,reject);
  assert.equal(await dialog().getByLabel("Workout Prompt",{exact:true}).inputValue(),prompt);assert.equal(await button("Build workout",dialog()).isDisabled(),false);assert.equal((await records()).writes.length,original.writes.length);
  checks.push("generation-failure-retains-editable-prompt-with-no-calendar-write-or-automatic-retry");
  const malformed=route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({generated:true,saved:false,model:{date,sport:"Run",steps:[]},warnings:[]})});
  await page.route(matcher,malformed);await button("Build workout",dialog()).click();await dialog().getByRole("alert").filter({hasText:/incomplete or did not match/}).waitFor();await page.unroute(matcher,malformed);
  assert.equal(await dialog().getByLabel("Workout Prompt",{exact:true}).inputValue(),prompt);assert.equal(await builder().count(),0);assert.equal((await records()).writes.length,original.writes.length);
  checks.push("malformed-model-response-retains-editable-prompt-and-never-opens-or-saves-a-workout");

  const generated=page.waitForResponse(response=>response.request().method()==="POST"&&endpoint(response.url())==="workouts/generate");await button("Build workout",dialog()).click();const generatedBody=await(await generated).json();
  assert.equal(generatedBody.generated,true);assert.equal(generatedBody.saved,false);assert.equal(generatedBody.model.date,date);assert.equal(generatedBody.model.steps[1].kind,"repeat");assert.equal(generatedBody.model.steps[1].repetitions,3);
  await builder().locator(".dtb-step-card").first().waitFor();assert.equal(await builder().locator(".dtb-step-card").count()>0,true);assert.equal((await records()).writes.length,original.writes.length);
  assert.equal(await button("Save",builder()).isDisabled(),false);await discard();assert.equal((await records()).events.length,original.events.length);
  checks.push("real-adapter-generation-opens-editable-unsaved-repeat-builder-and-discard-makes-no-calendar-record");

  await open();await dialog().getByLabel("Intensity",{exact:true}).selectOption("RPE");await dialog().getByLabel("Workout Prompt",{exact:true}).fill("5 minutes easy RPE 2, 3 x 2 minutes RPE 6 with 1 minute RPE 2 recovery, 5 minutes RPE 2 cool down");
  const rpeResponse=page.waitForResponse(response=>response.request().method()==="POST"&&endpoint(response.url())==="workouts/generate");await button("Build workout",dialog()).click();const rpeHttp=await rpeResponse;assert.equal(rpeHttp.ok(),true);const rpe=await rpeHttp.json();
  const flatten=steps=>steps.flatMap(step=>step.kind==="repeat"?flatten(step.steps):[step]);
  const rpeSteps=flatten(rpe.model.steps);assert.ok(rpeSteps.some(step=>step.target.kind==="rpe"));
  for(const step of rpeSteps){assert.ok(["rpe","none"].includes(step.target.kind));if(step.target.kind==="rpe"){assert.equal(step.target.unit,"rpe");for(const key of step.target.mode==="range"?["start","end"]:["value"])assert.ok(Number.isInteger(step.target[key])&&step.target[key]>=1&&step.target[key]<=10);}}
  await builder().waitFor();assert.equal(await builder().getByLabel("Workout target units",{exact:true}).inputValue(),"rpe");
  assert.deepEqual(await builder().locator(".dtb-chart-axis span").allTextContents(),["0","3","5","8","10"]);
  await builder().getByText(/Intervals.icu does not support numeric RPE device targets/).waitFor();
  const rpeFirst=builder().locator(".dtb-step-card").first();
  for(const [typed,expected] of [["0","1"],["-1","1"],["10.5","10"],["11","10"],["6.5","7"]]){
    await rpeFirst.getByLabel("Range from",{exact:true}).fill(typed);await rpeFirst.getByLabel("Range from",{exact:true}).press("Tab");assert.equal(await rpeFirst.getByLabel("Range from",{exact:true}).inputValue(),expected);
  }
  await button("Add Active",builder()).click();const addedRpe=builder().locator(".dtb-step-card").last();
  assert.equal(await addedRpe.getByLabel("Range from",{exact:true}).inputValue(),"1");assert.equal(await addedRpe.getByLabel("Range to",{exact:true}).inputValue(),"8");assert.equal(await addedRpe.getByLabel("Step duration",{exact:true}).inputValue(),"00:10:00");
  await button("Export workout",builder()).click();const rpeExport=page.getByRole("dialog",{name:"Export workout",exact:true});
  assert.equal(await rpeExport.getByLabel("Workout export format",{exact:true}).inputValue(),"txt");for(const format of ["fit","zwo","mrc","erg"])assert.equal(await rpeExport.locator(`option[value="${format}"]`).evaluate(option=>option.disabled),true);
  const rpeDownload=page.waitForEvent("download");await button("Download",rpeExport).click();const rpeFile=await rpeDownload;assert.equal(await rpeFile.failure(),null);assert.match(await fs.readFile(await rpeFile.path(),"utf8"),/RPE 7-10/);
  await page.screenshot({path:path.join(output,"generated-rpe-unsaved.png"),animations:"disabled"});
  assert.equal((await records()).writes.length,original.writes.length);
  const rpeName=`Synthetic RPE review ${Date.now()}`;await builder().getByLabel("Workout title",{exact:true}).fill(rpeName);
  const rpeSavedResponse=page.waitForResponse(response=>response.request().method()==="POST"&&endpoint(response.url())==="workouts/editor");await button("Save & Close",builder()).click();const rpeSaved=await(await rpeSavedResponse).json();assert.equal(rpeSaved.verified,true);await builder().waitFor({state:"hidden"});
  const rpeNative=(await records()).events.find(event=>`event:${event.id}`===rpeSaved.workoutId);assert.match(rpeNative.description,/RPE 7-10/);assert.doesNotMatch(rpeNative.description,/Workout editor v1|"model":|"steps":/);
  const nativeTargets=steps=>{for(const step of steps){for(const key of ["power","hr","pace"])assert.equal(step[key],undefined);if(step.steps)nativeTargets(step.steps);}};assert.ok(Array.isArray(rpeNative.workout_doc.steps));nativeTargets(rpeNative.workout_doc.steps);
  await page.reload({waitUntil:"networkidle"});await page.getByText(rpeName,{exact:true}).click();
  const rpeRead=await(await page.request.get(`${origin}/api/workouts/${encodeURIComponent(rpeSaved.workoutId)}/editor`)).json();assert.deepEqual(rpeRead.model.steps[0].target,{kind:"rpe",unit:"rpe",mode:"range",start:7,end:10});assert.equal(rpeRead.model.steps.at(-1).target.kind,"rpe");
  await button("Workout actions",page.locator(".desktop-workout-preview")).click();await page.locator(".desktop-workout-toolbar-popover").getByRole("button",{name:/Edit workout/i}).click();await builder().waitFor();
  assert.equal(await builder().getByLabel("Workout target units",{exact:true}).inputValue(),"rpe");assert.equal(await builder().locator(".dtb-step-card").first().getByLabel("Range from",{exact:true}).inputValue(),"7");await button("Cancel",builder()).click();await builder().waitFor({state:"hidden"});
  await button("Cancel",page.locator(".desktop-workout-preview")).click();assert.equal((await page.request.delete(`${origin}/api/workouts/${encodeURIComponent(rpeSaved.workoutId)}`)).ok(),true);assert.equal((await records()).events.length,original.events.length);
  checks.push("numeric-rpe-axis-blur-clamps-palette-text-only-export-explicit-save-native-cues-and-reload");

  const beforeDistanceWrites=(await records()).writes.length;
  await open();await dialog().getByLabel("Sport Type",{exact:true}).selectOption("variant:brick");await dialog().getByRole("radio",{name:"Distance",exact:true}).check();await dialog().getByRole("radio",{name:"Target",exact:true}).check();await dialog().getByLabel("Workout Prompt",{exact:true}).fill("Run 1000m warm up, 3 x 400m hard with 200m easy, 1000m cool down");
  const distanceResponse=page.waitForResponse(response=>response.request().method()==="POST"&&endpoint(response.url())==="workouts/generate");await button("Build workout",dialog()).click();const distance=await(await distanceResponse).json();assert.equal(distance.model.sport,"Other");assert.equal(distance.model.variant,"brick");assert.equal(distance.model.steps[0].end.kind,"distance");
  await builder().waitFor();assert.equal((await records()).writes.length,beforeDistanceWrites);
  const name=`Synthetic generated review ${Date.now()}`;await builder().getByLabel("Workout title",{exact:true}).fill(name);
  let releaseSave,enteredSave;const heldSave=new Promise(resolve=>{releaseSave=resolve;});const saveEntered=new Promise(resolve=>{enteredSave=resolve;});let saves=0;
  const saveMatcher=url=>endpoint(url.href)==="workouts/editor";
  const holdSave=async route=>{if(route.request().method()!=="POST")return route.continue();saves++;enteredSave();await heldSave;return route.continue();};
  await page.route(saveMatcher,holdSave);const saved=page.waitForResponse(response=>response.request().method()==="POST"&&endpoint(response.url())==="workouts/editor");await button("Save & Close",builder()).click();await saveEntered;
  assert.equal(await builder().isVisible(),true);assert.equal(await button("Cancel",builder()).isDisabled(),true);releaseSave();const saveBody=await(await saved).json();await page.unroute(saveMatcher,holdSave);assert.equal(saveBody.verified,true);assert.equal(saves,1);
  await page.locator(".desktop-workout-create,.we-tp-desktop").waitFor({state:"hidden"});
  const native=(await records()).events.find(event=>`event:${event.id}`===saveBody.workoutId);assert.equal(native.name,name);assert.equal(native.type,"Other");assert.doesNotMatch(native.description,/Workout editor v1|"version":1|"model":|"steps":|"warnings":/);
  await page.reload({waitUntil:"networkidle"});await page.getByText(name,{exact:true}).click();const model=await(await page.request.get(`${origin}/api/workouts/${encodeURIComponent(saveBody.workoutId)}/editor`)).json();assert.equal(model.model.name,name);assert.equal(model.model.variant,"brick");assert.equal(model.model.steps[0].end.kind,"distance");
  await page.screenshot({path:path.join(output,"generated-reviewed-saved.png"),animations:"disabled"});
  const removed=await page.request.delete(`${origin}/api/workouts/${encodeURIComponent(saveBody.workoutId)}`);assert.equal(removed.ok(),true);assert.equal((await records()).events.length,original.events.length);
  checks.push("distance-target-private-variant-review-explicit-held-save-native-prose-and-reload-persistence");
  assert.deepEqual(errors,[]);checks.push("no-runtime-errors-and-only-owned-record-created-then-removed");
  const result={passed:checks.length,checks,errors,generationRequests};await fs.writeFile(path.join(output,"results.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await page.screenshot({path:path.join(output,"failure.png"),animations:"disabled"}).catch(()=>{});console.error(JSON.stringify({checks,errors,generationRequests},null,2));throw error;}finally{await browser.close();}
