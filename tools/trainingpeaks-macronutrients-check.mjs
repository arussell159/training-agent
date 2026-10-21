// Declared synthetic Wellness inputs over normal HTTP. No live provider or fixture mutation.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";
const require=createRequire(import.meta.url);let playwright;
try{playwright=require("playwright");}catch{playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const origin=process.env.APP_TEST_ORIGIN||"http://127.0.0.1:5213";assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const output=path.resolve("artifacts/trainingpeaks-macronutrients");await fs.mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({channel:"msedge",headless:true}),context=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light",locale:"en-US"});
const network=browserNetworkEvidence();network.attach(context);await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const page=await context.newPage();page.setDefaultTimeout(15000);
const checks=[],errors=[],servedContexts=[],preferenceWrites=[],readbacks=[];let injectedRows=null,readFailure="",customTitle="";
const limitations={referenceParityClaim:false,populatedTrainingPeaksPaletteVerified:false,trainingPeaksAggregationAlgorithmVerified:false,fixtureInjection:"Declared raw daily Wellness grams through standard training-context HTTP responses"};
const api=input=>{const url=new URL(input);return url.searchParams.get("__api_route")||url.pathname.replace(/^\/api\//,"");};
page.on("pageerror",error=>errors.push(error.message));page.on("request",request=>{if(api(request.url())==="training-preferences"&&request.method()==="POST")preferenceWrites.push(request.postDataJSON());});
const button=name=>page.getByRole("button",{name,exact:true}),card=()=>page.getByRole("region",{name:customTitle||/^Macronutrients by /,exact:Boolean(customTitle)}),settings=()=>page.locator(".ddc-settings");
const shift=(date,days)=>new Date(Date.parse(date+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
async function json(route){const response=await page.request.get(origin+"/api/"+route),body=await response.json();assert.equal(response.ok(),true);readbacks.push({route,body});return body;}
async function settle(){await card().waitFor();await card().getByRole("status").filter({hasText:"Loading chart"}).waitFor({state:"hidden"});}
async function configure(){await card().getByRole("button",{name:/^Configure /}).click();await settings().waitFor();}
async function dates(range){await settings().getByRole("combobox",{name:"Date Range",exact:true}).selectOption("custom");await settings().getByLabel("From",{exact:true}).fill(range.start);await settings().getByLabel("To",{exact:true}).fill(range.end);}
async function apply(){await settings().getByRole("button",{name:"Apply & Close",exact:true}).click();await settings().waitFor({state:"hidden"});await page.getByText("Dashboard saved to server.",{exact:true}).waitFor();await settle();}
// Real pointer movement in the equal-width categorical plot bands also reaches
// an explicitly recorded zero, whose bar correctly has zero height.
async function tooltip(index,buckets,expectedDate){
  const image=card().getByRole("img",{name:/, recorded nutrition by (day|week|month)$/}),svg=image.locator("svg.recharts-surface[role=application]");await image.scrollIntoViewIfNeeded();await svg.waitFor();
  const box=await svg.boundingBox(),geometry=await svg.evaluate(node=>{const line=node.querySelector(".recharts-cartesian-grid-horizontal line");return {width:node.viewBox.baseVal.width||node.width.baseVal.value,x1:Number(line?.getAttribute("x1")),x2:Number(line?.getAttribute("x2"))};});assert.ok(box);assert.ok(geometry.x2>geometry.x1);
  await page.mouse.move(box.x+(geometry.x1+(index+.5)*(geometry.x2-geometry.x1)/buckets)*box.width/geometry.width,box.y+100);
  const result=card().getByRole("status").filter({hasText:expectedDate});await result.waitFor();return result.innerText();
}
function contains(text,lines){for(const line of lines)assert.ok(text.includes(line),`Tooltip must include ${JSON.stringify(line)}; actual ${JSON.stringify(text)}`);}
await page.route(url=>api(url.href)==="training-context",async route=>{
  if(readFailure==="503")return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic nutrition source failed"})});
  const response=await route.fetch(),body=await response.json();
  if(!response.ok())return route.fulfill({response});
  // Native daily Wellness IDs become date+id rows in the normal context DTO.
  // Preserve any deliberately supplied conflicting date for malformed-row tests.
  const wireRows=injectedRows?.map(row=>({date:row.id,...row}));
  if(wireRows)body.wellness_history=structuredClone(wireRows);
  if(readFailure==="window"){body.context_scope="range";body.display_range={start:"1900-01-01",end:"1900-01-02"};}
  servedContexts.push({url:route.request().url(),declaredWellnessRows:wireRows?structuredClone(wireRows):null,body});
  await route.fulfill({response,json:body});
});
try{
  await page.goto(origin+"/?theme=light",{waitUntil:"networkidle"});assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true);const before=await json("preview/provider-records"),stats=await json("personal-statistics"),today=stats.today;
  const month=today.slice(0,7)+"-01",previousMonth=shift(month,-1).slice(0,7)+"-01";
  let monday=previousMonth;while(new Date(monday+"T12:00:00Z").getUTCDay()!==1)monday=shift(monday,1);
  const range={start:monday,end:shift(monday,9)},day1=monday,day2=shift(monday,1);
  await button("Analysis").click();await page.getByRole("region",{name:"Training analysis",exact:true}).waitFor();await button("Charts Library").click();await page.getByLabel("Search charts",{exact:true}).fill("Macronutrients");await button("Add Macronutrients by Time Period").click();await page.getByText("Dashboard saved to server.",{exact:true}).waitFor();await button("Close charts library").click();await settle();
  await card().getByText("No nutrition data is available to report on",{exact:true}).waitFor();await configure();assert.equal(await settings().getByLabel("Custom Title",{exact:true}).count(),1);assert.equal(await settings().getByRole("combobox",{name:"Date Range",exact:true}).locator("option").count(),25);assert.equal(await settings().getByRole("radio").count(),5);assert.equal(await settings().getByLabel("Week",{exact:true}).isChecked(),true);assert.equal(await settings().getByLabel("Display by Calories",{exact:true}).isChecked(),true);assert.equal(await settings().getByText("Workout Types",{exact:true}).count(),0);await settings().getByRole("button",{name:"Close chart settings",exact:true}).click();checks.push("actual-empty-nutrition-source-and-observed-custom-title-25-dates-five-radio-settings");

  injectedRows=[{id:day1,carbohydrates:100,protein:20,fatTotal:10},{id:day1,carbohydrates:100,protein:20,fatTotal:10},{id:day2,carbohydrates:50,protein:30,fatTotal:0}];
  await configure();await dates(range);await settings().getByLabel("Day",{exact:true}).check();customTitle="Controlled nutrition source";await settings().getByLabel("Custom Title",{exact:true}).fill(customTitle);await apply();
  // The dashboard may already have cached this month before the declared HTTP
  // fixture was activated. Use the real refresh action to request its new rows.
  await button("Refresh training analysis").click();await settle();
  contains(await tooltip(0,10,day1),["Carbohydrates: 100 g · 400 kcal","Protein: 20 g · 80 kcal","Fat: 10 g · 90 kcal","1 of 1 days recorded"]);contains(await tooltip(1,10,day2),["Carbohydrates: 50 g · 200 kcal","Protein: 30 g · 120 kcal","Fat: 0 g · 0 kcal"]);checks.push("raw-http-daily-grams-use-independent-four-four-nine-calories-and-identical-duplicates-count-once");

  await configure();await settings().getByLabel("Week",{exact:true}).check();await settings().getByLabel("Display by Percentage",{exact:true}).check();await apply();
  // 600 + 200 + 90 = 890 kcal; these are weighted nutrient percentages,
  // not an average of the two daily percentage ratios.
  const weighted=[600/890*100,200/890*100,90/890*100].map(value=>value.toLocaleString("en-US",{maximumFractionDigits:1})+"%");
  contains(await tooltip(0,2,day1),[`Carbohydrates: 150 g · ${weighted[0]}`,`Protein: 50 g · ${weighted[1]}`,`Fat: 10 g · ${weighted[2]}`,"2 of 7 days recorded"]);assert.notEqual(weighted[0],((400/570*100+200/320*100)/2).toLocaleString("en-US",{maximumFractionDigits:1})+"%");checks.push("weekly-percentage-is-independently-calorie-weighted-and-keeps-actual-source-date-coverage");

  await configure();await settings().getByLabel("Month",{exact:true}).check();await settings().getByLabel("Display by Calories",{exact:true}).check();await apply();contains(await tooltip(0,1,day1),[range.end,"Carbohydrates: 150 g · 600 kcal","Protein: 50 g · 200 kcal","Fat: 10 g · 90 kcal","2 of 10 days recorded"]);checks.push("monthly-calories-sum-real-source-grams-and-clip-bucket-dates-to-the-selected-range");

  injectedRows=[{id:day1,carbohydrates:0,protein:0,fatTotal:0},{id:day2,carbohydrates:20,protein:10},{id:shift(monday,2),carbohydrates:30,protein:5,fatTotal:2},{id:shift(monday,2),carbohydrates:40,protein:5,fatTotal:2},{id:shift(monday,3),date:shift(monday,4),carbohydrates:999,protein:999,fatTotal:999}];
  await button("Refresh training analysis").click();await settle();await configure();await settings().getByLabel("Day",{exact:true}).check();await apply();contains(await tooltip(0,10,day1),["Carbohydrates: 0 g · 0 kcal","Protein: 0 g · 0 kcal","Fat: 0 g · 0 kcal"]);contains(await tooltip(1,10,day2),["Carbohydrates: 20 g · 80 kcal","Protein: 10 g · 40 kcal","Fat: Not recorded"]);contains(await tooltip(2,10,shift(monday,2)),["Carbohydrates: Not recorded","Protein: 5 g · 20 kcal","Fat: 2 g · 18 kcal"]);await card().getByText("Conflicting nutrient values for the same day are unavailable.",{exact:true}).waitFor();await configure();await settings().getByLabel("Display by Percentage",{exact:true}).check();await apply();await card().getByText("Percentages are unavailable for zero recorded calories.",{exact:true}).waitFor();await card().getByText("No complete nutrition totals are available for percentage display.",{exact:true}).waitFor();checks.push("explicit-zero-missing-nutrients-and-conflicting-duplicates-remain-distinct-without-fabricated-percentages");

  const boundary={start:shift(month,-1),end:month};injectedRows=[{id:boundary.start,carbohydrates:10,protein:0,fatTotal:0},{id:boundary.end,carbohydrates:0,protein:10,fatTotal:0}];await configure();await dates(boundary);await settings().getByLabel("Month",{exact:true}).check();await settings().getByLabel("Display by Calories",{exact:true}).check();await apply();await button("Refresh training analysis").click();await settle();contains(await tooltip(0,2,boundary.start),["Carbohydrates: 10 g · 40 kcal","Protein: 0 g · 0 kcal","1 of 1 days recorded"]);contains(await tooltip(1,2,boundary.end),["Carbohydrates: 0 g · 0 kcal","Protein: 10 g · 40 kcal","1 of 1 days recorded"]);checks.push("adjacent-calendar-months-keep-separate-clipped-source-dates-and-totals");

  for(const failure of ["503","window"]){readFailure=failure;await button("Refresh training analysis").click();await card().getByRole("alert").waitFor();contains(await tooltip(0,2,boundary.start),["Carbohydrates: 10 g · 40 kcal"]);readFailure="";await card().getByRole("button",{name:"Retry chart",exact:true}).click();await card().getByRole("alert").waitFor({state:"hidden"});await settle();}checks.push("failed-read-and-wrong-window200-retain-confirmed-nutrition-and-explicit-retry-recovers");

  await configure();await settings().getByLabel("From",{exact:true}).fill(shift(month,1));const oldWrites=preferenceWrites.length;await settings().getByRole("button",{name:"Apply & Close",exact:true}).click();await settings().getByRole("alert").filter({hasText:"start date"}).waitFor();assert.equal(preferenceWrites.length,oldWrites);await settings().getByRole("button",{name:"Close chart settings",exact:true}).click();await page.reload({waitUntil:"networkidle"});await button("Analysis").click();await card().waitFor();await settle();await configure();assert.equal(await settings().getByLabel("Custom Title",{exact:true}).inputValue(),customTitle);assert.equal(await settings().getByLabel("Month",{exact:true}).isChecked(),true);assert.equal(await settings().getByLabel("Display by Calories",{exact:true}).isChecked(),true);assert.equal(await settings().getByLabel("From",{exact:true}).inputValue(),boundary.start);assert.equal(await settings().getByLabel("To",{exact:true}).inputValue(),boundary.end);await settings().getByRole("button",{name:"Close chart settings",exact:true}).click();contains(await tooltip(1,2,boundary.end),["Protein: 10 g · 40 kcal"]);checks.push("invalid-range-prevents-write-and-custom-title-grouping-display-and-dates-survive-fresh-session");

  const preferences=await json("training-preferences"),layouts=Object.values(preferences.training_preferences).filter(value=>value&&Array.isArray(value.instances)),stored=layouts.flatMap(value=>value.instances).find(instance=>instance.settings?.title===customTitle);assert.ok(stored);assert.deepEqual(stored.macronutrients,{period:"month",display:"calories"});assert.equal(stored.settings.start,boundary.start);assert.equal(stored.settings.end,boundary.end);const after=await json("preview/provider-records");assert.deepEqual(after.writes,before.writes);assert.deepEqual(errors,[]);assert.deepEqual(network.entries.filter(entry=>entry.kind==="request-failed"||entry.kind==="page-error"||entry.kind==="http-error"&&!(api(entry.url)==="training-context"&&entry.status===503)||entry.kind==="console-error"&&!/Failed to load resource: the server responded with a status of 503\b/.test(entry.text)),[]);checks.push("declared-input-browser-workflows-make-no-provider-writes-or-unexpected-runtime-network-errors");await page.screenshot({path:path.join(output,"verified-macronutrients.png"),animations:"disabled"});
}catch(error){process.exitCode=1;errors.push(error.stack||error.message);console.error(error.message);await fs.writeFile(path.join(output,"failure-dom.txt"),await page.locator("body").innerText()).catch(()=>{});await page.screenshot({path:path.join(output,"failure.png"),animations:"disabled"}).catch(()=>{});}
finally{const evidence=structuredClone(network.entries);await browser.close();await fs.writeFile(path.join(output,"results.json"),JSON.stringify({synthetic:true,passed:checks.length,checks,errors,limitations,preferenceWrites},null,2));await fs.writeFile(path.join(output,"declared-http-sources.json"),JSON.stringify(servedContexts,null,2));await fs.writeFile(path.join(output,"readbacks.json"),JSON.stringify(readbacks,null,2));await fs.writeFile(path.join(output,"network.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:checks.length,errors:errors.length,limitations}));}
