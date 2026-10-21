// Controlled matched-state captures, isolated preview only; no provider writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const origin=process.env.APP_TEST_ORIGIN||"http://127.0.0.1:5228";
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const output=path.resolve(process.env.ENDURANCE_EVIDENCE||"artifacts/endurance-current-reference/matched");
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"msedge"});
const states=[];
try {
  for(const sport of ["Run","Bike","Swim"]) {
    const context=await browser.newContext({viewport:{width:1280,height:820},colorScheme:"light",deviceScaleFactor:1});
    await context.route("**/api/**",async route=>{
      const response=await route.fetch(),type=response.headers()["content-type"]||"";
      if(!type.includes("json"))return route.fulfill({response});
      const body=await response.json();
      const nativeSettings=[
        {types:["Ride","Bike","VirtualRide"],ftp:197,power_zones:[55,75,90,105,1015.2284]},
        {types:["Run"],threshold_pace:1609.344/530,pace_zones:[80,90,95,100,999]},
        {types:["Swim"],threshold_pace:91.44/Number(process.env.REFERENCE_SWIM_PACE||93),pace_zones:[80,90,95,105,999]},
      ];
      let changed=false;
      if(body.model?.sport) {
        body.model.thresholds={ftp:197,pace:body.model.sport==="Swim"?91.44/Number(process.env.REFERENCE_SWIM_PACE||93):1609.344/530};
        changed=true;
      }
      if(Array.isArray(body.zoneSettings)){body.zoneSettings=nativeSettings;changed=true;}
      if(body.athlete?.sport_settings) {
        body.athlete.sport_settings=nativeSettings;
        body.metrics={fitness:75,fatigue:45,form:24};
        changed=true;
      }
      return changed?route.fulfill({response,json:body}):route.fulfill({response});
    });
    const page=await context.newPage();page.setDefaultTimeout(12000);
    await page.goto(`${origin}/calendar?theme=light`,{waitUntil:"networkidle"});
    assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true);
    await page.mouse.wheel(0,1);
    const today=new Date(),plus=page.getByRole("button",{name:`Add workout for ${today.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`,exact:true});
    await plus.evaluate(node=>node.scrollIntoView({block:"center",inline:"nearest"}));
    const box=await plus.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.waitForFunction(label=>{const node=[...document.querySelectorAll("button")].find(button=>button.getAttribute("aria-label")===label);return node && getComputedStyle(node).pointerEvents!=="none"},await plus.getAttribute("aria-label"));
    await plus.click();
    await page.getByRole("dialog").getByRole("button",{name:sport,exact:true}).click();
    await page.getByRole("button",{name:"Build Workout",exact:true}).click();
    const setup=page.getByRole("group",{name:"Workout builder setup",exact:true});
    await setup.getByLabel("Builder intensity units",{exact:true}).selectOption(sport==="Bike"?"%ftp":"%pace");
    await setup.getByLabel("Builder target shape",{exact:true}).selectOption("range");
    await setup.getByLabel("Build workout by",{exact:true}).selectOption(sport==="Swim"?"distance":"time");
    if(sport==="Swim")await setup.getByLabel("Builder distance units",{exact:true}).selectOption("yd");
    await setup.getByRole("button",{name:"Continue",exact:true}).click();
    await page.getByRole("button",{name:sport==="Bike"?"Add Two Step Repeats":"Add Active",exact:true}).click();
    await page.locator(".dtb-details-heading").click();
    await page.setViewportSize({width:1280,height:720});
    await page.waitForFunction(()=>innerHeight===720&&Math.abs(document.querySelector(".we-tp-desktop").getBoundingClientRect().height-innerHeight*.92)<.1);
    await page.evaluate(async()=>{await document.fonts.ready});
    await page.mouse.move(5,5);
    await page.screenshot({path:path.join(output,`${sport.toLowerCase()}-matched.png`)});
    const state=await page.evaluate(()=>{
      const read=selector=>{const element=document.querySelector(selector);if(!element)return null;const r=element.getBoundingClientRect(),s=getComputedStyle(element);return {x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:element.clientWidth,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,overflow:s.overflow,font:s.font,padding:s.padding,gap:s.gap,text:element instanceof HTMLInputElement?element.value:element.textContent.trim()}};
      return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},dialog:read(".we-tp-desktop"),lower:read(".dtb-lower"),summary:read(".dtb-summary"),rightPane:read(".dtb-details"),card:read(".dtb-step-card"),title:read(".dtb-step-heading > input"),target:read(".dtb-target-values input"),zone:read("[aria-label='Training zone']"),chart:read(".dtb-chart-scroll"),profile:read(".we-chart svg"),overview:read(".dtb-overview"),description:read(".dtb-text textarea"),saveClose:read(".dtb-footer > .dtb-primary"),planned:{duration:read("#builder-duration_seconds"),distance:read("#builder-distance_meters"),tss:read("#builder-tss"),if:read("#builder-intensity_factor"),work:read("#builder-work_kj")}};
    });
    assert.equal(state.planned.duration.text,sport==="Bike"?"0:36:00":sport==="Swim"?"0:02:48":"0:10:00");
    assert.equal(Number(state.planned.tss.text),sport==="Bike"?41:sport==="Swim"?6:21);
    assert.equal(Number(state.planned.if.text),sport==="Bike"?.82:sport==="Swim"?1.15:1.10);
    if(sport==="Bike")assert.equal(state.planned.work.text,"333");
    if(sport==="Run")assert.equal(state.planned.distance.text,"1.25");
    states.push({sport,thresholds:{ftp:197,runThresholdSecondsPerMile:530,swimThresholdSecondsPer100Yards:Number(process.env.REFERENCE_SWIM_PACE||93)},...state});
    await context.close();
  }
  await fs.writeFile(path.join(output,"matched-state.json"),JSON.stringify(states,null,2));
} finally {await browser.close()}
console.log(JSON.stringify({output,sports:states.map(s=>s.sport)}));
