// Fresh disposable fixture only: desktop-preview --calendar-edits --port=5218.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5218";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/trainingpeaks-unstructured");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless:true, channel:"msedge" });
const context = await browser.newContext({ viewport:{width:1280,height:820},colorScheme:"light" });
const page = await context.newPage(); page.setDefaultTimeout(15000);
const errors=[],checks=[],owned=[];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if(message.type()==="error") console.error(`Browser console: ${message.text()}`); });
await context.route("**/*", route => new URL(route.request().url()).origin===origin ? route.continue():route.abort());
const endpoint = value => { const url=new URL(value); return decodeURIComponent(url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//,"")); };
const button=(name,root=page)=>root.getByRole("button",{name,exact:true});
const popup=()=>page.locator(".desktop-workout-preview");
const creator=()=>page.locator(".desktop-workout-create");
const records=async()=> (await page.request.get(`${origin}/api/preview/provider-records`)).json();
const read=async id=> { const response=await page.request.get(`${origin}/api/workouts/${encodeURIComponent(id)}/editor`);assert.equal(response.ok(),true);return response.json(); };
const title=`Synthetic freeform ${Date.now()}`;
const day=new Date();day.setDate(day.getDate()+4);
const label=day.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
async function choose(sport){
  await button(`Add workout for ${label}`).press("Enter");
  await button(sport,page.locator(".calendar-add-dialog")).click();
  await creator().waitFor();
}
async function open(name){await page.getByText(name,{exact:true}).click();await popup().waitFor();await page.getByLabel("Workout title",{exact:true}).waitFor();}
async function emptyTotals(){
  for(const name of ["Planned duration","Planned distance"]) assert.equal(await page.getByLabel(name,{exact:true}).inputValue(),"",`${name} must remain unknown`);
  assert.equal(await popup().locator("[data-workout-profile], [aria-label='Planned workout profile']").count(),0,"A title-only workout cannot display an invented interval profile");
}
async function heldWrite(pathname,action,inspect){
  let start,release;const started=new Promise(resolve=>{start=resolve;});const held=new Promise(resolve=>{release=resolve;});let attempts=0;
  const matcher=url=>endpoint(url.href)===pathname;
  const handler=async route=> {if(!["POST","PUT"].includes(route.request().method()))return route.continue();attempts++;start();await held;return route.continue();};
  await page.route(matcher,handler);
  const response=page.waitForResponse(response=>["POST","PUT"].includes(response.request().method())&&endpoint(response.url())===pathname);
  await action();await started;
  try {await inspect();assert.equal(attempts,1,"A held save must issue one write");} finally {release();}
  const result=await response;assert.equal(result.ok(),true,await result.text());const data=await result.json();
  await page.unroute(matcher,handler);return data;
}
try{
  await page.goto(`${origin}/calendar?theme=light`,{waitUntil:"networkidle"});
  assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true);
  await choose("Run");
  await page.getByLabel("Workout title",{exact:true}).fill(title);
  await emptyTotals();
  assert.equal(await page.getByLabel("Workout description",{exact:true}).inputValue(),"");
  const rejectCreate=url=>endpoint(url.href)==="workouts/editor";
  const reject=route=>route.request().method()==="POST"?route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:"Synthetic title-only save rejected."})}):route.continue();
  await page.route(rejectCreate,reject);
  await button("Save & Close",creator()).click();
  await creator().getByRole("alert").filter({hasText:"Synthetic title-only save rejected."}).waitFor();
  assert.equal(await page.getByLabel("Workout title",{exact:true}).inputValue(),title);
  assert.equal((await records()).events.some(event=>event.name===title),false);
  await page.unroute(rejectCreate,reject);
  checks.push({name:"title-only-rejected-create-retains-empty-draft"});
  const created=await heldWrite("workouts/editor",()=>button("Save & Close",creator()).click(),async()=>{
    assert.equal(await creator().isVisible(),true);
    assert.equal(await button("Cancel",creator()).isDisabled(),true);
    await page.keyboard.press("Escape");assert.equal(await creator().isVisible(),true);
  });
  const id=created.workoutId;assert.match(id,/^event:[1-9]\d*$/);owned.push(id);
  await creator().waitFor({state:"hidden"});
  const initial=await read(id);
  assert.equal(initial.model.unstructured,true);assert.deepEqual(initial.model.steps,[]);assert.equal(initial.model.notes,"");
  assert.equal(initial.model.sport,"Run");
  const native=(await records()).events.find(event=>`event:${event.id}`===id);
  assert.equal(native.description,"");
  const nativeBodies=row=>Array.isArray(row.body)?row.body:[row.body];
  const creationWrites=(await records()).writes.filter(row=>row.method==="POST"&&nativeBodies(row).some(event=>event?.name===title));
  assert.equal(creationWrites.length,1);
  assert.equal(nativeBodies(creationWrites[0]).find(event=>event.name===title).description,"");
  await open(title);await emptyTotals();
  checks.push({name:"title-only-run-confirmed-empty-prose-native-write-and-readback",id});

  const renamed=`${title} renamed`;
  await page.getByLabel("Workout title",{exact:true}).fill(renamed);
  const metricPath=`workouts/${id}/planned-values`;
  const rejectMetrics=url=>endpoint(url.href)===metricPath;
  const rejectEdit=route=>route.request().method()==="PUT"?route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:"Synthetic metadata save rejected."})}):route.continue();
  await page.route(rejectMetrics,rejectEdit);
  await button("Save & Close",popup()).click();
  await popup().getByRole("alert").filter({hasText:"Synthetic metadata save rejected."}).first().waitFor();
  assert.equal(await popup().isVisible(),true);assert.equal(await page.getByLabel("Workout title",{exact:true}).inputValue(),renamed);
  assert.equal((await records()).events.find(event=>`event:${event.id}`===id).name,title);
  await page.unroute(rejectMetrics,rejectEdit);
  checks.push({name:"saved-title-only-rejected-metadata-save-keeps-popup-and-draft"});
  await heldWrite(metricPath,()=>button("Save & Close",popup()).click(),async()=>{
    assert.equal(await popup().isVisible(),true);assert.equal(await button("Cancel",popup()).isDisabled(),true);
    await page.keyboard.press("Escape");assert.equal(await popup().isVisible(),true);
  });
  await popup().waitFor({state:"hidden"});await page.reload({waitUntil:"networkidle"});await open(renamed);await emptyTotals();
  const renamedModel=(await read(id)).model;
  assert.equal(renamedModel.unstructured,true);assert.equal(renamedModel.name,renamed);assert.equal(renamedModel.date,day.toLocaleDateString("en-CA"));
  checks.push({name:"saved-title-only-save-close-awaits-confirmed-metadata-and-reloads"});

  await button("Export workout",popup()).click();
  const exportDialog=page.getByRole("dialog",{name:"Export workout",exact:true});
  const format=exportDialog.getByLabel("Workout export format",{exact:true});
  assert.equal(await format.inputValue(),"txt");
  for(const value of ["fit","zwo","mrc","erg"])assert.equal(await format.locator(`option[value="${value}"]`).evaluate(option=>option.disabled),true,`${value} must be disabled for a no-step workout`);
  const download=page.waitForEvent("download");await button("Download",exportDialog).click();
  const file=await download;assert.equal(await file.failure(),null);const text=await fs.readFile(await file.path(),"utf8");assert.match(text,new RegExp(renamed));
  assert.doesNotMatch(text,/Workout editor v1|"steps":|"version":1/);
  checks.push({name:"unstructured-text-download-with-device-formats-disabled"});

  await button("Build Workout",popup()).click();
  const builder=page.locator(".we-tp-desktop");await builder.waitFor();
  if(await button("Continue",builder).count())await button("Continue",builder).click();
  assert.equal(await button("Save",builder).isDisabled(),true);
  assert.equal(await button("Export workout",builder).isDisabled(),true);
  assert.equal(await builder.locator(".dtb-step-card").count(),0);
  if(!await button("Save & Close",builder).isDisabled()){
    // An unchanged existing builder can close without a save. It must never
    // manufacture an empty structured prescription or issue a provider write.
    const beforeClose=(await records()).writes.length;
    await button("Save & Close",builder).click();await builder.waitFor({state:"hidden"});
    assert.equal((await records()).writes.length,beforeClose);
    assert.equal((await read(id)).model.unstructured,true);
    if(!await popup().count())await open(renamed);
    await button("Build Workout",popup()).click();await builder.waitFor();
    if(await button("Continue",builder).count())await button("Continue",builder).click();
  }
  await button("Add Active",builder).click();
  await builder.locator(".dtb-step-card").first().waitFor();
  assert.equal(await button("Save",builder).isDisabled(),false);
  const structuredSaved=page.waitForResponse(response=>response.request().method()==="PUT"&&endpoint(response.url())===`workouts/${id}/editor`);
  await button("Save & Close",builder).click();assert.equal((await structuredSaved).ok(),true);
  await page.locator(".desktop-workout-preview, .we-tp-desktop").waitFor({state:"hidden"});
  const structured=await read(id);assert.notEqual(structured.model.unstructured,true);assert.equal(structured.model.steps.length,1);
  await open(renamed);assert.notEqual(await page.getByLabel("Planned duration",{exact:true}).inputValue(),"");
  await page.screenshot({path:path.join(output,"structured-after-title-only.png"),animations:"disabled"});
  await button("Cancel",popup()).click();
  checks.push({name:"empty-builder-stays-invalid-and-adding-real-step-removes-unstructured-flag"});

  await choose("Day off");const offTitle=`${title} rest`;
  await page.getByLabel("Workout title",{exact:true}).fill(offTitle);
  assert.equal(await creator().getByLabel("Workout sport",{exact:true}).inputValue(),"variant:day-off");
  const offSaved=page.waitForResponse(response=>response.request().method()==="POST"&&endpoint(response.url())==="workouts/editor");
  await button("Save & Close",creator()).click();const offData=await(await offSaved).json();owned.push(offData.workoutId);
  await creator().waitFor({state:"hidden"});await page.reload({waitUntil:"networkidle"});await open(offTitle);
  const off=await read(offData.workoutId);assert.equal(off.model.sport,"Other");assert.equal(off.model.variant,"day-off");assert.equal(off.model.unstructured,true);assert.deepEqual(off.model.steps,[]);
  assert.equal(await popup().getByText("Day off",{exact:true}).count()>0,true);
  assert.equal((await records()).events.find(event=>`event:${event.id}`===offData.workoutId).description,"");
  assert.equal(await page.getByLabel("Planned duration",{exact:true}).inputValue(),"","Day off must preserve absent duration");
  assert.equal(await page.getByLabel("Planned distance",{exact:true}).count(),0,"Day off retains its observed duration-only planned rows");
  await page.screenshot({path:path.join(output,"day-off-empty.png"),animations:"disabled"});
  await button("Cancel",popup()).click();
  checks.push({name:"title-only-day-off-private-variant-survives-full-reload-with-empty-native-description"});

  for(const row of (await records()).writes){const bodies=Array.isArray(row.body)?row.body:[row.body];for(const body of bodies)if(typeof body?.description==="string")assert.doesNotMatch(body.description,/Workout editor v1|training-agent-(?:manual-description|planned-values|workout-comments)-v1|"duration_seconds":|"version":1/);}
  assert.deepEqual(errors,[]);
  for(const key of owned){const response=await page.request.delete(`${origin}/api/workouts/${encodeURIComponent(key)}`);assert.equal(response.ok(),true);}
  assert.equal((await records()).events.some(event=>owned.includes(`event:${event.id}`)),false);
  checks.push({name:"clean-human-provider-prose-owned-record-cleanup-and-no-runtime-errors"});
  const result={passed:checks.length,errors,checks};await fs.writeFile(path.join(output,"results.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await page.screenshot({path:path.join(output,"failure.png"),fullPage:true}).catch(()=>{});console.error(JSON.stringify({checks,errors},null,2));throw error;}finally{await browser.close();}
