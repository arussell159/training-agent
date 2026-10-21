// Synthetic localhost evidence, never a TrainingPeaks parity percentage.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5213";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/trainingpeaks-peak-pace");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: "en-US", colorScheme: "light" });
const network = browserNetworkEvidence(); network.attach(context);
await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage(); page.setDefaultTimeout(15000);
const checks = [], errors = [], readbacks = [], requests = [], preferenceWrites = [], supersededUrls = new Set();
let paceSourceOracle;
const limitations = { visualPercentageCertified: false, paceSegmentBoundsVerified: false, ignoredActivityExclusionBrowserVerified: false };
const api = input => { const url = new URL(input); return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, ""); };
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (api(request.url()) === "personal-statistics") requests.push(request.url()); if (api(request.url()) === "training-preferences" && request.method() === "POST") preferenceWrites.push(request.postDataJSON()); });
const button = name => page.getByRole("button", { name, exact: true });
const pace = () => page.getByRole("region", { name: /^Peak Pace by Distance/ });
const settings = () => page.locator(".ddc-settings");
const shift = (date, days) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const observed = [[800,"800 m"],[1000,"1 km"],[1600,"1600 m"],[1609.344,"1 mi"],[5000,"5 km"],[8046.72,"5 mi"],[10000,"10 km"],[15000,"15 km"],[16093.44,"10 mi"],[21097.5,"HM"],[30000,"30 km"]];
// Independent literal fixture inputs; do not import the renderer or its helpers.
const elapsed = {
  Run: new Map([[400,88],[800,200],[1000,250],[1100,220],[1200,300],[1234,0],[1600,400],[1609.344,386],[5000,1320],[8046.72,2200],[10000,2810],[15000,4380],[16093.44,4720],[21097.5,6400],[30000,9500]]),
  Swim: new Map([[91.44,80],[100,100],[150,150],[182.88,166],[200,200],[300,300],[365.76,338],[400,376],[548.64,525],[731.52,708],[914.4,901],[1000,1000],[1500,1540]])
};
const clock = seconds => { const rounded = Math.round(seconds); return `${String(Math.floor(rounded / 60)).padStart(2,"0")}:${String(rounded % 60).padStart(2,"0")}`; };
const paceText = (sport, point) => point?.value == null ? "—" : clock(point.elapsed_seconds * (sport === "Run" ? 1609.344 : 91.44) / point.distance_meters);
async function json(route) { const response = await page.request.get(origin + "/api/" + route); const body = await response.json(); assert.equal(response.ok(), true, JSON.stringify(body)); readbacks.push({ route, body }); return body; }
async function configure() { await pace().getByRole("button", { name: /^Configure / }).click(); await settings().waitFor(); }
async function settle() { await pace().locator(".ddc-pace-curve").waitFor(); await pace().getByRole("status").filter({ hasText: "Loading pace chart" }).waitFor({ state: "hidden" }); }
async function apply(wait = true) { await settings().getByRole("button", { name: "Apply & Close", exact: true }).click(); await settings().waitFor({ state: "hidden" }); await page.getByText("Dashboard saved to server.", { exact: true }).waitFor(); if (wait) await settle(); }
async function dates(range) { await settings().getByRole("combobox", { name: "Date Range", exact: true }).selectOption("custom"); await settings().getByLabel("From", { exact: true }).fill(range.start); await settings().getByLabel("To", { exact: true }).fill(range.end); }
async function source(sport, range) {
  const body = await json(`personal-statistics?oldest=${range.start}&newest=${range.end}`), curve = body.paceCurves[sport];
  assert.deepEqual(body.bestEffortsWindow, { oldest: range.start, newest: range.end });
  assert.deepEqual(curve.window, { oldest: range.start, newest: range.end });
  assert.equal(curve.version, 1); assert.equal(curve.kind, "pace"); assert.equal(curve.unit, "m/s"); assert.equal(curve.source, "intervals-pace-curve"); assert.equal(curve.sport, sport);
  assert.deepEqual(curve.points.map(point => point.distance_meters), [...elapsed[sport].keys()].sort((a,b)=>a-b));
  for (const point of curve.points) {
    assert.equal(point.estimated, false);
    const seconds = elapsed[sport].get(point.distance_meters);
    const chosen=paceSourceOracle.sources.find(source=>source.activity.type===sport&&source.curve.distance.includes(point.distance_meters));
    const chosenDate=chosen?.activity.start_date_local.slice(0,10);
    const eligible = chosen ? chosen.activity.ignore_pace!==true&&chosenDate>=range.start&&chosenDate<=range.end&&chosen.activity.distance>=point.distance_meters&&chosen.activity.elapsed_time>=seconds : seconds > 0 && body.records.some(record => record.sport === sport && record.date >= range.start && record.date <= range.end && record.distance_meters >= point.distance_meters && record.duration_seconds >= seconds);
    if (!eligible) { assert.equal(point.value, null); assert.equal(point.elapsed_seconds, null); if(chosen)assert.equal(point.activity_id,chosen.activity.id); continue; }
    assert.equal(point.elapsed_seconds, seconds); assert.ok(Math.abs(point.value - point.distance_meters / seconds) < 1e-10);
    const recording = body.records.find(record => record.id === point.activity_id); assert.ok(recording); assert.equal(recording.sport, sport); assert.equal(recording.date, point.date); assert.ok(recording.distance_meters >= point.distance_meters); assert.ok(recording.duration_seconds >= seconds);if(chosen)assert.equal(point.activity_id,chosen.activity.id);
  }
  return curve;
}
function expectedRows(primary, comparison) {
  const known = new Set([...primary.points, ...(comparison?.points || [])].filter(point => point.value !== null).map(point => point.distance_meters));
  return primary.sport === "Run" ? observed.filter(([meters]) => known.has(meters)) : [...known].sort((a,b)=>a-b).map(meters => [meters, `${meters.toLocaleString("en-US", { maximumFractionDigits: 4 })} m`]);
}
async function grid(primary, comparison = null) {
  const rows = pace().locator("tbody tr"), expected = expectedRows(primary, comparison); assert.equal(await rows.count(), expected.length);
  for (const [meters, label] of expected) {
    const row = rows.filter({ has: page.getByRole("rowheader", { name: label, exact: true }) }), cells = await row.locator("td").allTextContents();
    assert.equal(cells[1], paceText(primary.sport, primary.points.find(point => point.distance_meters === meters)));
    if (comparison) assert.equal(cells[3], paceText(primary.sport, comparison.points.find(point => point.distance_meters === meters)));
  }
  return rows.allTextContents();
}
async function chart(curves) {
  await pace().getByRole("img", { name: `Recorded ${curves[0].sport} pace by exact distance`, exact: true }).waitFor();
  const distances = [...new Set(curves.flatMap(curve => curve.points.map(point => point.distance_meters)))].sort((a,b)=>a-b);
  for (const [index, curve] of curves.entries()) {
    const points = distances.map(meters => curve.points.find(point => point.distance_meters === meters)?.value ?? null), count = points.filter(value => value !== null).length;
    let segments = 0; points.forEach((value, i) => { if (value !== null && (i === 0 || points[i-1] === null)) segments++; });
    const paths = pace().locator(`.recharts-line-curve[stroke="${index ? "#167eac" : "#d52424"}"]`); await paths.first().waitFor(); const d = (await paths.getAttribute("d")) || "";
    assert.equal((d.match(/[ML]/g) || []).length, count, "Every exact non-null native point must remain in the chart, including non-grid distances");
    assert.equal((d.match(/M/g) || []).length, segments, "Explicit nulls must break the path; no interpolation across missing efforts");
  }
}
try {
  await page.goto(origin + "/?theme=light", { waitUntil: "networkidle" }); assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic), true);
  const before = await json("preview/provider-records"), initial = await json("personal-statistics"), today = initial.today;paceSourceOracle=await json("preview/pace-sources");assert.equal(paceSourceOracle.today,today);
  const primary = { start: shift(today,-27), end: today }, comparison = { start: shift(today,-55), end: shift(today,-28) };
  await button("Analysis").click(); await page.getByRole("region", { name: "Training analysis", exact: true }).waitFor();
  await button("Charts Library").click(); await page.getByLabel("Search charts", { exact: true }).fill("Peak Pace by Distance"); await button("Add Peak Pace by Distance").click(); await page.getByText("Dashboard saved to server.", { exact: true }).waitFor(); await button("Close charts library").click(); await settle();
  const run = await source("Run", primary); assert.equal(run.points.find(point => point.distance_meters === 1234).value, null);for(const [sport,meters,id] of [["Run",1100,"i700000011"],["Run",1200,"i700000012"],["Swim",150,"i700000021"],["Swim",300,"i700000022"]]){const native=paceSourceOracle.sources.find(source=>source.activity.id===id);assert.ok(native);assert.ok(native.curve.values[0]>0);assert.ok(native.activity.ignore_pace===true||native.activity.distance<meters||native.activity.elapsed_time<native.curve.values[0]);const actual=(sport==="Run"?run:await source("Swim",primary)).points.find(point=>point.distance_meters===meters);assert.equal(actual.value,null);assert.equal(actual.elapsed_seconds,null);}limitations.ignoredActivityExclusionBrowserVerified=true;await chart([run]); checks.push("independent-literal-run-distance-elapsed-ignored-short-source-eligibility-and-full-native-chart-with-real-null-gap");

  await configure(); assert.equal(await settings().getByLabel("Run", { exact: true }).isChecked(), true); assert.equal(await settings().getByLabel("Swim", { exact: true }).isChecked(), false); assert.equal(await settings().getByRole("combobox", { name: "Date Range", exact: true }).locator("option").count(), 25); assert.equal(await settings().getByRole("combobox", { name: "Comparison Date Range", exact: true }).locator("option").count(), 25); assert.equal(await settings().getByLabel("Show Average", { exact: true }).count(), 0); await settings().getByLabel("Grid", { exact: true }).check(); await apply(); await grid(run); assert.equal(await pace().getByRole("rowheader", { name: "400 m", exact: true }).count(), 0); checks.push("observed-exact-run-grid-uses-physical-minutes-per-mile-without-nearby-anchor-remapping");

  await configure(); await settings().getByLabel("Comparison", { exact: true }).check(); await settings().getByRole("combobox", { name: "Comparison Date Range", exact: true }).selectOption("custom"); await settings().getByLabel("Comparison From", { exact: true }).fill(comparison.start); await settings().getByLabel("Comparison To", { exact: true }).fill(comparison.end); await apply(); const other = await source("Run", comparison); await grid(run, other); assert.ok(other.points.some(point=>point.value !== null)); checks.push("independent-comparison-window-preserves-native-source-dates-and-exact-pace-columns");

  await configure(); await settings().getByLabel("Comparison From", { exact: true }).fill(today); const writesBefore = preferenceWrites.length, readsBefore = requests.length; await settings().getByRole("button", { name: "Apply & Close", exact: true }).click(); await settings().getByRole("alert").filter({hasText:"start date"}).waitFor(); assert.equal(preferenceWrites.length,writesBefore); assert.equal(requests.length,readsBefore); await settings().getByRole("button", { name: "Close chart settings", exact: true }).click(); checks.push("invalid-comparison-range-blocks-preference-write-and-source-http");

  const oldRows = await grid(run, other), match = url => api(url.href) === "personal-statistics";
  const reject = route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({error:"Synthetic recorded pace failure"}) });
  await page.route(match,reject); await button("Refresh training analysis").click(); await pace().getByRole("alert").filter({hasText:"Synthetic recorded pace failure"}).waitFor(); assert.deepEqual(await pace().locator("tbody tr").allTextContents(),oldRows); await page.unroute(match,reject); await pace().getByRole("button",{name:"Retry pace curve",exact:true}).click(); await pace().getByRole("alert").waitFor({state:"hidden"}); await settle(); checks.push("failed503-keeps-both-confirmed-curves-and-explicit-retry-recovers");

  for (const mutation of ["window", "ratio", "sport-error"]) {
    const wrong = async route => { const response = await route.fetch(), body = await response.json(); if(mutation === "window")body.paceCurves.Run.window.oldest=shift(body.paceCurves.Run.window.oldest,-1); else if(mutation === "ratio")body.paceCurves.Run.points.find(point=>point.value !== null).value*=2; else body.paceCurveErrors={Run:"Synthetic incomplete selected pace source"}; await route.fulfill({response,json:body}); };
    await page.route(match,wrong); await button("Refresh training analysis").click(); await pace().getByRole("alert").waitFor(); assert.deepEqual(await pace().locator("tbody tr").allTextContents(),oldRows); await page.unroute(match,wrong); await pace().getByRole("button",{name:"Retry pace curve",exact:true}).click(); await pace().getByRole("alert").waitFor({state:"hidden"}); await settle();
  }
  checks.push("wrong-window-wrong-physical-ratio-and-selected-source-error-in-successful200-cannot-replace-confirmed-pair");

  await configure(); await settings().getByLabel("Comparison",{exact:true}).uncheck(); await apply();
  const heldRange={start:shift(today,-89),end:shift(today,-62)}; let started,release,finished;
  const intercepted=new Promise(resolve=>{started=resolve;}), held=new Promise(resolve=>{release=resolve;}), completed=new Promise(resolve=>{finished=resolve;});
  const holdMatch=url=>match(url)&&url.searchParams.get("oldest")===heldRange.start;
  const hold=async route=>{const response=await route.fetch();supersededUrls.add(route.request().url());started();await held;try{await route.fulfill({response});}finally{finished();}};
  await page.route(holdMatch,hold); await configure(); await dates(heldRange); await apply(false); await intercepted;
  await configure(); await dates(primary); await apply(); const latestRows=await grid(run); release(); await completed; await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); assert.deepEqual(await pace().locator("tbody tr").allTextContents(),latestRows); await page.unroute(holdMatch,hold); checks.push("late-aborted-prior-window-cannot-replace-newer-confirmed-visible-source");

  await configure(); await settings().getByLabel("Run",{exact:true}).uncheck(); await settings().getByLabel("Swim",{exact:true}).check(); await apply(); const swim=await source("Swim",primary); await grid(swim); await pace().getByText("Swim pace · min/100 yd",{exact:true}).waitFor(); const swim100yd=swim.points.find(point=>point.distance_meters===91.44); assert.equal(swim100yd.elapsed_seconds,80); assert.equal(paceText("Swim",swim100yd),"01:20"); await configure(); await settings().getByLabel("Chart",{exact:true}).check(); await apply(); await chart([swim]); checks.push("swim-native-physical-metres-retain-all-chart-points-and-convert-independently-to-pace-per100yards");

  await configure(); await settings().getByLabel("Swim",{exact:true}).uncheck(); await settings().getByLabel("Run",{exact:true}).check(); await settings().getByLabel("Grid",{exact:true}).check(); await dates({start:today,end:today}); await apply(); const emptyRun=await source("Run",{start:today,end:today}); assert.equal(emptyRun.points.every(point=>point.value===null),true); assert.equal(await pace().locator("tbody tr").count(),0); await pace().getByText("No recorded pace efforts are available for the selected ranges.",{exact:true}).waitFor(); assert.equal(await pace().getByRole("columnheader").count(),5); checks.push("today-only-empty-run-retains-grid-header-and-does-not-fabricate-zero-or-interpolated-pace");

  await configure(); await dates(primary); await settings().getByLabel("Comparison",{exact:true}).check(); await settings().getByRole("combobox",{name:"Comparison Date Range",exact:true}).selectOption("custom"); await settings().getByLabel("Comparison From",{exact:true}).fill(comparison.start); await settings().getByLabel("Comparison To",{exact:true}).fill(comparison.end); await apply();
  await configure(); await settings().getByLabel("Swim",{exact:true}).check(); const beforeUnsupported=requests.length; await apply(false); await pace().getByText(/Choose Run or Swim individually/).waitFor(); assert.equal(requests.length,beforeUnsupported); await configure(); await settings().getByLabel("Swim",{exact:true}).uncheck(); await apply();
  await page.reload({waitUntil:"networkidle"}); await button("Analysis").click(); await pace().waitFor(); await settle(); await grid(run,other); await configure(); assert.equal(await settings().getByLabel("Grid",{exact:true}).isChecked(),true); assert.equal(await settings().getByLabel("Comparison",{exact:true}).isChecked(),true); assert.equal(await settings().getByLabel("Comparison From",{exact:true}).inputValue(),comparison.start); assert.equal(await settings().getByLabel("Run",{exact:true}).isChecked(),true); assert.equal(await settings().getByLabel("Swim",{exact:true}).isChecked(),false); assert.equal(await settings().locator(".ddc-sports input[type=checkbox]").count(),14); await settings().getByRole("button",{name:"Close chart settings",exact:true}).click(); checks.push("combined-sports-are-explicitly-unavailable-and-real-grid-comparison-sport-settings-survive-full-reload");

  const point=run.points.find(point=>point.distance_meters===800&&point.value!==null); assert.ok(point); const recording=await json(`workout-history/${point.activity_id}`); assert.equal(recording.workout.activity_id,point.activity_id); assert.equal(recording.workout.workout_date,point.date); assert.ok(point.date>=primary.start&&point.date<=primary.end); assert.equal(point.activity_id,"i700000001");assert.equal(point.start_index,0);assert.equal(point.end_index,200);
  for(const [sport,id,meters,seconds] of [["Run","i700000001",800,200],["Swim","i700000002",100,100]]){const raw=paceSourceOracle.sources.find(source=>source.activity.id===id),times=raw.streams.find(stream=>stream.type==="time").data,distances=raw.streams.find(stream=>stream.type==="distance").data;assert.equal(times[seconds]-times[0],seconds);assert.equal(distances[seconds]-distances[0],meters);assert.equal(times.length,401);for(let i=1;i<times.length;i++){assert.equal(times[i]-times[i-1],1);assert.equal(distances[i]-distances[i-1],sport==="Run"?4:1);}const bound=await json(`activities/${id}/performance-effort?type=${sport}&distance=${meters}`);assert.equal(bound.available,true);assert.equal(bound.value,meters/seconds);assert.equal(bound.chart_start_seconds,times[0]);assert.equal(bound.chart_end_seconds,times[seconds]);}
  const sourceButton=pace().locator("tbody tr").filter({has:page.getByRole("rowheader",{name:"800 m",exact:true})}).locator("button").first(); await sourceButton.click(); await page.waitForURL(url=>url.searchParams.get("workout")===`activity:${point.activity_id}`); const target=JSON.parse(new URL(page.url()).searchParams.get("effort")); assert.equal(target.activityId,point.activity_id); assert.equal(target.distanceMeters,800); assert.equal(target.value,4); assert.equal(target.sport,"Run"); await page.getByRole("region",{name:"Recorded workout analysis",exact:true}).waitFor();await page.locator('[data-selected-effort-start="0"][data-selected-effort-end="200"]').waitFor();limitations.paceSegmentBoundsVerified=true;checks.push("source-id-date-window-and-800m200s-raw-recording-indices-bind-to-the-actual-selected-workout-segment");

  const after=await json("preview/provider-records"); assert.deepEqual(after.writes,before.writes); assert.deepEqual(errors,[]);
  assert.deepEqual(network.entries.filter(entry=>entry.kind==="page-error"||entry.kind==="request-failed"&&!(supersededUrls.has(entry.url)&&/ERR_ABORTED/.test(entry.reason))||entry.kind==="http-error"&&!(api(entry.url)==="personal-statistics"&&entry.status===503)||entry.kind==="console-error"&&!/Failed to load resource: the server responded with a status of 503\b/.test(entry.text)),[]);
  checks.push("pace-workflows-have-no-provider-writes-or-unexpected-runtime-network-errors"); await page.screenshot({path:path.join(output,"verified-pace-source.png"),animations:"disabled"});
} catch(error) { process.exitCode=1; errors.push(error.stack||error.message); console.error(error.message); await fs.writeFile(path.join(output,"failure-dom.txt"),await page.locator("body").innerText()).catch(()=>{}); await page.screenshot({path:path.join(output,"failure.png"),animations:"disabled"}).catch(()=>{}); }
finally { const evidence=structuredClone(network.entries); await browser.close(); await fs.writeFile(path.join(output,"results.json"),JSON.stringify({synthetic:true,referenceParityClaim:false,passed:checks.length,checks,errors,limitations,preferenceWrites,sourceReads:requests},null,2)); await fs.writeFile(path.join(output,"readbacks.json"),JSON.stringify(readbacks,null,2)); await fs.writeFile(path.join(output,"network.json"),JSON.stringify(evidence,null,2)); console.log(JSON.stringify({passed:checks.length,errors:errors.length,limitations})); }
