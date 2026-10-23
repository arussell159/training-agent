// End-to-end checks use only the isolated, in-memory production-adapter preview.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {setTimeout as delay} from "node:timers/promises";
import { createRequire } from "node:module";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  )
);
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5224";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve(process.env.ENDURANCE_EVIDENCE || "artifacts/endurance-editor/browser");
const draftOnly = process.argv.includes("--draft-only");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const network = browserNetworkEvidence(),
  results = [],
  owned = [];
const apiPath = (url) =>
  new URL(url).searchParams.get("__api_route") || new URL(url).pathname.replace(/^\/api\//, "");
const day = new Date();
day.setDate(day.getDate() + 3);
const date = day.toLocaleDateString("en-CA");
let active;
async function raw(page) {
  const response = await page.request.get(`${origin}/api/preview/provider-records`);
  assert.ok(response.ok());
  return response.json();
}
async function openEditor(page) {
  await page.getByRole("button", { name: "Workout actions", exact: true }).click();
  await page
    .locator(".desktop-workout-toolbar-popover")
    .getByRole("button", { name: /Edit workout/i })
    .click();
  await page.locator(".we-tp-desktop").waitFor();
  const expand = page.getByRole("button", { name: "Expand workout", exact: true });
  if (await expand.count()) await expand.click();
}
async function assertBlocked(page, field, text, sport, name) {
  const before = (await raw(page)).writes.length;
  await field.fill(text);
  await field.press("Control+s");
  await page.getByLabel("Workout title", { exact: true }).click();
  assert.equal(await field.inputValue(), text, `${sport}: invalid ${name} must remain visible`);
  assert.equal(
    await page
      .locator(".dtb-footer")
      .getByRole("button", { name: "Save", exact: true })
      .isDisabled(),
    true,
    `${sport}: invalid ${name} disables Save`
  );
  assert.equal(
    await page
      .locator(".dtb-footer")
      .getByRole("button", { name: "Save & Close", exact: true })
      .isDisabled(),
    true
  );
  assert.equal(
    (await raw(page)).writes.length,
    before,
    `${sport}: invalid ${name} keyboard Save must make no provider write`
  );
  results.push({ sport, name: `reject-${name}`, verified: true });
}
try {
  for (const [sport, providerSport] of [
    ["Swim", "Swim"],
    ["Bike", "Ride"],
    ["Run", "Run"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      colorScheme: "light",
    });
    network.attach(context);
    const page = await context.newPage();
    active = page;
    page.setDefaultTimeout(12000);
    const title = `Endurance QA ${sport} ${Date.now()}`;
    await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
    await page.mouse.wheel(0, 1);
    const plus = page.getByRole("button", {
      name: `Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      exact: true,
    });
    await plus.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest" }));
    const plusBox = await plus.boundingBox();
    assert.ok(plusBox);
    await page.mouse.move(plusBox.x + plusBox.width / 2, plusBox.y + plusBox.height / 2);
    await page.waitForFunction(
      (label) => {
        const node = [...document.querySelectorAll("button")].find(
          (button) => button.getAttribute("aria-label") === label
        );
        return node && getComputedStyle(node).pointerEvents !== "none";
      },
      await plus.getAttribute("aria-label")
    );
    await plus.click();
    await page.getByRole("dialog").getByRole("button", { name: sport, exact: true }).click();
    await page.getByLabel("Workout title", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Build Workout", exact: true }).click();
    const setup = page.getByRole("group", { name: "Workout builder setup", exact: true });
    await setup
      .getByLabel("Builder intensity units", { exact: true })
      .selectOption(sport === "Bike" ? "%ftp" : "%pace");
    await setup.getByLabel("Builder target shape", { exact: true }).selectOption("range");
    await setup
      .getByLabel("Build workout by", { exact: true })
      .selectOption(sport === "Swim" ? "distance" : "time");
    if (sport === "Swim")
      await setup.getByLabel("Builder distance units", { exact: true }).selectOption("yd");
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    // Exact reference geometry below describes the expanded builder. The
    // initial compact state is a separate supported window size.
    await page.getByRole("button", { name: "Expand workout", exact: true }).click();
    await page.evaluate(async()=>{await document.fonts.ready});
    const focusedTitle=page.getByLabel("Workout title",{exact:true});
    await focusedTitle.focus();
    await focusedTitle.press("Shift+F10");
    const headerMenu=page.getByRole("dialog",{name:"Workout settings and actions",exact:true});
    await headerMenu.waitFor({state:"visible"});
    assert.equal(await headerMenu.getByLabel("New block length",{exact:true}).inputValue(),sport==="Swim"?"distance":"time");
    await page.keyboard.press("Escape");
    await headerMenu.waitFor({state:"hidden"});
    await page.waitForFunction(()=>document.activeElement?.getAttribute("aria-label")==="Workout title");
    await page.locator(".dtb-header").click({button:"right",position:{x:8,y:8}});
    await headerMenu.waitFor({state:"visible"});
    await page.locator(".dtb-overview").click({position:{x:560,y:90}});
    await headerMenu.waitFor({state:"hidden"});
    assert.equal(await page.locator(".dtb-window-tools > button").count(),2,"Visible window tools are restore and close only");
    results.push({sport,name:"header-context-keyboard-pointer-dismiss-and-focus-return",verified:true});
    await page.getByRole("button", { name: "Add Warm up", exact: true }).click();
    let step = page.locator(".dtb-step-card").first();
    assert.deepEqual(await step.getByLabel("Interval type",{exact:true}).locator("option").allTextContents(),["Warmup","Work","Recover","Cooldown"]);
    if (sport === "Swim") {
      assert.equal(await step.getByLabel("Step distance",{exact:true}).inputValue(),"600","The observed yard warm-up is 600 yards, not converted metres");
      assert.equal(await step.getByLabel("Distance units",{exact:true}).inputValue(),"yd");
      await step.getByLabel("Distance units",{exact:true}).selectOption("m");
      assert.equal(await step.getByLabel("Step distance",{exact:true}).inputValue(),"548.64","An existing 600-yard interval converts physically to metres");
      await step.getByLabel("Step distance",{exact:true}).fill("600");
      results.push({sport,name:"observed-yard-preset-and-lossless-existing-distance-conversion",verified:true});
    }
    await page.setViewportSize({width:1280,height:720});
    await page.waitForFunction(() => innerHeight === 720 && Math.abs(document.querySelector(".we-tp-desktop").getBoundingClientRect().height - innerHeight * .92) < .1);
    const geometry = await page.evaluate(() => {
      const read = selector => {
        const node = document.querySelector(selector), css = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,fontSize:css.fontSize,fontWeight:css.fontWeight,lineHeight:css.lineHeight,borderRadius:css.borderRadius,color:css.color}
      }
      return Object.fromEntries([".we-tp-desktop",".dtb-overview",".dtb-lower",".dtb-step-card",".dtb-step-heading > input",".dtb-step-heading > select",".dtb-target-values > input",".dtb-target-values > select","#builder-duration_seconds",".dtb-text textarea",".dtb-step-tools",".dtb-lap",".dtb-step-tools > button",".dtb-step-notes"].map(selector=>[selector,read(selector)]))
    });
    await fs.writeFile(path.join(output,`${sport.toLowerCase()}-layout-metrics.json`),JSON.stringify(geometry,null,2));
    if (sport === "Run") {
      const lowProfile = await page.locator('.we-profile-segment > rect[fill="#2844f3"]').first().boundingBox();
      assert.ok(Math.abs(lowProfile.y-251)<1,"The observed 70–80% pace profile uses the reference's full 100% axis");
      assert.match(await page.locator(".dtb-chart-axis").innerText(),/25%/);
      assert.match(await page.locator(".dtb-chart-axis").innerText(),/100%/);
      results.push({sport,name:"reference-easy-profile-scale-and-quarter-axis-ticks",verified:true});
    }
    const near = (actual, expected, name) => assert.ok(Math.abs(actual-expected)<=1, `${sport} ${name}: ${actual}, reference ${expected}`);
    const frame = geometry[".we-tp-desktop"];
    near(frame.x,20,"frame left"); near(frame.y,10,"frame top"); near(frame.width,1240,"frame width"); near(frame.height,662.4,"frame height");
    assert.equal(frame.borderRadius,"8px");
    const overview = geometry[".dtb-overview"];
    near(overview.x,36,"overview left"); near(overview.y,96.5,"overview top"); near(overview.width,570,"overview width"); near(overview.height,106,"overview height");
    near(geometry[".dtb-lower"].y,sport === "Bike" ? 388.5 : 386.5,"lower panel top");
    const card = geometry[".dtb-step-card"];
    near(card.x,723.78,"step left"); near(card.y,sport === "Bike" ? 448.05 : 446.05,"step top"); near(card.width,495.22,"step width");
    assert.equal(geometry[".dtb-step-heading > input"].fontWeight,"700");
    near(geometry[".dtb-step-heading > select"].width,87,"role width");
    const targetField = geometry[".dtb-target-values > input"];
    near(targetField.width,45,"range field width"); near(targetField.height,26,"range field height");
    assert.equal(targetField.fontSize,"15px"); assert.equal(targetField.fontWeight,"200");
    near(geometry[".dtb-target-values > select"].width,sport === "Bike" ? 200 : sport === "Run" ? 247 : 260,"zone width");
    const planned = geometry["#builder-duration_seconds"];
    near(planned.y,sport === "Bike" ? 426.05 : 424.05,"planned field top");
    assert.ok(planned.width >= 55 && planned.width <= 95,"Compact summary keeps time fields readable");
    const description = geometry[".dtb-text textarea"];
    near(description.y,sport === "Bike" ? 426.5 : 424.5,"description top"); near(description.height,29.125,"description height");
    assert.ok(description.width >= 250 && description.width <= 300,"Summary notes remain usable in the narrower pane");
    assert.ok(card.height < 300,"The observed wrapped zone keeps the complete card within a usable scroll region");
    const action = geometry[".dtb-step-tools > button"], lap = geometry[".dtb-lap"], notes = geometry[".dtb-step-notes"];
    assert.ok(action.x > card.x && lap.x + lap.width < card.x + card.width,"Step actions stay inside their card");
    near(notes.x,card.x + 17,"step notes left"); near(notes.height,32,"step notes height");
    const inline = await step.locator(".dtb-step-prescription").evaluate(node => {
      const duration = node.querySelector("input").getBoundingClientRect();
      const targets = [...node.querySelectorAll(".dtb-target-values > input, .dtb-target-values > .we-field, .dtb-target-unit, .dtb-target-values > select")].map(item => { const r = item.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; });
      return {duration:{y:duration.y,bottom:duration.bottom},targets};
    });
    assert.ok(inline.targets.length >= 4);
    for (const target of inline.targets.slice(0, 3)) assert.ok(target.y < inline.duration.bottom && target.bottom > inline.duration.y,`${sport}: duration, range and units share the observed first row`);
    const zoneControl = inline.targets.at(-1);
    assert.ok(zoneControl.y >= inline.targets[0].bottom, `${sport}: training zone wraps below the target values as observed in the live reference`);
    for (let i = 1; i < inline.targets.length; i++) {
      if (inline.targets[i].y < inline.targets[i-1].bottom && inline.targets[i].bottom > inline.targets[i-1].y)
        assert.ok(inline.targets[i].x >= inline.targets[i-1].right,`${sport}: controls on the same row do not overlap`);
    }
    assert.equal(notes.fontSize,"14px");


    await page.screenshot({path:path.join(output,`${sport.toLowerCase()}-reference-layout.png`),animations:"disabled"});
    await fs.writeFile(path.join(output,`${sport.toLowerCase()}-layout-metrics.json`),JSON.stringify(geometry,null,2));
    results.push({sport,name:"reference-summary-split-wrapped-zone-and-preserved-reference-typography",verified:true});
    await step.getByLabel("Training zone",{exact:true}).selectOption("2");
    assert.equal(await page.getByLabel("Workout target units",{exact:true}).inputValue(),sport === "Bike" ? "%ftp" : "%pace");
    for (const label of ["Range from","Range to"]) assert.match(await step.getByLabel(label,{exact:true}).inputValue(),/^\d+$/);
    results.push({sport,name:"zone-selection-keeps-percentage-basis-with-whole-boundaries",verified:true});
    await page.setViewportSize({width:1280,height:820});

    if (sport === "Swim") {
      await page.getByLabel("Workout pool", { exact: true }).selectOption("25m");
      assert.equal(
        await step.getByLabel("Step distance", { exact: true }).inputValue(),
        "600",
        "Swim warm-up must use the observed 600 m preset"
      );
      assert.equal(await step.getByRole("switch").isChecked(), false);
      assert.equal(await step.getByRole("button", { name: /Add cadence range/ }).count(), 0);
      await step.getByLabel("Step distance", { exact: true }).fill("400");
      const distanceField = step.getByLabel("Step distance", { exact: true });
      await distanceField.blur();
      await assertBlocked(page, distanceField, "", sport, "empty-distance");
      await distanceField.press("Escape");
      assert.equal(await distanceField.inputValue(), "400", "Escape restores the pre-focus distance draft");
    } else {
      await assertBlocked(
        page,
        step.getByLabel("Step duration", { exact: true }),
        "1:99:00",
        sport,
        "duration"
      );
      await step.getByLabel("Step duration", { exact: true }).fill("1000");
      await page.getByLabel("Workout title", { exact: true }).click();
      assert.equal(
        await step.getByLabel("Step duration", { exact: true }).inputValue(),
        "0:10:00"
      );
      const durationField = step.getByLabel("Step duration", { exact: true });
      await durationField.fill("1230");
      await durationField.press("Escape");
      assert.equal(await durationField.inputValue(), "0:10:00", "Escape restores a valid live duration edit to its pre-focus value");
    }
    const targetNumber = step.getByLabel("Range from", {exact:true});
    const originalNumber = await targetNumber.inputValue();
    await page.evaluate(() => {
      const samples=[];
      const graph=document.querySelector('svg[data-workout-profile]');
      let started=null, frame=null;
      const observe=new MutationObserver(()=>{
        if(started==null||frame!=null)return;
        frame=requestAnimationFrame(()=>{samples.push(performance.now()-started);started=null;frame=null;});
      });
      observe.observe(graph,{attributes:true,childList:true,subtree:true});
      const input=event=>{
        if(event.target.getAttribute('aria-label')==='Range from')started=performance.now();
      };
      document.addEventListener('input',input,true);
      window.__enduranceTiming={samples,stop(){observe.disconnect();document.removeEventListener('input',input,true);if(frame!=null)cancelAnimationFrame(frame);}};
    });
    for(let sample=0;sample<40;sample++){
      await targetNumber.fill(String(61+sample/20));
      await page.waitForFunction(count=>window.__enduranceTiming.samples.length===count,sample+1);
    }
    const inputTiming=await page.evaluate(()=>{const result=[...window.__enduranceTiming.samples];window.__enduranceTiming.stop();delete window.__enduranceTiming;return result;});
    const sortedTiming=[...inputTiming].sort((a,b)=>a-b);
    await fs.writeFile(path.join(output,`${sport.toLowerCase()}-input-graph-timing.json`),JSON.stringify({sport,samples:inputTiming,sampleCount:inputTiming.length,p95:sortedTiming[Math.ceil(sortedTiming.length*.95)-1],method:"Capturing trusted browser input event to SVG mutation followed by next animation frame; production Vite build; isolated synthetic provider; Edge headless;1280x820;DPR1;40 sequential valid edits",boundary:"graph DOM ready at animation frame; not presentation timestamp"},null,2));
    await targetNumber.fill(originalNumber);
    await targetNumber.blur();
    await targetNumber.fill("61");
    await targetNumber.press("Escape");
    assert.equal(await targetNumber.inputValue(), originalNumber, "Escape restores the pre-focus target after valid live edits");
    const stepActions = step.locator(".dtb-step-menu");
    await stepActions.locator("summary").click();
    assert.equal(await stepActions.getAttribute("open"), "");
    await stepActions.locator("summary").press("Escape");
    assert.equal(await stepActions.getAttribute("open"), null);
    await stepActions.locator("summary").click();
    await page.getByLabel("Workout title",{exact:true}).click();
    assert.equal(await stepActions.getAttribute("open"), null);
    results.push({sport,name:"field-escape-restores-before-focus-and-step-menu-dismissal",verified:true});
    await assertBlocked(
      page,
      step.getByLabel("Range from", { exact: true }),
      "",
      sport,
      "empty-target"
    );
    await step.getByLabel("Range from", { exact: true }).fill(sport === "Bike" ? "45" : "70");
    if (sport === "Bike") {
      await step.getByLabel("Range from", { exact: true }).fill("0");
      assert.equal(
        await step.getByLabel("Range from", { exact: true }).getAttribute("aria-invalid"),
        null,
        "Power targets permit zero"
      );
      const beforeLarge = (await raw(page)).writes.length;
      await step.getByLabel("Range from",{exact:true}).fill("1000000000000");
      await page.getByLabel("Workout title",{exact:true}).click();
      assert.equal(await step.getByLabel("Range from",{exact:true}).inputValue(),"1000000000000");
      assert.ok(await page.locator(".dtb-chart-axis > span").count() <= 8,"Large numeric drafts cannot allocate an unbounded chart axis");
      assert.equal((await raw(page)).writes.length,beforeLarge);
      results.push({sport,name:"large-target-draft-keeps-chart-responsive-without-a-write",verified:true});
      await step.getByLabel("Range from", { exact: true }).fill("45");
    } else {
      await page
        .getByLabel("Workout target units", { exact: true })
        .selectOption(sport === "Swim" ? "secs/100m" : "secs/mi");
      await assertBlocked(
        page,
        step.getByLabel("start pace", { exact: true }),
        "08:99",
        sport,
        "pace"
      );
      await step
        .getByLabel("start pace", { exact: true })
        .fill(sport === "Swim" ? "01:40" : "08:00");
      await step.getByLabel("end pace", { exact: true }).fill(sport === "Swim" ? "01:50" : "09:00");
      await page.getByLabel("Workout title", { exact: true }).click();
      const paceField = step.getByLabel("start pace", {exact:true});
      const originalPace = await paceField.inputValue();
      await paceField.fill("02:00");
      await paceField.press("Escape");
      assert.equal(await paceField.inputValue(), originalPace, "Escape restores a valid live pace edit to its pre-focus value");
    }
    if (sport !== "Swim") {
      await step.getByRole("button", { name: /Add cadence range/ }).click();
      assert.equal(
        await step.getByLabel("Minimum cadence", { exact: true }).inputValue(),
        sport === "Run" ? "160" : "80"
      );
      const before = (await raw(page)).writes.length;
      await step.getByLabel("Minimum cadence", { exact: true }).fill("200");
      await step.getByLabel("Maximum cadence", { exact: true }).fill("100");
      await step.getByLabel("Maximum cadence", { exact: true }).press("Control+s");
      assert.equal(
        await page
          .locator(".dtb-footer")
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
        true
      );
      assert.equal((await raw(page)).writes.length, before);
      await step
        .getByLabel("Minimum cadence", { exact: true })
        .fill(sport === "Run" ? "165" : "85");
      await step
        .getByLabel("Maximum cadence", { exact: true })
        .fill(sport === "Run" ? "175" : "95");
      results.push({ sport, name: "cadence-defaults-and-invalid-range", verified: true });
    }
    const dateInput = page.getByLabel("Workout date", { exact: true });
    await dateInput.fill("");
    await dateInput.press("Control+s");
    assert.equal(
      await page
        .locator(".dtb-footer")
        .getByRole("button", { name: "Save", exact: true })
        .isDisabled(),
      true,
      "A cleared date cannot save the previous date"
    );
    await dateInput.fill(date);
    await step.getByLabel("Step notes", { exact: true }).fill(`${sport} step coaching cue\nKeep form controlled.`);
    await page.getByRole("button", { name: "Add Two Step Repeats", exact: true }).click();
    await assertBlocked(
      page,
      page.getByLabel("Repetitions", { exact: true }),
      "0",
      sport,
      "repeat-count"
    );
    await page.getByLabel("Repetitions", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Add Cool down", exact: true }).click();
    if (sport === "Swim") {
      const order = () => page.locator('.dtb-step-heading > input').evaluateAll(nodes=>nodes.map(node=>node.value));
      const before = await order();
      const totals = await page.getByLabel("Planned distance",{exact:true}).inputValue();
      const dragWarmup = async fraction => {
        const warmup = await page.locator('.we-profile-segment rect[role="button"][aria-label^="Warm up,"]').boundingBox();
        const plot = await page.locator('svg[data-workout-profile]').boundingBox();
        assert.ok(warmup && plot);
        await page.mouse.move(warmup.x+warmup.width/2,warmup.y+warmup.height/2);
        await page.mouse.down();
        await page.mouse.move(plot.x+plot.width*fraction,plot.y+plot.height*.6,{steps:18});
        await page.locator('.dtb-profile-drop-marker').waitFor({state:"attached"});
        assert.ok(await page.locator('.dtb-profile-drop-marker').evaluate(node=>node.getBBox().height > 0 && getComputedStyle(node).stroke !== 'none'));
        await page.mouse.up();
        await page.locator('.dtb-profile-drop-marker').waitFor({state:"detached"});
      };
      await dragWarmup(1.01);
      assert.deepEqual(await order(),[...before.slice(1),before[0]],"The fitted swim chart's right edge appends the whole block");
      await dragWarmup(.01);
      assert.deepEqual(await order(),before,"Swim drag back to the start restores the block order");
      assert.equal(await page.getByLabel("Planned distance",{exact:true}).inputValue(),totals);
      results.push({sport,name:"distance-profile-edge-reorder-roundtrip-preserves-prescription",verified:true});
    }

    await page
      .getByRole("textbox", { name: "Workout description", exact: true })
      .fill(`${sport}: plain coaching description.`);
    const typedComment=`${sport}: post-activity UI round-trip comment.`;
    await page.getByLabel("New planned workout comment",{exact:true}).fill(typedComment);
    await page
      .getByRole("textbox", { name: "Private Notes", exact: true })
      .fill(`${sport} private QA note`);
    assert.equal(
      await page
        .locator(".dtb-footer")
        .getByRole("button", { name: "Save", exact: true })
        .isEnabled(),
      true
    );
    await page.setViewportSize({width:1280,height:720});
    await page.waitForFunction(() => innerHeight === 720 && Math.abs(document.querySelector(".we-tp-desktop").getBoundingClientRect().height - innerHeight * .92) < .1);
    const profileGeometry = await page.evaluate(()=>{
      const plot=document.querySelector('svg[data-workout-profile]').getBoundingClientRect();
      const tops=[...document.querySelectorAll('.we-profile-segment > rect[fill="#2844f3"]')].map(node=>node.getBoundingClientRect().y);
      const selected=document.querySelector('.we-profile-segment > rect[fill="#999999"]').getBoundingClientRect();
      return {plot:plot.toJSON(),highestRange:Math.min(...tops),selected:selected.toJSON()};
    });
    assert.match(await page.locator(".dtb-chart-axis").innerText(),/100%/);
    assert.ok(Math.abs(profileGeometry.highestRange-(sport === "Bike" ? 254 : 251))<1,`${sport}: highest range bar must match the observed reference chart scale`);
    assert.ok(Math.abs(profileGeometry.selected.y-(sport === "Bike" ? 225 : 223))<1);
    assert.ok(Math.abs(profileGeometry.selected.height-138.4615)<1);
    await fs.writeFile(path.join(output,`${sport.toLowerCase()}-profile-metrics.json`),JSON.stringify(profileGeometry,null,2));
    results.push({sport,name:"reference-profile-scale-and-selected-background",verified:true});
    await page.screenshot({
      path: path.join(output, `${sport.toLowerCase()}-editor.png`),
      animations: "disabled",
    });
    if (draftOnly) {
      await context.close();
      active = null;
      continue;
    }
    const save = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && apiPath(response.url()) === "workout-commits"
    );
    await page
      .locator(".dtb-footer")
      .getByRole("button", { name: "Save & Close", exact: true })
      .click();
    const response = await save;
    assert.ok(response.ok(), await response.text());
    const submitted = response.request().postDataJSON().input.model;
    const commit = await response.json();
    assert.equal(commit.accepted,true);
    await page.locator(".we-tp-desktop").waitFor({ state: "hidden" });
    let native = (await raw(page)).events.filter((row) => row.name === title);
    for(let attempt=0; native.length===0 && attempt<100; attempt++) {
      await delay(100);
      native=(await raw(page)).events.filter(row=>row.name===title);
    }
    assert.equal(native.length, 1);
    const id = native[0].id;
    owned.push({ id, title });
    assert.equal(native[0].type, providerSport);
    assert.match(native[0].description, new RegExp(`${sport}: plain coaching description\\.`));
    assert.doesNotMatch(
      native[0].description,
      /Workout editor v1|training-agent-[\w-]+-v1|"version"|"duration_seconds"|private QA note/
    );
    const editor = await page.request.get(`${origin}/api/workout-commits/${encodeURIComponent(commit.workoutId)}/editor`);
    assert.ok(editor.ok());
    const hydrated = await editor.json();
    assert.deepEqual(hydrated.model.steps, submitted.steps);
    assert.deepEqual(hydrated.issues, []);
    const commentRead=await page.request.get(`${origin}/api/comments?workoutId=${encodeURIComponent(`event:${id}`)}`);
    assert.ok(commentRead.ok(),await commentRead.text());
    const nativeComments=await commentRead.json();
    assert.equal(nativeComments.comments.filter(row=>row.body===typedComment).length,1,"Independent provider comment adapter read returns the typed post-activity comment exactly once");
    results.push({
      sport,
      name: "exact-production-adapter-save-native-description-and-private-roundtrip",
      verified: true,
      id,
      independentlyReadComment:typedComment,
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(title, { exact: true }).click();
    await openEditor(page);
    assert.equal(
      await page
        .locator(".we-tp-desktop")
        .getByLabel("Workout title", { exact: true })
        .inputValue(),
      title
    );
    assert.equal(await page.getByLabel("Repetitions", { exact: true }).inputValue(), "3");
    assert.equal(
      await page
        .locator(".dtb-step-card")
        .first()
        .getByLabel("Step notes", { exact: true })
        .inputValue(),
      `${sport} step coaching cue\nKeep form controlled.`
    );
    assert.equal(
      await page
        .locator(".we-tp-desktop")
        .getByRole("textbox", { name: "Workout description", exact: true })
        .inputValue(),
      `${sport}: plain coaching description.`
    );
    for (const [width, height] of [
      [1280, 820],
      [1024, 768],
      [768, 820],
    ]) {
      await page.setViewportSize({ width, height });
      assert.ok(
        await page
          .locator(".we-tp-desktop")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        `${sport}: ${width}px horizontal overflow`
      );
      const cards = page.locator(".dtb-step-card");
      assert.equal(await cards.count(), 4);
      if (width === 1280) {
        for (const interval of await cards.all()) {
          const aligned = await interval.locator(".dtb-step-prescription").evaluate(node => {
            const duration = node.querySelector("input").getBoundingClientRect();
            const zone = node.querySelector('[aria-label="Training zone"]').getBoundingClientRect();
            return zone.y < duration.bottom && zone.bottom > duration.y;
          });
          assert.equal(aligned,false,`${sport}: repeat intervals preserve the reference's wrapped zone selector`);
        }
      }
      await page.screenshot({
        path: path.join(output, `${sport.toLowerCase()}-${width}.png`),
        animations: "disabled",
      });
    }
    results.push({ sport, name: "fresh-reload-exact-fields-three-desktop-widths", verified: true });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.locator(".dtb-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    const preview = page.locator(".desktop-workout-preview");
    await preview.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete workout", exact: true })
      .click();
    await preview.waitFor({ state: "hidden" });
    for(let attempt=0; (await raw(page)).events.some(row=>row.id===id)&&attempt<100; attempt++) await delay(100);
    assert.equal((await raw(page)).events.some((row) => row.id === id),false);
    results.push({ sport, name: "owned-synthetic-cleanup", verified: true });
    await context.close();
    active = null;
  }
  const unexpected = network.entries.filter(
    (row) => !(row.kind === "request-failed" && /ERR_ABORTED/.test(row.reason))
  );
  assert.deepEqual(unexpected, []);
  await fs.writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      { at: new Date().toISOString(), origin, results, network: network.entries, unexpected },
      null,
      2
    )
  );
  console.log(
    JSON.stringify(
      {
        groups: results.length,
        checks: results.map((row) => `${row.sport}: ${row.name}`),
        unexpected: unexpected.length,
      },
      null,
      2
    )
  );
} catch (error) {
  if (active) {
    await active.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    await fs.writeFile(
      path.join(output, "failure.txt"),
      await active
        .locator("body")
        .innerText()
        .catch(() => "")
    );
    await fs.writeFile(path.join(output,"failure-ui-state.json"),JSON.stringify(await active.evaluate(()=>({cards:[...document.querySelectorAll('[data-workout-id]')].map(node=>({id:node.getAttribute('data-workout-id'),disabled:node.getAttribute('aria-disabled'),busy:node.getAttribute('aria-busy'),text:node.textContent})),dialogs:[...document.querySelectorAll('[role="dialog"]')].map(node=>({text:node.textContent?.slice(0,200),hidden:node.getAttribute('aria-hidden')}))})).catch(()=>({})),null,2));
  }
  await fs.writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      { message: error.message, stack: error.stack, results, network: network.entries, owned },
      null,
      2
    )
  );
  throw error;
} finally {
  await browser.close();
}
