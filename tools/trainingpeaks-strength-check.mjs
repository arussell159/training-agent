// Synthetic localhost Strength UI verification. This is not a pixel/parity score.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import {browserNetworkEvidence} from "./browser-network-evidence.mjs";
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require("playwright");}
catch {playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const origin=process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5213";
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname),"Disposable localhost preview required");
const output=path.resolve("artifacts/trainingpeaks-strength");
await fs.mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({headless:true,channel:"msedge"});
const context=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light",locale:"en-US"});
const network=browserNetworkEvidence();network.attach(context);
const errors=[],checks=[],gaps=[],readbacks=[],requestLifecycle=[];
let phase="initial";
let diagnosticHydrationDone=Promise.resolve();
const watch=async context=>{
  const record=(kind,request,extra={})=>requestLifecycle.push({kind,time:Date.now(),phase,url:request.url(),method:request.method(),...extra});
  context.on("request",request=>record("request",request));
  context.on("response",response=>record("response",response.request(),{status:response.status()}));
  context.on("requestfinished",request=>record("finished",request));
  context.on("requestfailed",request=>record("failed",request,{reason:request.failure()?.errorText}));
  context.on("page",page=>page.on("pageerror",error=>errors.push(error.message)));
  await context.route("**/*",route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
};
await watch(context);
const page=await context.newPage();page.setDefaultTimeout(12000);
let diagnosticPage=page;
const root=()=>page.locator(".dsb-dialog");
const button=(name,scope=root())=>scope.getByRole("button",{name,exact:true});
const exercise=code=>root().locator(`section[aria-label="Prescription ${code}"]`);
const table=code=>root().getByRole("table",{name:`Sets ${code}`,exact:true});
const cell=(code,row,column)=>table(code).locator("tbody tr").nth(row-1).locator("input").nth(column-1);
const commitCell=async(code,row,column,value)=>{const input=cell(code,row,column);await input.fill(String(value));await input.press("Tab");};
const grid=code=>table(code).locator("tbody tr").evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll("input")].map(input=>input.value)));
const provider=async()=>(await page.request.get(`${origin}/api/preview/provider-records`)).json();
const routePath=url=>url.pathname.startsWith("/api/handler")?url.searchParams.get("__api_route"):url.pathname.replace(/^\/api\//,"");
const nativePosts=records=>records.writes.filter(write=>write.method==="POST" && /\/events$/.test(write.path));
const ids=()=>root().locator(".dsb-block").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-strength-block")));
const date=new Date();date.setDate(date.getDate()+3);
const dayLabel=`Add workout for ${date.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`;
const title=`Synthetic strength exact sets ${Date.now()}`;
const instructions="Use controlled movement. Rest between sets; retain all prescribed fields.";
const openChooser=async()=>{
  await page.getByRole("button",{name:dayLabel,exact:true}).press("Enter");
  await page.locator(".calendar-add-dialog").getByRole("button",{name:"Strength",exact:true}).click();
};
const openNew=async()=>{await openChooser();if(await page.locator(".dsb-selector").count())await page.getByRole("button",{name:"New Strength Builder",exact:true}).click();await root().waitFor();};
const addBlock=async name=>{
  const trigger=button("Add Block");await trigger.waitFor();assert.equal(await trigger.isEnabled(),true);
  await trigger.evaluate(node=>node.scrollIntoView({block:"center",inline:"nearest"}));const bounds=await trigger.boundingBox();assert.ok(bounds);
  // The observed empty-builder button continuously pulses. Its center remains
  // clickable while Playwright's stationary-element prerequisite never settles.
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await button(name).click();
};
const nameExercise=async(code,name)=>{
  await root().getByRole("combobox",{name:`Exercise ${code}`,exact:true}).fill(name);await button(`Create Custom Exercise: ${name}`).click();
  const definition=page.getByRole("dialog",{name:"Create Custom Exercise",exact:true});await definition.waitFor();
  await definition.getByLabel("Exercise title",{exact:true}).fill(name);
  // These older parameter-propagation checks deliberately prescribe Reps only;
  // the dedicated catalog suite verifies the default Reps + Weight lb columns.
  await definition.getByRole("button",{name:"Remove parameter 2",exact:true}).click();
  await definition.getByRole("button",{name:"Preview Changes",exact:true}).click();
  const preview=page.getByRole("dialog",{name:"Exercise Preview",exact:true});await preview.waitFor();
  await preview.getByRole("button",{name:"Save",exact:true}).click();await preview.waitFor({state:"hidden"});
  // Wait for the parent prescription to re-enter the accessibility tree after
  // the nested definition portal closes, before using non-waiting row counts.
  await table(code).waitFor();
};
const undo=async()=>{const options=button("Strength workout options");if(await options.getAttribute("aria-expanded")!=="true")await options.click();await page.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem",{name:"Undo",exact:true}).click();if(await options.getAttribute("aria-expanded")==="true")await options.click();};
try {
  await page.goto(`${origin}/calendar?theme=light`,{waitUntil:"networkidle"});
  assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true,"Synthetic marker required before mutation");
  const baselinePosts=nativePosts(await provider()).length;
  const baselineWrites=(await provider()).writes.length;
  await openChooser();
  await page.getByRole("button",{name:"Old Strength Builder",exact:true}).waitFor();
  await page.getByRole("button",{name:"New Strength Builder",exact:true}).waitFor();
  await page.getByRole("button",{name:"Old Strength Builder",exact:true}).click();
  await page.getByLabel("Planned duration",{exact:true}).waitFor();
  assert.equal(await root().count(),0);
  await page.getByRole("button",{name:"Close workout details",exact:true}).click();
  await page.locator(".desktop-workout-preview").waitFor({state:"hidden"});
  await openNew();await button("Close Strength builder").click();
  await root().waitFor({state:"hidden"});
  assert.equal(await page.getByRole("alertdialog").count(),0,"Pristine Strength close must not ask to discard");
  assert.equal(nativePosts(await provider()).length,baselinePosts);
  checks.push({name:"old-new-strength-chooser-and-pristine-close",nativeWrites:0});

  await openNew();
  await root().getByLabel("Workout Title",{exact:true}).fill(title);
  await root().getByLabel("Workout Instructions",{exact:true}).fill(instructions);
  await addBlock("Single Exercise");await nameExercise("A","Air Squat");
  assert.equal(await table("A").locator("tbody tr").count(),3);
  await commitCell("A",1,1,10);assert.deepEqual(await grid("A"),[["10"],["10"],["10"]]);
  await commitCell("A",2,1,12);assert.deepEqual(await grid("A"),[["10"],["12"],["10"]]);
  await commitCell("A",1,1,15);assert.deepEqual(await grid("A"),[["15"],["15"],["15"]]);
  await button("Add Coach Notes",exercise("A")).click();
  await root().getByLabel("Coach Notes A",{exact:true}).fill("Maintain a controlled range and comfortable depth.");
  await commitCell("A",2,1,-1);
  await exercise("A").getByRole("alert").waitFor();
  assert.equal(await button("Save").isDisabled(),true,"An invalid visible numeric edit must block saving instead of silently using the previous value");
  assert.equal((await provider()).writes.length,baselineWrites);
  await commitCell("A",2,1,15);
  await exercise("A").getByRole("alert").waitFor({state:"hidden"});
  const exerciseQuery=root().getByRole("combobox",{name:"Exercise A",exact:true});
  await exerciseQuery.fill("Unselected changed exercise");
  assert.equal(await button("Save").isDisabled(),true,"An unselected exercise query must not silently save the previous exercise");
  await exerciseQuery.press("Escape");
  assert.equal(await exerciseQuery.inputValue(),"Air Squat");
  assert.equal(await button("Save").isEnabled(),true);
  checks.push({name:"custom-exercise-first-row-propagation-overrides-and-notes",reps:[15,15,15],invalidNumericSaveBlocked:true,unselectedQuerySaveBlocked:true});

  await button("Add Parameter",exercise("A")).click();
  await root().getByLabel("Parameter A 2",{exact:true}).selectOption("weight:lb");
  await commitCell("A",1,2,50);
  assert.deepEqual(await grid("A"),[["15","50"],["15","50"],["15","50"]]);
  assert.equal((await root().locator(".dsb-summary dl div").filter({has:page.locator("dt",{hasText:/^Volume$/})}).locator("dd").innerText()).trim(),"2,250 lb");
  checks.push({name:"independent-15-reps-50lb-three-set-volume",expectedVolumeLb:2250});

  for(let count=3;count<15;count++)await button("Add one more set A").click();
  assert.equal(await table("A").locator("tbody tr").count(),15);
  assert.equal(await button("Add one more set A").isDisabled(),true);
  assert.equal(await button("Add one more set A").getAttribute("title"),"Limit 15 Sets");
  for(let count=15;count>1;count--)await button("Remove one set A").click();
  assert.equal(await table("A").locator("tbody tr").count(),1);
  assert.equal(await button("Remove one set A").isDisabled(),true);
  assert.equal(await button("Remove one set A").getAttribute("title"),"Must contain at least one set");
  await button("Add one more set A").click();await button("Add one more set A").click();
  checks.push({name:"set-count-one-to-fifteen-bounds-and-tooltips",minimum:1,maximum:15});

  await button("Add Parameter",exercise("A")).click();
  await commitCell("A",1,3,7);await commitCell("A",2,3,9);
  assert.deepEqual(await grid("A"),[["15","50","7"],["15","50","9"],["15","50","7"]]);
  await commitCell("A",1,3,8);
  assert.deepEqual(await grid("A"),[["15","50","8"],["15","50","8"],["15","50","8"]]);
  await button("Remove parameter A 3").click();
  assert.deepEqual(await grid("A"),[["15","50"],["15","50"],["15","50"]]);
  await button("Block options A").click();
  await root().getByRole("menuitem",{name:"Duplicate Exercise",exact:true}).click();
  await commitCell("B",1,1,20);
  assert.deepEqual(await grid("A"),[["15","50"],["15","50"],["15","50"]]);
  assert.deepEqual(await grid("B"),[["20","50"],["20","50"],["20","50"]]);
  await button("Remove block 2").click();
  checks.push({name:"duplicate-reps-columns-and-duplicate-exercises-remain-independent-after-removal"});

  await addBlock("Warm Up");await nameExercise("B1","Warm-up walk");
  assert.equal(await root().getByLabel("Block 2 time",{exact:true}).inputValue(),"00:10:00");
  assert.equal(await table("B1").locator("tbody tr").count(),1);
  await addBlock("Circuit");await nameExercise("C1","Step Up");
  assert.equal(await root().getByLabel("Block 3 time",{exact:true}).inputValue(),"00:10:00");
  assert.equal(await table("C1").locator("tbody tr").count(),1);
  await root().locator(".dsb-block").nth(2).getByRole("button",{name:"Add Exercise",exact:true}).click();
  await nameExercise("C2","Plank");
  assert.equal(await table("C2").locator("tbody tr").count(),1);
  assert.equal(await root().getByLabel("Block 3 Record",{exact:true}).inputValue(),"completion");
  const warmupTime=root().getByLabel("Block 2 time",{exact:true});
  await warmupTime.fill("00:12:00");await warmupTime.press("Tab");
  await warmupTime.fill("not a time");await warmupTime.press("Tab");
  assert.equal(await button("Save").isDisabled(),true,"An invalid visible block time must block Save");
  await undo();
  assert.equal(await warmupTime.inputValue(),"00:10:00");
  assert.equal(await button("Save").isEnabled(),true,"Undo to a valid block time must clear the stale input error");
  checks.push({name:"warmup-and-circuit-observed-ten-minute-one-set-defaults",blockSeconds:600,setsPerExercise:1,invalidTimeUndoRestoresSave:true});

  const beforeOrder=await ids();
  await page.evaluate(()=>{window.__strengthDrag=[];for(const name of ["dragstart","dragover","drop","dragend"])document.addEventListener(name,event=>{if(name!=="dragover"||window.__strengthDrag.at(-1)?.type!==name)window.__strengthDrag.push({type:name,target:event.target?.closest?.("[data-strength-block]")?.getAttribute("data-strength-block"),label:event.target?.getAttribute?.("aria-label"),x:event.clientX,y:event.clientY});},true);});
  const dragHandle=button("Move block B");await dragHandle.scrollIntoViewIfNeeded();
  const dragBounds=await dragHandle.boundingBox();assert.ok(dragBounds);
  await page.mouse.move(dragBounds.x+dragBounds.width/2,dragBounds.y+dragBounds.height/2);await page.mouse.down();
  await page.mouse.move(dragBounds.x+dragBounds.width/2+12,dragBounds.y+dragBounds.height/2+8,{steps:4});
  const dropBlock=root().locator(".dsb-block").first();await dropBlock.scrollIntoViewIfNeeded();
  const dropBounds=await dropBlock.boundingBox();assert.ok(dropBounds);
  const mainBounds=await root().locator(".dsb-main").boundingBox();assert.ok(mainBounds);
  await page.mouse.move(dropBounds.x+20,Math.max(mainBounds.y+20,dropBounds.y+20),{steps:10});await page.mouse.up();
  assert.deepEqual(await ids(),[beforeOrder[1],beforeOrder[0],beforeOrder[2]]);
  await button("Move block 1 down").focus();await button("Move block 1 down").press("Enter");
  assert.deepEqual(await ids(),beforeOrder);
  await undo();assert.deepEqual(await ids(),[beforeOrder[1],beforeOrder[0],beforeOrder[2]]);
  await button("Close Strength builder").focus();await button("Close Strength builder").press("Control+z");
  assert.deepEqual(await ids(),beforeOrder);
  assert.equal(nativePosts(await provider()).length,baselinePosts,"Editing and reordering must not implicitly create a provider workout");
  assert.equal((await provider()).writes.length,baselineWrites,"Draft editing must not send any provider mutation before explicit Save");
  checks.push({name:"native-pointer-and-keyboard-block-reorder-with-menu-and-shortcut-undo"});

  await root().getByLabel("Workout Instructions",{exact:true}).fill("Changed instructions that must be undone before saving.");
  await undo();
  assert.equal(await root().getByLabel("Workout Instructions",{exact:true}).inputValue(),instructions,"Undo must restore both the visible instructions and the native description source");

  let reject=true,hold=true,heldBody,rejectedBody,releaseHeld,started;
  const held=new Promise(resolve=>{releaseHeld=resolve;}),intercepted=new Promise(resolve=>{started=resolve;});
  await page.route(url=>routePath(url)==="workouts/editor",async route=>{
    if(route.request().method()!=="POST")return route.continue();
    const body=route.request().postDataJSON();
    if(reject){reject=false;rejectedBody=body;return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:"Synthetic Strength rejected; draft retained."})});}
    if(hold){hold=false;heldBody=body;started();await held;}
    return route.continue();
  });
  await button("Save & Close").click();
  await root().getByRole("alert").filter({hasText:"Synthetic Strength rejected"}).waitFor();
  assert.equal(await root().isVisible(),true);
  assert.equal(await root().getByLabel("Workout Title",{exact:true}).inputValue(),title);
  assert.deepEqual(await grid("A"),[["15","50"],["15","50"],["15","50"]]);
  assert.equal(nativePosts(await provider()).length,baselinePosts);
  await button("Save & Close").click();await intercepted;
  assert.equal(await button("Close Strength builder").isDisabled(),true);
  assert.equal(await root().getByLabel("Workout Title",{exact:true}).isDisabled(),true);
  await page.keyboard.press("Escape");assert.equal(await root().isVisible(),true);
  assert.equal(nativePosts(await provider()).length,baselinePosts,"Held request must not mutate the provider before release");
  assert.deepEqual(heldBody.model.strength,rejectedBody.model.strength);
  assert.equal(heldBody.model.notes,instructions);
  assert.equal(heldBody.description,instructions,"Undo must not leave an outdated description override in the outgoing request");
  releaseHeld();await root().waitFor({state:"hidden"});
  const native=(await provider()).events.find(event=>event.name===title);assert.ok(native);
  assert.equal(native.type,"WeightTraining");assert.ok(native.description.includes("Air Squat"));assert.ok(native.description.includes(instructions));
  assert.ok(native.description.includes("Maintain a controlled range and comfortable depth."),"Coach notes must remain readable in the native human prescription");
  assert.doesNotMatch(native.description,/Workout editor v1|training-agent-.*-v1|"version"\s*:|"blocks"\s*:|"steps"\s*:/);
  assert.equal(Boolean(native.workout_doc?.steps?.length),false,"An exercise prescription must not manufacture a device interval");
  assert.equal(native.time_target == null,true,"Exercise block clocks do not prescribe a continuous workout duration");
  assert.equal(native.icu_training_load == null,true,"Strength sets/volume must not manufacture TSS");
  const id=`event:${native.id}`;
  const readUrl=`${origin}/api/workouts/${encodeURIComponent(id)}/editor`;
  const savedRead=await (await page.request.get(readUrl)).json();readbacks.push({route:readUrl,native,body:savedRead});const saved=savedRead.model;
  assert.deepEqual(saved.strength,heldBody.model.strength);assert.deepEqual(saved.steps,[]);
  const freshContext=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light",locale:"en-US"});network.attach(freshContext);await watch(freshContext);
  const fresh=await freshContext.newPage();fresh.setDefaultTimeout(12000);
  diagnosticPage=fresh;
  await fresh.goto(`${origin}/calendar?workout=${encodeURIComponent(id)}&theme=light`,{waitUntil:"domcontentloaded",timeout:30000});
  await fresh.locator(".dsb-dialog").waitFor();
  assert.equal(await fresh.getByLabel("Workout Title",{exact:true}).inputValue(),title);
  assert.equal(await fresh.getByLabel("Workout Instructions",{exact:true}).inputValue(),instructions);
  const freshGrid=await fresh.getByRole("table",{name:"Sets A",exact:true}).locator("tbody tr").evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll("input")].map(input=>input.value)));
  assert.deepEqual(freshGrid,[["15","50"],["15","50"],["15","50"]]);
  await fresh.screenshot({path:path.join(output,"saved-fresh-private-strength.png"),animations:"disabled"});
  await fresh.getByRole("tab",{name:"Exercise History",exact:true}).click();
  await fresh.getByText("No exercise selected",{exact:true}).waitFor();
  await fresh.getByText("No exercise history available",{exact:true}).waitFor();
  await fresh.getByRole("combobox",{name:"Search for an exercise to view its history",exact:true}).fill("Air Squat");
  await fresh.getByLabel("Saved exercise history",{exact:true}).selectOption(saved.strength.blocks[0].exercises[0].libraryExerciseId);
  await fresh.locator(".dsb-history article").filter({has:fresh.getByRole("heading",{name:title,exact:true})}).first().waitFor();
  assert.equal(await fresh.locator(".dsb-history article").filter({has:fresh.getByRole("heading",{name:title,exact:true})}).count(),1,"The same workout present in planned/history context must appear once in Exercise History");
  assert.equal(await fresh.getByLabel("Workout Title",{exact:true}).isVisible(),true,"Exercise History must keep the main prescription editor visible");
  assert.equal(await fresh.locator(".dsb-dialog").getByRole("button",{name:/Export/}).count(),0);
  gaps.push({feature:"New Strength Text/device export UI",status:"Not exposed in this builder; the observed reference overflow also has no Export option",browserVerified:false});
  // Retain this read-only context until final browser cleanup; its live channel never reaches networkidle.
  diagnosticPage=page;
  checks.push({name:"explicit-rejected-held-save-and-fresh-private-readback-human-native-description",providerId:native.id,privateModelExact:true,phantomDeviceIntervals:false});

  const ambiguousTitle=`Synthetic Strength ambiguous close ${Date.now()}`;
  await openNew();await root().getByLabel("Workout Title",{exact:true}).fill(ambiguousTitle);
  await addBlock("Single Exercise");await nameExercise("A","Recovery exercise");await commitCell("A",1,1,5);
  let lose=true;const creationIds=[],ambiguousBodies=[];
  await page.route(url=>routePath(url)==="workouts/editor",async route=>{
    if(route.request().method()!=="POST")return route.continue();
    const body=route.request().postDataJSON();creationIds.push(body.creationId);ambiguousBodies.push(body);
    if(!lose)return route.continue();lose=false;
    const response=await route.fetch();assert.equal(response.ok(),true);
    return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic Strength confirmation lost after native creation"})});
  });
  await button("Save & Close").click();await root().getByRole("alert").waitFor();
  await button("Close Strength builder").click();await root().waitFor({state:"hidden"});
  await page.reload({waitUntil:"networkidle"});await openNew();
  if(await button("Review pending save").count())await button("Review pending save").click();
  assert.equal(await root().getByLabel("Workout Title",{exact:true}).inputValue(),ambiguousTitle);
  assert.equal(await root().getByLabel("Workout Title",{exact:true}).isDisabled(),true,"An ambiguous pending request must lock its submitted model");
  const pendingGrid=await grid("A");
  await button("Close Strength builder").focus();await page.keyboard.press("Control+z");
  assert.deepEqual(await grid("A"),pendingGrid,"Pending Ctrl+Z must not replace the immutable submitted model");
  await button("Strength workout options").click();
  assert.equal(await page.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem",{name:"Undo",exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem",{name:"Redo",exact:true}).isDisabled(),true);
  await button("Strength workout options").click();
  const rechecked=page.waitForResponse(response=>routePath(new URL(response.url()))==="workouts/editor"&&response.request().method()==="POST"&&response.ok());
  await button("Recheck Save").click();await rechecked;
  assert.equal(creationIds.length,2);assert.equal(creationIds[0],creationIds[1]);
  assert.deepEqual(ambiguousBodies[0].model,ambiguousBodies[1].model,"The recheck must send the exact immutable model after close/reload and attempted Undo");
  assert.equal((await provider()).writes.filter(write=>write.method==="POST"&&write.body?.name===ambiguousTitle).length,1);
  checks.push({name:"ambiguous-strength-create-close-reload-reopen-same-identity-one-native-post",identityPreserved:true});

  // Observed reference: a named, explicitly empty Strength prescription is a
  // saved Strength workout, not a freeform endurance workout or invented set.
  await button("Close Strength builder").click();await root().waitFor({state:"hidden"});
  await openNew();assert.equal(await button("Save").isDisabled(),true,"A pristine default draft must not create an accidental workout");
  const emptyTitle=`Synthetic title-only Strength ${Date.now()}`;
  await root().getByLabel("Workout Title",{exact:true}).fill(emptyTitle);
  assert.equal(await root().locator(".dsb-block").count(),0);
  assert.equal(await button("Save & Close").isEnabled(),true,"A deliberately named zero-block Strength workout is valid");
  const emptySave=page.waitForResponse(response=>routePath(new URL(response.url()))==="workouts/editor"&&response.request().method()==="POST"&&response.ok());
  await button("Save & Close").click();const emptySaved=await emptySave;await root().waitFor({state:"hidden"});
  const emptyBody=emptySaved.request().postDataJSON();assert.deepEqual(emptyBody.model.strength,{version:1,blocks:[]});assert.deepEqual(emptyBody.model.steps,[]);assert.equal(emptyBody.model.sport,"WeightTraining");assert.equal(emptyBody.model.unstructured,undefined);
  const emptyNative=(await provider()).events.find(event=>event.name===emptyTitle);assert.ok(emptyNative);assert.equal(emptyNative.type,"WeightTraining");
  assert.equal(emptyNative.time_target==null,true);assert.equal(emptyNative.load_target==null,true);assert.equal(emptyNative.icu_training_load==null,true);assert.equal(Boolean(emptyNative.workout_doc?.steps?.length),false);
  assert.doesNotMatch(emptyNative.description,/Workout editor v1|"version"\s*:|"blocks"\s*:|"steps"\s*:/);
  const emptyId=`event:${emptyNative.id}`,emptyReadUrl=`${origin}/api/workouts/${encodeURIComponent(emptyId)}/editor`;
  const emptyRead=await (await page.request.get(emptyReadUrl)).json();assert.deepEqual(emptyRead.model.strength,{version:1,blocks:[]});assert.deepEqual(emptyRead.model.steps,[]);assert.equal(emptyRead.model.unstructured,undefined);
  readbacks.push({route:emptyReadUrl,native:emptyNative,body:emptyRead});
  const emptyCard=page.locator(`.calendar-workout-card[data-workout-id="${emptyId}"]`);await emptyCard.waitFor();
  assert.equal((await emptyCard.locator('[data-workout-metric="sets"]').innerText()).trim().replace(/\s+/g," "),"-- Sets");assert.equal((await emptyCard.locator('[data-workout-metric="exercises"]').innerText()).trim().replace(/\s+/g," "),"-- Exercises");
  const emptyContext=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light",locale:"en-US"});network.attach(emptyContext);await watch(emptyContext);
  const emptyPage=await emptyContext.newPage();emptyPage.setDefaultTimeout(12000);diagnosticPage=emptyPage;
  phase="empty-direct-reopen";
  await emptyPage.goto(`${origin}/calendar?workout=${encodeURIComponent(emptyId)}&theme=light`,{waitUntil:"domcontentloaded"});
  await emptyPage.evaluate(()=>{window.__strengthLifecycle=[];for(const type of ["training-mutation-started","workout-editor-saved","training-cache-reset","training-context-updated"])window.addEventListener(type,()=>window.__strengthLifecycle.push({type,time:Date.now()}));});
  const emptyRoot=emptyPage.locator(".dsb-dialog");await emptyRoot.waitFor();assert.equal(await emptyRoot.getByLabel("Workout Title",{exact:true}).inputValue(),emptyTitle);assert.equal(await emptyRoot.locator(".dsb-block").count(),0);assert.equal(await emptyRoot.getByRole("table",{name:/^Sets /}).count(),0);
  // Diagnostic only: normal network latency is held for one post-save read to
  // identify cancellation ownership. This never changes the acceptance gate.
  if(["1","2"].includes(process.env.APP_STRENGTH_HOLD_HYDRATION)) {
    let reads=0,saved=false;
    await emptyPage.route(url=>routePath(url)===`workouts/${encodeURIComponent(emptyId)}/editor`,async route=>{
      if(route.request().method()==="PUT")saved=true;
      if(!saved||route.request().method()!=="GET"||++reads!==Number(process.env.APP_STRENGTH_HOLD_HYDRATION))return route.continue();
      let complete;diagnosticHydrationDone=new Promise(resolve=>{complete=resolve;});
      const request=route.request(),response=await route.fetch();
      requestLifecycle.push({kind:"diagnostic-held-hydration",time:Date.now(),phase,url:request.url(),method:"GET"});
      const outcome=await Promise.race([emptyPage.waitForEvent("requestfailed",{predicate:candidate=>candidate===request,timeout:3000}).then(()=>"aborted").catch(()=>"timeout"),new Promise(resolve=>setTimeout(()=>resolve("timeout"),3100))]);
      requestLifecycle.push({kind:"diagnostic-hydration-release",time:Date.now(),phase,url:request.url(),outcome});
      await route.fulfill({response}).catch(()=>{});
      complete();
    });
  }
  assert.equal(await emptyRoot.getByLabel("Planned Duration",{exact:true}).inputValue(),"");assert.equal(await emptyRoot.getByLabel("Planned TSS",{exact:true}).inputValue(),"");
  await emptyRoot.getByLabel("Planned Duration",{exact:true}).fill("0:20:00");await emptyRoot.getByLabel("Planned TSS",{exact:true}).fill("0");await emptyRoot.getByLabel("Workout Instructions",{exact:true}).fill("Manual instructions with no prescribed exercises.");
  const emptyUpdate=emptyPage.waitForResponse(response=>routePath(new URL(response.url()))===`workouts/${encodeURIComponent(emptyId)}/editor`&&response.request().method()==="PUT"&&response.ok());
  phase="empty-manual-save";
  await emptyRoot.getByRole("button",{name:"Save",exact:true}).click();const updatedEmpty=await emptyUpdate;
  phase="empty-manual-save-confirmed";
  assert.equal(updatedEmpty.request().postDataJSON().values.duration_seconds,1200);assert.equal(updatedEmpty.request().postDataJSON().values.tss,0);
  const emptyUpdatedRead=await (await emptyPage.request.get(emptyReadUrl)).json();assert.deepEqual(emptyUpdatedRead.model.strength,{version:1,blocks:[]});assert.deepEqual(emptyUpdatedRead.model.steps,[]);assert.equal(emptyUpdatedRead.model.notes,"Manual instructions with no prescribed exercises.");
  const updatedEmptyNative=(await provider()).events.find(event=>event.id===emptyNative.id);assert.equal(updatedEmptyNative.time_target,1200);assert.equal(updatedEmptyNative.load_target,0);assert.equal(Boolean(updatedEmptyNative.workout_doc?.steps?.length),false);
  readbacks.push({route:emptyReadUrl,native:updatedEmptyNative,body:emptyUpdatedRead});
  let emptyDeleteRequests=0,rejectEmptyDelete=true,releaseEmptyDelete,startedEmptyDelete;
  const emptyDeleteHeld=new Promise(resolve=>{releaseEmptyDelete=resolve;}),emptyDeleteIntercepted=new Promise(resolve=>{startedEmptyDelete=resolve;});
  const emptyDeletePath=`workouts/${encodeURIComponent(emptyId)}`;
  await emptyPage.route(url=>routePath(url)===emptyDeletePath,async route=>{
    if(route.request().method()!=="DELETE")return route.continue();emptyDeleteRequests++;
    if(rejectEmptyDelete){rejectEmptyDelete=false;return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:"Synthetic empty Strength deletion rejected; prescription retained."})});}
    startedEmptyDelete();await emptyDeleteHeld;return route.continue();
  });
  const emptyWritesBeforeDelete=(await provider()).writes.length;
  phase="empty-delete-cancel";
  await emptyRoot.getByRole("button",{name:"Strength workout options",exact:true}).click();await emptyPage.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem",{name:"Delete Workout",exact:true}).click();
  const emptyDelete=emptyPage.getByRole("alertdialog",{name:"Are you sure you want to delete?",exact:true});await emptyDelete.waitFor();await emptyDelete.getByRole("button",{name:"Cancel",exact:true}).click();assert.equal(emptyDeleteRequests,0);assert.ok((await provider()).events.some(event=>event.id===emptyNative.id),"Cancelling deletion must preserve the saved empty prescription");assert.equal((await provider()).writes.length,emptyWritesBeforeDelete);
  phase="empty-delete-reject";
  await emptyRoot.getByRole("button",{name:"Strength workout options",exact:true}).click();await emptyPage.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem",{name:"Delete Workout",exact:true}).click();
  await emptyDelete.getByRole("button",{name:"Delete",exact:true}).click();await emptyDelete.getByRole("alert").filter({hasText:"Synthetic empty Strength deletion rejected"}).waitFor();assert.equal(emptyDeleteRequests,1);assert.equal(await emptyRoot.getByLabel("Workout Title",{exact:true}).inputValue(),emptyTitle);assert.equal((await provider()).writes.length,emptyWritesBeforeDelete);assert.ok((await provider()).events.some(event=>event.id===emptyNative.id));
  phase="empty-delete-retry-held";
  await emptyDelete.getByRole("button",{name:"Delete",exact:true}).click();await emptyDeleteIntercepted;assert.equal(await emptyDelete.getByRole("button",{name:"Cancel",exact:true}).isDisabled(),true);await emptyPage.keyboard.press("Control+s");await emptyPage.keyboard.press("Enter");await emptyPage.keyboard.press("Escape");assert.equal(await emptyDelete.isVisible(),true);assert.equal(emptyDeleteRequests,2);assert.equal((await provider()).writes.length,emptyWritesBeforeDelete);
  releaseEmptyDelete();await emptyRoot.waitFor({state:"hidden"});
  assert.equal((await provider()).events.some(event=>event.id===emptyNative.id),false,"Confirmed deletion must remove the exact native identity");
  const deletedEmpty=await emptyPage.request.get(emptyReadUrl);assert.equal(deletedEmpty.status(),404);await diagnosticHydrationDone;readbacks.push({route:"browser-lifecycle-observer",events:await emptyPage.evaluate(()=>window.__strengthLifecycle)});diagnosticPage=page; // Final browser cleanup closes all bounded contexts.
  checks.push({name:"title-only-zero-block-strength-create-private-native-card-direct-reopen-manual-values-and-confirmed-delete",providerId:emptyNative.id,manualDurationSeconds:1200,manualTss:0,phantomDeviceIntervals:false});
  assert.deepEqual(errors,[]);
  assert.deepEqual(network.entries.filter(entry=>
    entry.kind==="request-failed" || entry.kind==="page-error" ||
    entry.kind==="http-error" && ![400,503].includes(entry.status) ||
    entry.kind==="console-error" && !/Failed to load resource: the server responded with a status of (400|503)\b/.test(entry.text)
  ),[],"Only the deliberately rejected400 and lost-confirmation503 may produce network/console errors");
  console.log(JSON.stringify({checks:checks.length,errors:errors.length,gaps},null,2));
} catch(error) {
  process.exitCode=1;errors.push(error.stack||error.message);console.error(error.message);
  await fs.writeFile(path.join(output,"failure-state.json"),JSON.stringify(await diagnosticPage.evaluate(()=>({drag:window.__strengthDrag,focus:document.activeElement?.outerHTML,dialogs:[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map(node=>({role:node.getAttribute("role"),title:document.getElementById(node.getAttribute("aria-labelledby"))?.textContent,hiddenAncestor:node.closest('[aria-hidden="true"],[inert]')?.outerHTML.slice(0,500)})),blocks:[...document.querySelectorAll(".dsb-block")].map(node=>({id:node.getAttribute("data-strength-block"),rect:node.getBoundingClientRect().toJSON()}))})),null,2)).catch(()=>{});
  await fs.writeFile(path.join(output,"failure-dom.txt"),await diagnosticPage.locator("body").innerText()).catch(()=>{});
  await fs.writeFile(path.join(output,"failure-accessibility.txt"),await diagnosticPage.locator("body").ariaSnapshot()).catch(()=>{});
  await diagnosticPage.screenshot({path:path.join(output,"failure.png"),animations:"disabled"}).catch(()=>{});
} finally {
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({synthetic:true,referenceParityClaim:false,diagnostic:!!process.env.APP_STRENGTH_HOLD_HYDRATION,checks,errors,gaps},null,2));
  await fs.writeFile(path.join(output,"network.json"),JSON.stringify(network.entries,null,2));
  await fs.writeFile(path.join(output,"readbacks.json"),JSON.stringify(readbacks,null,2));
  await fs.writeFile(path.join(output,"request-lifecycle.json"),JSON.stringify(requestLifecycle,null,2));
  await browser.close();
}
