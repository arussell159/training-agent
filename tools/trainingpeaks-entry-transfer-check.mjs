// Actual clipboard menus against disposable localhost data; no visual parity claim.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {browserNetworkEvidence} from "./browser-network-evidence.mjs";
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require("playwright");}
catch {playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const origin=process.env.APP_TEST_ORIGIN||"http://127.0.0.1:5212";
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname),"Synthetic localhost only");
const output=path.resolve("artifacts/trainingpeaks-entry-transfer");await fs.mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light",locale:"en-US"});
const network=browserNetworkEvidence();network.attach(context);
const page=await context.newPage();page.setDefaultTimeout(15000);
const checks=[],errors=[],attempts=[];let permissionsId;
page.on("pageerror",error=>errors.push(error.message));
await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const endpoint=value=>{const url=new URL(value);return url.searchParams.get("__api_route")||url.pathname.replace(/^\/api\//,"");};
const transferRequest=request=>request.method()==="POST"&&endpoint(request.url()).startsWith("calendar/entry-transfer/");
const transferUrl=url=>endpoint(url.href).startsWith("calendar/entry-transfer/");
page.on("request",request=>{if(transferRequest(request))attempts.push({path:endpoint(request.url()),body:request.postDataJSON()});});
const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toLocaleDateString("en-CA");};
const longDate=date=>new Date(`${date}T12:00:00`).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
const cell=date=>page.locator(`[data-calendar-date="${date}"]`);
const fetchJson=async(url,options={})=>{const response=await page.request.fetch(`${origin}/api/${url}`,options);const body=await response.json();assert.equal(response.ok(),true,`${options.method||"GET"} ${url}: ${JSON.stringify(body)}`);return body;};
const records=()=>fetchJson("preview/provider-records");
const nativePosts=data=>data.writes.filter(row=>row.method==="POST"&&/\/events$/.test(row.path));
const annotation=id=>fetchJson(`calendar/annotations/${encodeURIComponent(id)}`);
const event=async id=>(await fetchJson(`race-events/${encodeURIComponent(id)}`)).event;
const createAnnotation=async entry=>(await fetchJson("calendar/annotations",{method:"POST",data:{operationId:randomUUID(),entry}})).annotation;
const createEvent=async entry=>(await fetchJson("race-events",{method:"POST",data:{...entry,creationId:randomUUID()}})).event;
const updateAnnotation=async(row,entry)=>(await fetchJson(`calendar/annotations/${encodeURIComponent(row.id)}`,{method:"PUT",data:{operationId:randomUUID(),revision:row.revision,entry}})).annotation;
const normalized=row=>row.kind==="goals"?{kind:row.kind,date:row.date,endDate:row.endDate,title:row.title,goals:row.goals}:row.kind==="availability"?{kind:row.kind,date:row.date,endDate:row.endDate,mode:row.mode,sports:row.sports,reason:row.reason,description:row.description}:Object.fromEntries(["name","date","priority","eventType","description","raceDistance","atpEventType","goals"].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
const titleFor=(kind,row)=>kind==="goals"?row.title:kind==="availability"?"Availability":row.name;
async function ensureDate(date){
  const monday=new Date(`${date}T12:00:00`);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
  await page.mouse.wheel(0,1);
  const week=page.locator(`[data-calendar-week="${monday.toLocaleDateString("en-CA")}"]`);await week.scrollIntoViewIfNeeded();
  await page.waitForFunction(date=>document.querySelector(`[data-calendar-date="${date}"]`),date);
  await cell(date).scrollIntoViewIfNeeded();
}
async function copyOrCut(kind,row,action,date=row.date) {
  await ensureDate(date);
  await cell(date).getByRole("button",{name:`Calendar entry actions: ${titleFor(kind,row)}`,exact:true}).click();
  await page.getByRole("menuitem",{name:action,exact:true}).click();
}
async function paste(date,{status=200}={}) {
  await ensureDate(date);
  await page.getByRole("button",{name:`Actions for ${longDate(date)}`,exact:true}).click();
  const response=page.waitForResponse(response=>transferRequest(response.request()));
  await page.getByRole("menuitem",{name:/^Paste /}).click();
  const saved=await response;assert.equal(saved.status(),status);return saved.json();
}
async function reload() {await page.reload({waitUntil:"domcontentloaded"});await page.locator(".calendar-desktop-toolbar").waitFor();}
async function clearClipboard() {if(await page.getByRole("button",{name:"Clear clipboard",exact:true}).count()){const pending=await page.getByRole("button",{name:"Resume paste",exact:true}).count()>0;await page.getByRole("button",{name:"Clear clipboard",exact:true}).click();if(pending)await page.getByRole("alertdialog").getByRole("button",{name:"Confirm",exact:true}).click();}}
const noMachineText=value=>assert.doesNotMatch(value||"",/Workout editor v1|training-agent-.*-v1|"goals"\s*:|"eventType"\s*:|"sports"\s*:/);
try {
  await page.goto(`${origin}/calendar?theme=light`,{waitUntil:"domcontentloaded"});
  await page.locator(".calendar-desktop-toolbar").waitFor();
  assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true,"Synthetic marker required before mutation");
  const tag=Date.now(),goalEntry={kind:"goals",date:day(1),endDate:day(1),title:`Clipboard goals ${tag}`,goals:[{id:"steady",text:"Keep training consistent",completed:true},{id:"rest",text:"Rest before hard sessions",completed:false}]};
  let sourceGoal=await createAnnotation(goalEntry);
  const availabilityEntry={kind:"availability",date:day(1),endDate:day(3),mode:"limited",sports:["Swim","Mtn Bike","Custom","Walk"],reason:"Work",description:"Travel with limited equipment. Preserve this exact three-day span."};
  let sourceAvailability=await createAnnotation(availabilityEntry);
  const eventEntry={name:`Clipboard detailed Event ${tag}`,date:day(2),priority:"B",eventType:"RunningRoad",raceDistance:"10000",atpEventType:"RunOnetoTwoHours",description:"Meet at the west gate. Preserve this human prose.",goals:{time:"1:30:00",distance:"13.1",distanceUnit:"mi",place:"10",finish:true,setPr:true,custom:["Finish comfortably"]}};
  let sourceEvent=await createEvent(eventEntry);
  await reload();

  await cell(sourceGoal.date).getByRole("button",{name:`Calendar entry actions: ${sourceGoal.title}`,exact:true}).click();
  await page.getByRole("menuitem",{name:"Edit",exact:true}).waitFor();
  assert.deepEqual((await page.getByRole("menuitem").allTextContents()).map(text=>text.trim()),["Edit","Cut","Copy","Delete"]);
  await page.getByRole("menuitem",{name:"Edit",exact:true}).click();
  const goalsEditor=page.locator('[role="dialog"].calendar-annotation-editor');await goalsEditor.waitFor();
  assert.equal(await goalsEditor.getByLabel("List Title",{exact:true}).inputValue(),sourceGoal.title);
  await goalsEditor.getByRole("button",{name:"Cancel",exact:true}).click();await goalsEditor.waitFor({state:"hidden"});
  await cell(sourceEvent.date).getByRole("button",{name:`Calendar entry actions: ${sourceEvent.name}`,exact:true}).click();
  await page.getByRole("menuitem",{name:"Edit",exact:true}).waitFor();
  assert.deepEqual((await page.getByRole("menuitem").allTextContents()).map(text=>text.trim()),["Edit","Cut","Copy","Delete"]);
  await page.getByRole("menuitem",{name:"Edit",exact:true}).click();
  const eventEditor=page.getByRole("dialog",{name:"Edit Event",exact:true});await eventEditor.waitFor();
  assert.equal(await eventEditor.getByLabel("Event name",{exact:true}).inputValue(),sourceEvent.name);
  await eventEditor.getByRole("button",{name:"Cancel",exact:true}).click();await eventEditor.waitFor({state:"hidden"});

  const probe=await createAnnotation({...goalEntry,title:`Delete preflight probe ${tag}`});await reload();
  await cell(probe.date).getByRole("button",{name:`Calendar entry actions: ${probe.title}`,exact:true}).click();
  await page.getByRole("menuitem",{name:"Delete",exact:true}).click();
  const deleteDialog=page.getByRole("alertdialog");await deleteDialog.waitFor();
  const beforeBlockedDelete=await records();let deleteRequests=0;
  const countDelete=request=>{if(request.method()==="DELETE"&&endpoint(request.url()).startsWith("calendar/annotations/"))deleteRequests++;};page.on("request",countDelete);
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.__restoreDeleteStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith("calendar-annotation-pending-v1:"))throw new DOMException("Synthetic quota failure","QuotaExceededError");return original.call(this,key,value);};});
  try{
    await deleteDialog.getByRole("button",{name:"Delete",exact:true}).click();
    await deleteDialog.getByRole("alert").filter({hasText:"No delete request was sent"}).waitFor();
    assert.equal(await deleteDialog.getByRole("button",{name:"Delete",exact:true}).isEnabled(),true,"Failed preflight must release the busy guard");
    assert.equal(await deleteDialog.getByRole("button",{name:"Cancel",exact:true}).isEnabled(),true);
    assert.equal(deleteRequests,0);assert.deepEqual((await records()).writes,beforeBlockedDelete.writes);
  }finally{await page.evaluate(()=>window.__restoreDeleteStorage());page.off("request",countDelete);}
  const deletedResponse=page.waitForResponse(response=>response.request().method()==="DELETE"&&endpoint(response.url()).startsWith("calendar/annotations/"));
  await deleteDialog.getByRole("button",{name:"Delete",exact:true}).click();assert.equal((await deletedResponse).ok(),true);await deleteDialog.waitFor({state:"hidden"});
  assert.equal((await records()).events.some(row=>`event:${row.id}`===probe.id),false);

  const beforeGoalCopy=nativePosts(await records()).length;
  await copyOrCut("goals",sourceGoal,"Copy");
  assert.equal(nativePosts(await records()).length,beforeGoalCopy,"Copy selects only; provider mutation must wait for Paste");
  const copiedGoal=(await paste(day(4))).annotation;assert.notEqual(copiedGoal.id,sourceGoal.id);
  assert.deepEqual(normalized(copiedGoal),{...goalEntry,date:day(4),endDate:day(4),goals:goalEntry.goals.map(goal=>({...goal,completed:false}))});
  assert.deepEqual(normalized(await annotation(sourceGoal.id)),goalEntry);
  const modified={...normalized(copiedGoal),goals:copiedGoal.goals.map((goal,index)=>index?{...goal,text:"Independent copied checklist",completed:true}:goal)};
  await updateAnnotation(copiedGoal,modified);
  assert.deepEqual(normalized(await annotation(sourceGoal.id)),goalEntry,"Editing the copied checklist cannot mutate its source");
  checks.push({name:"goals-pointer-copy-paste-preserves-checklist-and-independent-source",sourceId:sourceGoal.id,copyId:copiedGoal.id,observedMenuOrderAndEdit:true,deleteStorageFailureResetsBusyWithoutRequest:true,revisionedDeleteVerified:true});
  await clearClipboard();await copyOrCut("goals",sourceGoal,"Cut");
  const movedGoal=(await paste(day(6))).annotation;assert.equal(movedGoal.id,sourceGoal.id);assert.deepEqual(normalized(movedGoal),{...goalEntry,date:day(6),endDate:day(6)});sourceGoal=movedGoal;
  await reload();assert.deepEqual(normalized(await annotation(sourceGoal.id)),normalized(movedGoal));
  checks.push({name:"goals-pointer-cut-paste-refresh-retains-native-identity",id:movedGoal.id});

  await clearClipboard();await copyOrCut("availability",sourceAvailability,"Copy",day(2));
  const copiedAvailability=(await paste(day(5))).annotation;
  assert.notEqual(copiedAvailability.id,sourceAvailability.id);
  assert.deepEqual(normalized(copiedAvailability),{...availabilityEntry,date:day(5),endDate:day(7)});
  assert.deepEqual(normalized(await annotation(sourceAvailability.id)),availabilityEntry);
  for(const date of [day(5),day(6),day(7)]){await ensureDate(date);await cell(date).getByRole("button",{name:"View Limited Availability",exact:true}).waitFor();}
  checks.push({name:"availability-copy-from-middle-day-preserves-three-day-span-sports-reason-and-prose",copyId:copiedAvailability.id});
  await clearClipboard();await copyOrCut("availability",sourceAvailability,"Cut");
  const movedAvailability=(await paste(day(9))).annotation;
  assert.equal(movedAvailability.id,sourceAvailability.id);assert.deepEqual(normalized(movedAvailability),{...availabilityEntry,date:day(9),endDate:day(11)});sourceAvailability=movedAvailability;
  await reload();assert.deepEqual(normalized(await annotation(sourceAvailability.id)),normalized(movedAvailability));
  checks.push({name:"availability-cut-paste-refresh-retains-identity-and-full-inclusive-span",id:movedAvailability.id});

  await clearClipboard();await copyOrCut("event",sourceEvent,"Copy");
  const copiedEvent=(await paste(day(7))).event;assert.notEqual(copiedEvent.id,sourceEvent.id);
  assert.deepEqual(normalized(copiedEvent),{...eventEntry,date:day(7),priority:"",raceDistance:""});assert.deepEqual(normalized(await event(sourceEvent.id)),eventEntry);
  const copiedNative=(await records()).events.find(row=>`event:${row.id}`===copiedEvent.id);assert.equal(copiedNative.description,eventEntry.description);assert.equal(copiedNative.category,"NOTE");noMachineText(copiedNative.description);
  checks.push({name:"event-pointer-copy-preserves-exact-type-goals-description-with-independent-id",copyId:copiedEvent.id});
  await clearClipboard();await copyOrCut("event",sourceEvent,"Cut");
  const movedEvent=(await paste(day(8))).event;assert.equal(movedEvent.id,sourceEvent.id);assert.deepEqual(normalized(movedEvent),{...eventEntry,date:day(8)});sourceEvent=movedEvent;
  await reload();assert.deepEqual(normalized(await event(sourceEvent.id)),normalized(movedEvent));
  checks.push({name:"event-pointer-cut-refresh-retains-identity-and-private-fields",id:movedEvent.id});

  await clearClipboard();await copyOrCut("goals",sourceGoal,"Copy");
  const beforeHeld=nativePosts(await records()).length;let releaseHeld,started;
  const held=new Promise(resolve=>{releaseHeld=resolve;}),intercepted=new Promise(resolve=>{started=resolve;});
  const heldRoute=async route=>{if(!transferRequest(route.request()))return route.continue();started();await held;return route.continue();};
  await page.route(transferUrl,heldRoute);
  const heldResult=paste(day(10));await intercepted;
  assert.equal(nativePosts(await records()).length,beforeHeld);
  assert.equal(await page.getByRole("button",{name:"Clear clipboard",exact:true}).isDisabled(),true,"Held paste must protect its recovery identity");
  releaseHeld();await heldResult;await page.unroute(transferUrl,heldRoute);
  await clearClipboard();await copyOrCut("goals",sourceGoal,"Copy");
  await fetchJson("preview/provider-failure",{method:"POST",data:{method:"POST",status:400}});
  const beforeRejected=await records(),rejectedAttemptIndex=attempts.length;
  await paste(day(11),{status:400});
  assert.deepEqual((await records()).events,beforeRejected.events,"A definite native rejection must not create or alter a provider Event");
  assert.equal((await records()).writes.length,beforeRejected.writes.length+1,"The actual provider, not a browser response mock, must reject the first native write");
  await page.waitForFunction(()=>Object.keys(localStorage).filter(key=>key.startsWith("calendar-clipboard:v1:")).every(key=>!JSON.parse(localStorage.getItem(key)).entryAttempt));
  await paste(day(11));
  assert.notEqual(attempts[rejectedAttemptIndex].body.operationId,attempts[rejectedAttemptIndex+1].body.operationId,"Only a new explicit Paste after a definite first rejection may use a new operation identity");
  checks.push({name:"held-paste-and-real-native-rejection-retain-source-and-require-explicit-new-operation"});

  await clearClipboard();await copyOrCut("availability",sourceAvailability,"Copy");
  const beforeAmbiguous=nativePosts(await records()).length;let lose=true;
  const lostRoute=async route=>{if(!transferRequest(route.request()))return route.continue();if(!lose)return route.continue();lose=false;const response=await route.fetch();assert.equal(response.ok(),true);return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic response lost after confirmed calendar paste"})});};
  await page.route(transferUrl,lostRoute);
  const beforeAttempts=attempts.length;await paste(day(12),{status:503});
  assert.equal(nativePosts(await records()).length,beforeAmbiguous+1);
  assert.equal(await page.getByRole("button",{name:"Clear clipboard",exact:true}).isDisabled(),true,"An unresolved paste cannot discard its recovery identity");
  await reload();await page.getByRole("button",{name:"Resume paste",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Clear clipboard",exact:true}).isDisabled(),true,"Reload must not permit discarding an unconfirmed operation");
  const resumed=page.waitForResponse(response=>transferRequest(response.request()));
  await page.getByRole("button",{name:"Resume paste",exact:true}).click();const recovered=await (await resumed).json();
  assert.equal(recovered.verified,true);assert.equal(recovered.annotation.date,day(12));assert.equal(recovered.annotation.endDate,day(14));
  const recoveryAttempts=attempts.slice(beforeAttempts);assert.equal(recoveryAttempts.length,2);assert.equal(recoveryAttempts[0].body.operationId,recoveryAttempts[1].body.operationId);assert.equal(recoveryAttempts[1].body.reconcileOnly,true);
  assert.deepEqual({...recoveryAttempts[1].body,reconcileOnly:undefined},{...recoveryAttempts[0].body,reconcileOnly:undefined});assert.equal(nativePosts(await records()).length,beforeAmbiguous+1);
  checks.push({name:"ambiguous-copy-reload-resume-retains-original-target-span-and-one-native-post",operationId:recoveryAttempts[0].body.operationId});

  await clearClipboard();await copyOrCut("goals",sourceGoal,"Copy");
  const changedGoal={...normalized(sourceGoal),title:`Changed source ${tag}`};sourceGoal=await updateAnnotation(sourceGoal,changedGoal);
  const beforeStale=(await records()).writes.length;await paste(day(11),{status:409});assert.equal((await records()).writes.length,beforeStale);
  checks.push({name:"stale-source-revision-refuses-paste-with-no-provider-mutation"});

  await clearClipboard();await reload();await copyOrCut("event",sourceEvent,"Copy");
  permissionsId=sourceEvent.id;await fetchJson("preview/provider-permissions",{method:"POST",data:{id:permissionsId,readOnly:true}});
  const beforeReadonly=(await records()).writes.length;await paste(day(13),{status:403});assert.equal((await records()).writes.length,beforeReadonly);
  await clearClipboard();await reload();
  await ensureDate(sourceEvent.date);
  const readOnlyMenu=cell(sourceEvent.date).getByRole("button",{name:`Calendar entry actions: ${sourceEvent.name}`,exact:true});
  if(await readOnlyMenu.count()){await readOnlyMenu.click();assert.equal(await page.getByRole("menuitem",{name:"Copy",exact:true}).getAttribute("aria-disabled"),"true");assert.equal(await page.getByRole("menuitem",{name:"Cut",exact:true}).getAttribute("aria-disabled"),"true");await page.keyboard.press("Escape");}
  checks.push({name:"authoritative-read-only-change-refuses-paste-and-fresh-ui-disables-transfer"});
  const final=await records();for(const row of final.events.filter(row=>row.name?.includes(String(tag))))noMachineText(row.description);
  assert.deepEqual(errors,[]);
  assert.deepEqual(network.entries.filter(entry=>entry.kind==="request-failed"||entry.kind==="page-error"||entry.kind==="http-error"&&![400,403,409,503].includes(entry.status)||entry.kind==="console-error"&&!/Failed to load resource: the server responded with a status of (400|403|409|503)\b/.test(entry.text)),[]);
  await page.screenshot({path:path.join(output,"verified-clipboard-calendar.png"),animations:"disabled"});
} catch(error) {
  process.exitCode=1;errors.push(error.stack||error.message);console.error(error.message);
  await fs.writeFile(path.join(output,"failure-dom.txt"),await page.locator("body").innerText()).catch(()=>{});
  await page.screenshot({path:path.join(output,"failure.png"),animations:"disabled"}).catch(()=>{});
} finally {
  if(permissionsId)await page.request.post(`${origin}/api/preview/provider-permissions`,{data:{id:permissionsId,readOnly:false}}).catch(()=>{});
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({synthetic:true,referenceParityClaim:false,checks,errors,attempts},null,2));
  await fs.writeFile(path.join(output,"network.json"),JSON.stringify(network.entries,null,2));
  console.log(JSON.stringify({checks:checks.length,errors:errors.length,output}));await browser.close();
}
