// Disposable localhost evidence only. No TrainingPeaks percentage certification.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5213";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/trainingpeaks-peak-cadence");
await fs.mkdir(output, { recursive: true });
const checkpoint={capturedAt:new Date().toISOString(),files:await Promise.all([import.meta.url,new URL("../ui/dist/index.html",import.meta.url).href,new URL("./desktop-preview.mjs",import.meta.url).href,new URL("./desktop-cadence-fixtures.mjs",import.meta.url).href,new URL("../app-backend/lib/cadence-curve.mjs",import.meta.url).href].map(async file=>({file,sha256:createHash("sha256").update(await fs.readFile(new URL(file))).digest("hex")})))};
const browser = await playwright.chromium.launch({ channel: "msedge", headless: true });
const network = browserNetworkEvidence(), checks = [], errors = [], readbacks = [], sourceReads = [], preferenceWrites = [], supersededUrls = new Set();
const limitations = { synthetic: true, visualPercentageCertified: false, rawCadenceSourceVerified: false, normalSummaryOpeningVerified: false, native128RecordingCapBrowserVerified:false, trainingPeaksRunCadenceConventionCertified:false, populatedTrainingPeaksPaletteCertified: false };
let page, today, oracle, syntheticVerified=false, capScenarioActive=false;
const api = input => { const url = new URL(input); return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, ""); };
const button = name => page.getByRole("button", { name, exact: true });
const region = () => page.getByRole("region", { name: /^Peaks - Cadence:|^Verified Cadence acceptance$/ });
const settings = () => page.locator(".ddc-settings");
const shift = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const dateText = date => `${date.slice(5,7)}/${date.slice(8,10)}/${date.slice(2,4)}`;
const durationText = seconds => seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`;
// Observed reference grid anchors, independent of the application helper.
const gridAxis = [5,10,12,20,30,60,120,300,360,600,720,1200,1800,3600,5400];
const nativeAxis = [5,10,12,17,20,30,60,120,300,360,600,720,1200,1800,3600,5400];
const allTypes = ["Swim","Bike","Run","Brick","Crosstrain","Race","Day off","Mtn Bike","Strength","Custom","XC-Ski","Rowing","Walk","Other"];
const ids = { Ride:"i720000001",Run:"i720000002",Other:"i720000003",Walk:"i720000004",Swim:"i720000005",Rowing:"i720000006",WeightTraining:"i720000007",Hike:"i720000008" };
async function fresh() {
  const context = await browser.newContext({ viewport:{width:1280,height:820}, locale:"en-US", colorScheme:"light" });
  network.attach(context);
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if(api(request.url()) === "performance-curves"&&new URL(request.url()).searchParams.get("kind")==="cadence") sourceReads.push(request.url()); if(api(request.url()) === "training-preferences" && request.method() === "POST") preferenceWrites.push(request.postDataJSON()); });
  await page.goto(origin + "/?theme=light", { waitUntil:"domcontentloaded" });
  await button("Analysis").waitFor(); assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);syntheticVerified=true;
}
async function json(route) { const response = await page.request.get(`${origin}/api/${route}`), body = await response.json(); assert.equal(response.ok(),true,`${route}: ${JSON.stringify(body)}`); readbacks.push({route,body}); return body; }
async function scenario(value) { assert.equal(syntheticVerified,true);if(value==="cap")capScenarioActive=true;const response=await page.request.post(`${origin}/api/preview/cadence-state`,{data:{scenario:value}}),body=await response.json();assert.equal(response.ok(),true,JSON.stringify(body));assert.equal(body.scenario,value);readbacks.push({route:"preview/cadence-state",body});oracle=await json("preview/cadence-sources");assert.equal(oracle.scenario,value);capScenarioActive=value==="cap"; }
async function analysis() { await button("Analysis").click(); await page.getByRole("region",{name:"Training analysis",exact:true}).waitFor(); }
async function configure() { await region().getByRole("button",{name:/^Configure /}).click(); await settings().waitFor(); }
async function settle() { await region().locator(".ddc-cadence-curve").waitFor(); await region().getByRole("status").filter({hasText:"Loading cadence chart"}).waitFor({state:"hidden"}); }
async function apply(wait = true) { await settings().getByRole("button",{name:"Apply & Close",exact:true}).click(); await settings().waitFor({state:"hidden"}); await page.getByText("Dashboard saved to server.",{exact:true}).waitFor(); if(wait)await settle(); }
async function dates(range) { await settings().getByRole("combobox",{name:"Date Range",exact:true}).selectOption("custom"); await settings().getByLabel("From",{exact:true}).fill(range.start); await settings().getByLabel("To",{exact:true}).fill(range.end); }
async function selectSports(names) { for(const name of allTypes)await settings().getByLabel(name,{exact:true}).setChecked(names === "all" || names.includes(name)); }
function weightedCadence(source, seconds) {
  const time = source.streams.find(stream=>stream.type === "time").data, cadence = source.streams.find(stream=>stream.type === "cadence").data;
  assert.equal(time[0],0); assert.equal(time[seconds],seconds); assert.equal(time.length,source.activity.elapsed_time+1);
  let sum = 0;
  for(let i=0;i<seconds;i++) { assert.ok(time[i+1]>time[i]); sum += cadence[i]*(time[i+1]-time[i]); }
  return sum/(time[seconds]-time[0]);
}
function candidates(selection,range) {
  return oracle.sources.filter(row=>{const activity=row.activity,date=activity.start_date_local.slice(0,10);return date>=range.start&&date<=range.end&&(selection==="all"||selection.split(",").includes(activity.type))&&activity.stream_types.includes("cadence");}).sort((a,b)=>b.activity.start_date_local.slice(0,10).localeCompare(a.activity.start_date_local.slice(0,10))||a.activity.id.localeCompare(b.activity.id)).slice(0,128);
}
function winner(selection, seconds, range) {
  return candidates(selection,range).filter(row=>{const curve=row.curve.find(curve=>curve.stream_type==="cadence"),index=curve?.secs.indexOf(seconds);return curve&&index>=0&&curve.values[index]!==null&&row.activity.elapsed_time>=seconds;}).sort((a,b)=>weightedCadence(b,seconds)-weightedCadence(a,seconds))[0]||null;
}
async function source(selection, range) {
  const query = new URLSearchParams({kind:"cadence",sport:selection,start:range.start,end:range.end});
  const curve = await json(`performance-curves?${query}`);
  assert.equal(curve.version,1); assert.equal(curve.kind,"cadence"); assert.equal(curve.unit,"rpm"); assert.equal(curve.source,"intervals-activity-cadence-curves");assert.equal(curve.unitPolicy,"native-rpm");assert.equal(curve.tagsSupported,false);
  assert.deepEqual(curve.selection,{sport:selection,nativeTypes:selection === "all" ? [] : selection.split(",").sort()});
  assert.deepEqual(curve.window,{oldest:range.start,newest:range.end});
  const expectedAxis=[...new Set(candidates(selection,range).flatMap(row=>row.curve.filter(curve=>curve.stream_type==="cadence").flatMap(curve=>curve.secs)))].sort((a,b)=>a-b);
  assert.deepEqual(curve.points.map(point=>point.duration_seconds),expectedAxis);
  for(const point of curve.points) {
    const expected = winner(selection,point.duration_seconds,range); assert.equal(point.estimated,false);
    if(!expected) { assert.equal(point.value,null); continue; }
    assert.equal(point.activity_id,expected.activity.id); assert.equal(point.native_type,expected.activity.type);
    assert.equal(point.date,shift(today,-1)); assert.ok(point.date>=range.start && point.date<=range.end);
    assert.equal(point.start_index,0); assert.equal(point.end_index,point.duration_seconds);
    assert.ok(Math.abs(point.value-weightedCadence(expected,point.duration_seconds))<1e-9);assert.equal(point.value,expected.rpm);
  }
  const known = curve.points.filter(point=>point.value!==null).length;
  assert.equal(curve.coverage.unknownPoints,curve.points.length-known);assert.equal(curve.coverage.fetchedRecordings,candidates(selection,range).length);
  return curve;
}
async function grid(primary, comparison = null) {
  const table = region().getByRole("table",{name:"Recorded peak cadence by duration",exact:true}); await table.waitFor();
  const rows = table.locator("tbody tr"); assert.equal(await rows.count(),15);
  assert.equal(await table.getByRole("columnheader").count(),comparison ? 5 : 3);
  for(const seconds of gridAxis) {
    const row = rows.filter({has:page.getByRole("rowheader",{name:durationText(seconds),exact:true})}), cells = await row.locator("td").allTextContents();
    for(const [index,curve] of [primary,comparison].entries()) {
      if(!curve)continue;
      const point = curve.points.find(point=>point.duration_seconds===seconds), known = point?.value != null;
      assert.equal(cells[index*2],known ? dateText(point.date) : "—"); assert.equal(cells[index*2+1],known ? String(point.value) : "—");
      assert.equal(await row.locator("td").nth(index*2).locator("button,a").count(),0,"Recording date is plain text");
      if(known)assert.equal(await row.locator("td").nth(index*2+1).getByRole("button").getAttribute("aria-label"),`Open cadence source recording for ${durationText(seconds)} on ${dateText(point.date)}`);
    }
  }
  return rows.allTextContents();
}
async function chart(primary, comparison = null) {
  await region().getByRole("img",{name:"Recorded peak cadence by exact effort duration",exact:true}).waitFor();
  const axis = [...new Set([primary,comparison].flatMap(curve=>curve?.points.map(point=>point.duration_seconds)||[]))].sort((a,b)=>a-b);
  for(const [index,curve] of [primary,comparison].entries()) {
    if(!curve)continue;
    const values=axis.map(seconds=>curve.points.find(point=>point.duration_seconds===seconds)?.value ?? null), count=values.filter(value=>value!==null).length;
    if(count<2)continue;
    let segments=0; values.forEach((value,i)=>{if(value!==null&&(i===0||values[i-1]===null))segments++;});
    const line=region().locator(`.recharts-line-curve[stroke="${index ? "#167eac" : "#d52424"}"]`); await line.waitFor(); const d=await line.getAttribute("d");
    assert.equal((d.match(/[ML]/g)||[]).length,count,"Keep every native point, including non-grid durations");
    assert.equal((d.match(/M/g)||[]).length,segments,"Native unknown points break the path");
  }
}
try {
  await fresh(); const before = await json("preview/provider-records"), initial = await json("personal-statistics"); today=initial.today; oracle=await json("preview/cadence-sources");
  assert.equal(oracle.today,today);assert.equal(oracle.scenario,"default"); assert.deepEqual(oracle.axis,nativeAxis); assert.equal(oracle.sources.length,8);
  const primary={start:shift(today,-27),end:today}, comparison={start:shift(today,-55),end:shift(today,-28)};
  await analysis(); await button("Charts Library").click(); await page.getByLabel("Search charts",{exact:true}).fill("Peak Cadence"); await button("Add Peak Cadence").click(); await page.getByText("Dashboard saved to server.",{exact:true}).waitFor(); await button("Close charts library").click(); await settle();
  await configure(); await dates(primary); await apply(); const all=await source("all",primary); await chart(all);
  assert.deepEqual(all.points.map(point=>point.value),[240,240,110,null,110,110,110,110,110,100,100,100,100,100,100,100]);
  assert.equal(oracle.sources.find(row=>row.activity.id===ids.Run).activity.icu_ignore_hr,true,"An HR-specific ignore flag must not discard cadence");
  assert.equal(oracle.sources.find(row=>row.activity.id===ids.WeightTraining).activity.elapsed_time,10);
  assert.deepEqual(all.coverage,{status:"partial",inventoryRecords:8,eligibleRecordings:7,fetchedRecordings:7,failedRecordings:1,missingRecordings:1,skippedForCap:0,excludedWithoutCadence:1,unknownPoints:1});
  await region().getByText(all.warning,{exact:true}).waitFor();
  checks.push("raw-weighted-rpm-native-all-multisport-winners-short-mask-missing-wrongstream-and-honest-partial-coverage");

  await configure(); assert.equal(await settings().getByLabel("Custom Title",{exact:true}).count(),1);
  assert.equal(await settings().getByRole("combobox",{name:"Date Range",exact:true}).locator("option").count(),25);
  assert.equal(await settings().getByRole("combobox",{name:"Comparison Date Range",exact:true}).locator("option").count(),25);
  assert.equal(await settings().getByRole("combobox",{name:"Comparison Date Range",exact:true}).isDisabled(),true);
  for(const name of [...allTypes,"All"])assert.equal(await (name==="All"?settings().getByRole("group",{name:"Workout Types",exact:true}):settings()).getByLabel(name,{exact:true}).isChecked(),true);
  assert.equal(await settings().getByLabel("By",{exact:true}).count(),0);assert.equal(await settings().getByLabel("Show Average",{exact:true}).count(),0);
  await settings().getByLabel("Grid",{exact:true}).check(); await apply(); await grid(all);
  assert.equal(await region().getByRole("rowheader",{name:"17 sec",exact:true}).count(),0,"17sec is native chart-only, not an invented grid anchor");
  checks.push("observed14-plus-all25-plus25-settings-and15-grid-anchors-use-rpm-buttons-and-plain-recording-dates");

  for(const [label,selection] of [["Run","Run"],["Bike","Ride"],["Strength","WeightTraining"],["Walk","Walk"],["Other","Other"],["Swim","Swim"]]) {
    await configure(); await selectSports([label]); await apply(); const curve=await source(selection,primary); await grid(curve);
    if(label === "Walk")assert.equal(await region().getByRole("button",{name:`Open cadence source recording for 5 sec on ${dateText(shift(today,-1))}`,exact:true}).innerText(),"0");
    if(label === "Strength")assert.deepEqual(curve.points.map(point=>point.value),[240,240,null]);
    if(label === "Run")assert.equal(curve.points.find(point=>point.duration_seconds===5).value,80.5,"Native Run cadence stays80.5RPM, never multiplied to161");
    if(label === "Bike")assert.equal(curve.points.find(point=>point.duration_seconds===5).value,100);
    if(label === "Swim"){assert.deepEqual(curve.points,[]);assert.equal(curve.coverage.missingRecordings,1);await region().getByText(/No verified recorded cadence efforts/).waitFor();}
  }
  checks.push("native-run-decimal-without-doubling-bike-short-strength-zero-walk-and-empty-swim-retain-source-semantics");

  await configure(); await selectSports("all"); await settings().getByLabel("Comparison",{exact:true}).check(); await settings().getByRole("combobox",{name:"Comparison Date Range",exact:true}).selectOption("custom"); await settings().getByLabel("Comparison From",{exact:true}).fill(comparison.start); await settings().getByLabel("Comparison To",{exact:true}).fill(comparison.end); await apply();
  const old=await source("all",comparison); assert.deepEqual(old.points,[]); await grid(all,old);
  const populatedRange={start:shift(today,-2),end:shift(today,-1)};
  await configure();await settings().getByLabel("Comparison From",{exact:true}).fill(populatedRange.start);await settings().getByLabel("Comparison To",{exact:true}).fill(populatedRange.end);await settings().getByLabel("Chart",{exact:true}).check();await apply();
  const populated=await source("all",populatedRange);assert.ok(populated.points.some(point=>point.value!==null));await chart(all,populated);
  await configure();await settings().getByLabel("Grid",{exact:true}).check();await apply();await grid(all,populated);
  await configure();await settings().getByLabel("Comparison From",{exact:true}).fill(comparison.start);await settings().getByLabel("Comparison To",{exact:true}).fill(comparison.end);await apply();const confirmed=await grid(all,old);
  checks.push("independent-empty-and-populated-comparison-windows-retain-exact-native-grid-and-both-svg-gap-paths");

  await configure(); await settings().getByLabel("Comparison From",{exact:true}).fill(today); const writes=preferenceWrites.length,reads=sourceReads.length;
  await settings().getByRole("button",{name:"Apply & Close",exact:true}).click(); await settings().getByRole("alert").filter({hasText:"start date"}).waitFor(); assert.equal(preferenceWrites.length,writes); assert.equal(sourceReads.length,reads); await settings().getByRole("button",{name:"Close chart settings",exact:true}).click();
  checks.push("invalid-comparison-date-blocks-real-preference-and-source-http");

  const match=url=>api(url.href)==="performance-curves"&&url.searchParams.get("kind")==="cadence";
  const rejected=route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic native cadence failure"})});
  await page.route(match,rejected); await button("Refresh training analysis").click(); await region().getByRole("alert").filter({hasText:"Synthetic native cadence failure"}).waitFor(); assert.deepEqual(await region().locator("tbody tr").allTextContents(),confirmed); await page.unroute(match,rejected); await region().getByRole("button",{name:"Retry cadence curve",exact:true}).click(); await region().getByRole("alert").waitFor({state:"hidden"}); await settle();
  checks.push("503-keeps-confirmed-primary-comparison-pair-and-explicit-retry-recovers");

  for(const mutation of ["window","selection","unit","unit-policy","tags","provenance","coverage"]) {
    const invalid=async route=>{const response=await route.fetch(),body=await response.json();if(mutation==="window")body.window.oldest=shift(body.window.oldest,-1);if(mutation==="selection")body.selection.sport="Run";if(mutation==="unit")body.unit="watts";if(mutation==="unit-policy")body.unitPolicy="doubled-run-rpm";if(mutation==="tags")body.tagsSupported=true;if(mutation==="provenance"&&body.points.length)body.points.find(point=>point.value!==null).date=shift(primary.start,-1);if(mutation==="coverage")body.coverage.fetchedRecordings+=1;await route.fulfill({response,json:body});};
    await page.route(match,invalid); await button("Refresh training analysis").click(); await region().getByRole("alert").waitFor(); assert.deepEqual(await region().locator("tbody tr").allTextContents(),confirmed); await page.unroute(match,invalid); await region().getByRole("button",{name:"Retry cadence curve",exact:true}).click(); await region().getByRole("alert").waitFor({state:"hidden"}); await settle();
  }
  checks.push("malformed200-window-selection-unit-native-rpm-policy-tags-provenance-and-coverage-never-replace-confirmed-pair");

  await configure(); await settings().getByLabel("Comparison",{exact:true}).uncheck(); await apply();
  const heldRange={start:shift(today,-89),end:shift(today,-62)}; let start,release,finish;
  const started=new Promise(resolve=>{start=resolve;}),held=new Promise(resolve=>{release=resolve;}),finished=new Promise(resolve=>{finish=resolve;});
  const holdMatch=url=>match(url)&&url.searchParams.get("start")===heldRange.start;
  const hold=async route=>{const response=await route.fetch();supersededUrls.add(route.request().url());start();await held;try{await route.fulfill({response});}finally{finish();}};
  await page.route(holdMatch,hold); await configure(); await dates(heldRange); await apply(false); await started; await configure(); await dates(primary); await apply(); const current=await grid(all); release(); await finished; await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); assert.deepEqual(await region().locator("tbody tr").allTextContents(),current); await page.unroute(holdMatch,hold);
  checks.push("aborted-late-source-response-cannot-replace-newer-confirmed-window");

  await configure(); await selectSports(["Brick"]); const beforeUnsupported=sourceReads.length; await apply(false); await region().getByText(/cannot identify Brick separately/).waitFor(); assert.equal(sourceReads.length,beforeUnsupported); await configure(); await selectSports("all"); await apply();
  checks.push("private-brick-selection-is-explicitly-unavailable-with-no-silent-native-other-fetch");

  await scenario("cap");assert.equal(oracle.sources.length,130);await button("Refresh training analysis").click();await settle();const capped=await source("all",primary);await grid(capped);
  assert.equal(capped.coverage.inventoryRecords,130);assert.equal(capped.coverage.eligibleRecordings,130);assert.equal(capped.coverage.fetchedRecordings,128);assert.equal(capped.coverage.skippedForCap,2);assert.equal(capped.coverage.status,"partial");
  assert.deepEqual(capped.points.map(point=>point.value),[82.7,82.7]);assert.ok(oracle.sources.slice(-2).every(row=>row.rpm===999));await region().getByText(capped.warning,{exact:true}).waitFor();
  const capReadback=await json("preview/cadence-sources"),nativeReads=capReadback.requests.filter(value=>/\/activity\/.+\/power-curves\.json\?types=cadence&fatigue=normal$/.test(value));assert.equal(nativeReads.length,128);assert.equal(new Set(nativeReads).size,128);assert.equal(nativeReads.some(value=>oracle.sources.slice(-2).some(row=>value.includes(row.activity.id))),false);limitations.native128RecordingCapBrowserVerified=true;
  await scenario("default");await button("Refresh training analysis").click();await settle();await grid(all);
  checks.push("actual130-recording-provider-inventory-fetches128-and-discloses-two-unread999rpm-sources-without-false-best");

  await configure(); await settings().getByLabel("Custom Title",{exact:true}).fill("Verified Cadence acceptance"); await settings().getByLabel("Comparison",{exact:true}).check(); await apply(); const prefs=await json("training-preferences");
  const layout=Object.values(prefs.training_preferences).filter(value=>value&&Array.isArray(value.instances)),stored=layout.flatMap(value=>value.instances).find(instance=>instance.settings?.title==="Verified Cadence acceptance"); assert.ok(stored); assert.equal(stored.cadence.display,"grid"); assert.equal(stored.cadence.comparison,true); assert.equal(stored.cadence.comparisonRange.start,comparison.start); assert.deepEqual([...stored.settings.sports].sort(),[...allTypes].sort());
  await fresh(); await analysis(); await settle(); await grid(all,old); await configure(); assert.equal(await settings().getByLabel("Custom Title",{exact:true}).inputValue(),"Verified Cadence acceptance"); assert.equal(await settings().getByLabel("Grid",{exact:true}).isChecked(),true); assert.equal(await settings().getByLabel("Comparison",{exact:true}).isChecked(),true); await settings().getByRole("button",{name:"Close chart settings",exact:true}).click();
  checks.push("actual-preference-readback-and-fresh-browser-context-retain-title-sports-grid-and-independent-comparison");

  await configure();await selectSports(["Run"]);await settings().getByLabel("Comparison",{exact:true}).uncheck();await apply();const run=await source("Run",primary);await grid(run);
  const known=run.points.find(point=>point.duration_seconds===5),raw=oracle.sources.find(source=>source.activity.id===known.activity_id); assert.equal(known.activity_id,ids.Run); assert.equal(weightedCadence(raw,5),80.5);
  const recording=await json(`workout-history/${known.activity_id}`); assert.equal(recording.workout.activity_id,known.activity_id); assert.equal(recording.workout.workout_date,known.date); assert.equal(recording.workout.activity_type,"Run"); limitations.rawCadenceSourceVerified=true;
  const requestsBefore=[];page.on("request",request=>requestsBefore.push(request.url())); await region().getByRole("button",{name:`Open cadence source recording for 5 sec on ${dateText(known.date)}`,exact:true}).click(); await page.waitForURL(url=>url.searchParams.get("workout")===`activity:${known.activity_id}`);
  assert.equal(new URL(page.url()).searchParams.has("effort"),false); assert.equal(await page.locator("[data-selected-effort-start],[data-selected-activity-effort]").count(),0); assert.equal(requestsBefore.some(url=>/performance-effort/.test(api(url))),false);
  // Actual reference action opens the normal Summary; Analyze is an available action.
  await page.getByRole("button",{name:"Analyze",exact:true}).waitFor();
  assert.equal(await page.getByRole("region",{name:"Recorded workout analysis",exact:true}).count(),0,"Cadence source opening must not automatically enter Analyze"); limitations.normalSummaryOpeningVerified=true;
  checks.push("raw-weighted-source-identity-date-and-rpm-open-normal-summary-without-auto-analysis-or-highlight");

  const after=await json("preview/provider-records"); assert.deepEqual(after.writes,before.writes); assert.deepEqual(errors,[]);
  const unexpected=network.entries.filter(entry=>entry.kind==="page-error" || entry.kind==="request-failed"&&!(supersededUrls.has(entry.url)&&/ERR_ABORTED/.test(entry.reason)) || entry.kind==="http-error"&&!(api(entry.url)==="performance-curves"&&new URL(entry.url).searchParams.get("kind")==="cadence"&&entry.status===503) || entry.kind==="console-error"&&!/Failed to load resource: the server responded with a status of 503\b/.test(entry.text)); assert.deepEqual(unexpected,[]);
  assert.equal(createHash("sha256").update(await fs.readFile(new URL("../ui/dist/index.html",import.meta.url))).digest("hex"),checkpoint.files.find(row=>row.file.endsWith("/ui/dist/index.html")).sha256,"UI artifact must remain frozen throughout the run");
  checks.push("cadence-browser-workflows-have-no-provider-writes-or-unexpected-runtime-and-network-errors"); assert.equal(checks.length,13);
  await page.screenshot({path:path.join(output,"verified-cadence.png"),animations:"disabled"});
} catch(error) {
  process.exitCode=1; errors.push(error.stack||error.message); console.error(error.stack||error.message);
  if(page) { await fs.writeFile(path.join(output,"failure-dom.txt"),await page.locator("body").innerText()).catch(()=>{}); await page.screenshot({path:path.join(output,"failure.png"),animations:"disabled"}).catch(()=>{}); }
} finally {
  if(capScenarioActive&&syntheticVerified)try{await scenario("default");}catch(error){errors.push(`Synthetic cadence scenario cleanup failed: ${error.message}`);console.error(errors.at(-1));process.exitCode=1;}
  const evidence=structuredClone(network.entries); await browser.close();
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({passed:checks.length,checks,errors,limitations,checkpoint,sourceReads,preferenceWrites},null,2));
  await fs.writeFile(path.join(output,"readbacks.json"),JSON.stringify(readbacks,null,2));
  await fs.writeFile(path.join(output,"network.json"),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({passed:checks.length,errors:errors.length,limitations}));
}
