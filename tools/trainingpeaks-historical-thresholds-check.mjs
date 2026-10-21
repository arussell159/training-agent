// Synthetic localhost verification of recorded rather than current thresholds.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);
let playwright;
try { playwright=require("playwright"); }
catch { playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin=process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5218";
assert.ok(["127.0.0.1","localhost"].includes(new URL(origin).hostname),"Synthetic localhost only");
const output=path.resolve("artifacts/historical-thresholds");
await fs.mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({headless:true,channel:"msedge"});
const errors=[],checks=[];
const apiPath=url=>url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//,"");
try {
  for(const historical of [true,false]) {
    const context=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light"});
    const page=await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror",error=>errors.push(error.message));
    await context.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin) return route.abort();
      const match=apiPath(url).match(/^activities\/[^/]+\/(summary|analysis)$/);
      if(!match) return route.continue();
      const source=await route.fetch();
      assert.ok(source.ok());
      if(match[1]==="summary") {
        const actual=await source.json();
        return route.fulfill({response:source,json:{...actual,normalized_power:200,intensity_factor:0.75,recorded_thresholds:{version:1,source:"intervals-activity",ftp:historical?100:null,powerZones:historical?[55,75,100,999]:[],thresholdPace:null,paceZones:[]}}});
      }
      return route.fulfill({response:source,json:{version:8,duration:120,points:Array.from({length:121},(_,time)=>({time,power:200,heartRate:140,distance:time*5,speed:5,cadence:90})),laps:[{id:"constant",label:"Constant power",start:0,end:120,power:200,heartRate:140,distance:600,kind:"lap"}],intervals:[]}});
    });
    await page.goto(`${origin}/calendar?theme=light`,{waitUntil:"networkidle"});
    assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true);
    const live=await (await page.request.get(`${origin}/api/training-context`)).json();
    assert.notEqual(live.athlete.zones?.bike_ftp,100,"Current fixture FTP differs from historical threshold");
    await page.getByRole("button",{name:/^Threshold intervals — recorded power and route Duration/}).press("Enter");
    await page.getByRole("button",{name:"Analyze 360",exact:true}).click();
    await page.getByRole("tab",{name:"Lap Comparison",exact:true}).click();
    const table=page.getByRole("region",{name:"Recorded laps",exact:true}).locator("table");
    await table.getByRole("button",{name:"Constant power",exact:true}).waitFor({state:"visible"});
    const cells=await table.evaluate(node=>{
      const headings=Array.from(node.querySelectorAll("thead th")).map(e=>e.textContent.trim());
      const values=Array.from(node.querySelectorAll("tbody tr:first-child td")).map(e=>e.textContent.trim());
      return Object.fromEntries(headings.map((heading,index)=>[heading,values[index]]));
    });
    assert.equal(cells["NP (W)"],"200");
    if (historical) assert.equal(Number(cells.IF),2);
    else assert.equal(cells.IF,"—");
    assert.equal(cells.TSS,historical?"13":"—");
    await page.screenshot({path:path.join(output,historical?"recorded-ftp.png":"historical-ftp-unavailable.png"),animations:"disabled"});
    checks.push({name:historical?"recorded-FTP-overrides-current-settings-and-unrelated-summary-IF":"missing-historical-FTP-does-not-infer-from-summary-IF-or-current-settings",cells});
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
} finally {
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({checks,errors},null,2));
  await browser.close();
}
