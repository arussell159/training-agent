// Actual native Event card deletion against disposable localhost state only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {browserNetworkEvidence} from "./browser-network-evidence.mjs";
const require=createRequire(import.meta.url);let playwright;
try{playwright=require("playwright");}catch{playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const origin=process.env.APP_TEST_ORIGIN||"http://127.0.0.1:5213";assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const output=path.resolve("artifacts/trainingpeaks-race-delete");await fs.mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({channel:"msedge",headless:true}),context=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light",locale:"en-US"});
const network=browserNetworkEvidence();network.attach(context);await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const page=await context.newPage();page.setDefaultTimeout(15000);const checks=[],errors=[],readbacks=[];let attempts=0;
page.on("pageerror",error=>errors.push(error.message));
const api=input=>{const url=new URL(input);return url.searchParams.get("__api_route")||url.pathname.replace(/^\/api\//,"");};
async function json(route,options={}){const response=await page.request.fetch(origin+"/api/"+route,options),body=await response.json();assert.equal(response.ok(),true,JSON.stringify(body));readbacks.push({route,body});return body;}
const records=()=>json("preview/provider-records");
try{
  await page.goto(origin+"/calendar?theme=light",{waitUntil:"networkidle"});assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true);
  const now=new Date();now.setDate(now.getDate()+2);const date=now.toLocaleDateString("en-CA"),title=`Native Event deletion ${Date.now()}`;
  const fields={name:title,date,priority:"",eventType:"RunningRoad",raceDistance:"5000",atpEventType:"",description:"Keep this real native Event unchanged after cancellation and rejected deletion.",goals:{time:"",distance:"",distanceUnit:"mi",place:"",finish:false,setPr:false,custom:["Preserve this exact goal until verified deletion"]}};
  const created=await json("race-events",{method:"POST",data:{...fields,creationId:randomUUID()}}),id=created.event.id;
  assert.equal(created.verified,true);assert.match(id,/^event:[1-9]\d*$/);const plans=await json("annual-plans");assert.equal(plans.plans.some(plan=>plan.events?.some(event=>event.id===id)),false,"This regression must exercise the native Event path outside an ATP plan");
  const original=await json(`race-events/${encodeURIComponent(id)}`),before=await records(),nativeId=Number(id.slice(6));assert.ok(before.events.some(event=>event.id===nativeId));
  await page.reload({waitUntil:"networkidle"});const day=page.locator(`[data-calendar-date="${date}"]`);await day.scrollIntoViewIfNeeded();
  const card=()=>page.locator(".calendar-race-card").filter({hasText:title});await card().waitFor();
  async function confirm(){await card().getByRole("button",{name:`Calendar entry actions: ${title}`,exact:true}).click();await page.getByRole("menuitem",{name:"Delete",exact:true}).click();await page.getByRole("alertdialog",{name:"Delete race?",exact:true}).waitFor();}
  const dialog=()=>page.getByRole("alertdialog",{name:"Delete race?",exact:true});
  let reject=true,started,release;const held=new Promise(resolve=>{release=resolve;}),intercepted=new Promise(resolve=>{started=resolve;});
  await page.route(url=>api(url.href)===`workouts/${encodeURIComponent(id)}`,async route=>{
    if(route.request().method()!=="DELETE")return route.continue();attempts++;
    if(reject){reject=false;return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:"Synthetic native Event deletion rejected"})});}
    started();await held;return route.continue();
  });
  await confirm();await dialog().getByRole("button",{name:"Cancel",exact:true}).click();await dialog().waitFor({state:"hidden"});assert.equal(attempts,0);assert.equal(await card().count(),1);assert.deepEqual((await records()).writes,before.writes);assert.deepEqual((await json(`race-events/${encodeURIComponent(id)}`)).event,original.event);checks.push("actual-native-event-delete-cancel-sends-no-http-and-retains-exact-native-private-card");
  await confirm();await dialog().getByRole("button",{name:"Delete race",exact:true}).click();await dialog().getByRole("alert").filter({hasText:"Synthetic native Event deletion rejected"}).waitFor();assert.equal(attempts,1);assert.equal(await card().count(),1);assert.deepEqual((await records()).writes,before.writes);assert.deepEqual((await json(`race-events/${encodeURIComponent(id)}`)).event,original.event);assert.equal(await dialog().getByRole("button",{name:"Delete race",exact:true}).isEnabled(),true);checks.push("actual400-retains-confirmation-error-and-same-native-event-without-provisional-card-removal");
  await dialog().getByRole("button",{name:"Delete race",exact:true}).click();await intercepted;assert.equal(attempts,2);assert.equal(await card().count(),1);assert.equal(await dialog().getByRole("button",{name:"Cancel",exact:true}).isDisabled(),true);assert.equal(await dialog().getByRole("button",{name:"Deleting…",exact:true}).isDisabled(),true);await page.keyboard.press("Enter");await page.keyboard.press("Control+s");await page.keyboard.press("Escape");assert.equal(await dialog().isVisible(),true);assert.equal(attempts,2);assert.deepEqual((await records()).writes,before.writes);release();await dialog().waitFor({state:"hidden"});await card().waitFor({state:"hidden"});
  const after=await records();assert.equal(after.events.some(event=>event.id===nativeId),false);assert.deepEqual(after.events.map(event=>event.id).sort(),before.events.filter(event=>event.id!==nativeId).map(event=>event.id).sort());assert.equal(after.writes.filter(write=>write.method==="DELETE"&&write.path.endsWith(`/events/${nativeId}`)).length,1);const missing=await page.request.get(origin+`/api/race-events/${encodeURIComponent(id)}`);assert.equal(missing.status(),404);checks.push("held-explicit-retry-blocks-duplicate-dismissal-and-only-one-confirmed-native-delete-removes-the-exact-card");
  assert.deepEqual(errors,[]);assert.deepEqual(network.entries.filter(entry=>entry.kind==="request-failed"||entry.kind==="page-error"||entry.kind==="http-error"&&!(entry.method==="DELETE"&&entry.status===400)||entry.kind==="console-error"&&!/Failed to load resource: the server responded with a status of 400\b/.test(entry.text)),[]);await page.screenshot({path:path.join(output,"verified-native-event-delete.png"),animations:"disabled"});
}catch(error){process.exitCode=1;errors.push(error.stack||error.message);console.error(error.message);await fs.writeFile(path.join(output,"failure-dom.txt"),await page.locator("body").innerText()).catch(()=>{});await fs.writeFile(path.join(output,"failure-accessibility.txt"),await page.locator("body").ariaSnapshot()).catch(()=>{});await page.screenshot({path:path.join(output,"failure.png"),animations:"disabled"}).catch(()=>{});}
finally{const evidence=structuredClone(network.entries);await browser.close();await fs.writeFile(path.join(output,"results.json"),JSON.stringify({synthetic:true,referenceParityClaim:false,passed:checks.length,checks,errors,deleteAttempts:attempts},null,2));await fs.writeFile(path.join(output,"network.json"),JSON.stringify(evidence,null,2));await fs.writeFile(path.join(output,"readbacks.json"),JSON.stringify(readbacks,null,2));console.log(JSON.stringify({passed:checks.length,errors:errors.length,deleteAttempts:attempts}));}
