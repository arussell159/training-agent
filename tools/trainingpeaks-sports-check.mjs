// Synthetic local browser verification only; never use against a live account.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import {browserNetworkEvidence} from "./browser-network-evidence.mjs";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
}
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5210";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Use the disposable local preview only."
);
const output = path.resolve(
  "artifacts/trainingpeaks-sports",
  process.env.APP_TEST_SPORT?.replace(/[^a-zA-Z0-9_-]/g, "-") || "."
);
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  colorScheme: "light",
});
const page = await context.newPage();
const network=browserNetworkEvidence();network.attach(context);
page.setDefaultTimeout(12000);
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
);
const sports = [
  ["Run", "Run"],
  ["Bike", "Ride"],
  ["Swim", "Swim"],
  ["Brick", "Other", "brick"],
  ["Crosstrain", "Workout"],
  ["Day off", "Other", "day-off"],
  ["Mtn Bike", "MountainBikeRide"],
  ["Strength", "WeightTraining"],
  ["Custom", "Other", "custom"],
  ["XC-Ski", "NordicSki"],
  ["Rowing", "Rowing"],
  ["Walk", "Walk"],
  ["Other", "Other"],
  ["Sauna", "Other"],
];
try {
  const selected = process.env.APP_TEST_SPORT
    ? sports.filter(([label, type]) => [label, type].includes(process.env.APP_TEST_SPORT))
    : sports;
  assert.ok(selected.length, "APP_TEST_SPORT must name an actual supported sport.");
  for (const [label, type, variant] of selected) {
    await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(() => window.__localPreview?.synthetic),
      true,
      "Synthetic preview marker is mandatory before mutation."
    );
    const day = new Date();
    day.setDate(day.getDate() + 4);
    const dayLabel = `Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
    await page.getByRole("button", { name: dayLabel, exact: true }).press("Enter");
    const chooser = page.locator(".calendar-add-dialog");
    const choices = await chooser.locator(".calendar-add-options button").allTextContents();
    assert.deepEqual(
      choices.map((name) => name.trim()),
      [...sports.map(([name]) => name), "Event", "Goals", "Note", "Metrics", "Availability"]
    );
    await chooser.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Workout title"
    );
    const title = `Synthetic sport ${label} ${Date.now()}`;
    const description = `Explicit ${label} workout instructions.`;
    await page.getByLabel("Workout title", { exact: true }).fill(title);
    assert.equal(
      await page.getByLabel("Workout sport", { exact: true }).inputValue(),
      variant ? `variant:${variant}` : type,
      `${label}: selected canonical sport`
    );
    await page.getByLabel("Planned duration", { exact: true }).fill(variant === "day-off" ? "" : "0:20:00");
    const dualSpeed = type === "MountainBikeRide" || variant === "brick";
    const durationSeconds = variant === "day-off" ? null : type === "Rowing" ? 120 : dualSpeed ? 420 : 1200;
    const durationText =
      variant === "day-off" ? "" : type === "Rowing" ? "0:02:00" : dualSpeed ? "0:07:00" : "0:20:00";
    if (dualSpeed) {
      await page.getByLabel("Planned duration", { exact: true }).fill("");
      await page.getByLabel("Planned distance", { exact: true }).fill("1");
      const automatic = page.getByRole("checkbox", {
        name: "Automatically calculate planned values",
        exact: true,
      });
      await automatic.uncheck();
      await page.getByLabel("Planned average speed", { exact: true }).fill("15");
      assert.equal(
        await page.getByLabel("Planned average pace", { exact: true }).inputValue(),
        "4:00"
      );
      await page.getByLabel("Planned average pace", { exact: true }).fill("7:");
      assert.equal(
        await page.getByLabel("Planned average speed", { exact: true }).inputValue(),
        "15"
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.getByLabel("Planned average pace", { exact: true }).inputValue(),
        "7:"
      );
      const rejected = await (
        await page.request.get(`${origin}/api/preview/provider-records`)
      ).json();
      assert.equal(
        rejected.events.some((event) => event.name === title),
        false
      );
      assert.equal(
        await page.getByLabel("Planned duration", { exact: true }).inputValue(),
        "",
        "Reciprocal synchronization must not force automatic duration calculation"
      );
      await automatic.check();
      await page.getByLabel("Planned average pace", { exact: true }).fill("7:00");
      await page.getByRole("alert").waitFor({ state: "hidden" });
      assert.equal(
        await page.getByLabel("Planned average speed", { exact: true }).inputValue(),
        "8.6"
      );
      assert.equal(
        await page.getByLabel("Planned duration", { exact: true }).inputValue(),
        "0:07:00"
      );
      const duplicates = await page
        .locator(".desktop-workout-preview input[id]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.id).filter((id, index, ids) => ids.indexOf(id) !== index)
        );
      assert.deepEqual(duplicates, [], "Speed and pace must have independent DOM identities");
      assert.equal(await page.getByLabel("Recorded minimum pace", { exact: true }).count(), variant === "brick" ? 1 : 0);
      assert.equal(await page.getByLabel("Recorded minimum power", { exact: true }).count(), 1);
      assert.equal(
        await page.getByLabel("Recorded minimum heart rate", { exact: true }).count(),
        1
      );
    }
    if (variant === "brick") {
      assert.equal(await page.getByLabel("Planned normalized power", { exact: true }).count(),0);
      assert.equal(await page.locator('input[aria-label="Planned elevation loss"]').count(),0);
      assert.equal(await page.getByLabel("Planned elevation loss", { exact: true }).textContent(), "—");
      assert.equal(await page.getByLabel("Completed elevation loss", { exact: true }).count(),1);
      await page.getByLabel("Workout bike",{exact:true}).fill("Synthetic brick bike");
      await page.getByLabel("Workout shoes",{exact:true}).fill("Synthetic brick shoes");
    }
    if (variant === "day-off") {
      assert.equal(await page.getByLabel("Planned distance",{exact:true}).count(),0);
      assert.equal(await page.getByLabel("Planned calories",{exact:true}).count(),0);
    }
    if (type === "Rowing") {
      await page.getByLabel("Planned duration", { exact: true }).fill("");
      await page.getByLabel("Planned distance", { exact: true }).fill("500");
      await page.getByLabel("Planned average pace", { exact: true }).fill("0:00");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.getByLabel("Planned distance", { exact: true }).inputValue(),
        "500",
        "Invalid pace must retain the distance draft"
      );
      const rejected = await (
        await page.request.get(`${origin}/api/preview/provider-records`)
      ).json();
      assert.equal(
        rejected.events.some((event) => event.name === title),
        false,
        "Invalid Rowing pace must not create a provider event"
      );
      await page.getByLabel("Planned average pace", { exact: true }).fill("2:00");
      await page.getByRole("alert").waitFor({ state: "hidden" });
      assert.equal(
        await page.getByLabel("Planned duration", { exact: true }).inputValue(),
        "0:02:00",
        "500m at a two-minute 500m split must derive 120 seconds"
      );
      assert.equal(await page.getByLabel("Planned work", { exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Planned elevation loss", { exact: true }).count(), 0);
    }
    if (type === "WeightTraining")
      assert.equal(await page.getByLabel("Planned distance", { exact: true }).count(), 0);
    if (["Other", "Workout"].includes(type) && variant !== "brick")
      assert.equal(await page.getByLabel("Planned average pace", { exact: true }).count(), 0);
    if (type === "Swim") {
      const assertPoolSummary = async () => {
        const pool = page.getByRole("combobox", { name: "Workout pool", exact: true });
        assert.equal(await pool.isDisabled(), true);
        assert.equal(await pool.inputValue(), "");
        assert.deepEqual(await pool.locator("option").evaluateAll(options => options.map(option => [option.value, option.textContent])), [
          ["", "Default"], ["DEFAULT-25Y", "25 Yards Pool"],
          ["DEFAULT-25M", "25 Meters Pool"], ["DEFAULT-50M", "50 Meters Pool"],
        ]);
      };
      await assertPoolSummary();
      assert.equal(await page.getByLabel("Workout equipment", { exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "Build Workout", exact: true }).click();
      await page.locator(".we-tp-desktop").waitFor();
      await assertPoolSummary();
      assert.equal(await page.getByLabel("Workout equipment", { exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
      await page.locator(".desktop-workout-preview").waitFor();
      assert.equal(await page.getByLabel("Planned duration", { exact: true }).inputValue(), durationText);
      const untouched = await (await page.request.get(`${origin}/api/preview/provider-records`)).json();
      assert.equal(untouched.events.some(entry => entry.name === title), false, "Inspecting disabled pool equipment must not write a workout");
    }
    await page.getByRole("textbox", { name: "Workout description", exact: true }).fill(description);
    await page.screenshot({
      path: path.join(output, `${type}-${label.replace(/[^a-zA-Z]/g, "")}-creator.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Save & Close", exact: true }).click();
    await page.locator(".desktop-workout-preview").waitFor({ state: "hidden" });
    const raw = await (await page.request.get(`${origin}/api/preview/provider-records`)).json();
    const event = raw.events.find((entry) => entry.name === title);
    assert.ok(event, `${label}: a real synthetic provider event was created`);
    assert.equal(event.type, type, `${label}: provider sport was preserved`);
    if (variant === "day-off") {
      assert.equal((event.workout_doc?.steps || []).length,0,"Title-only Day off must never fabricate a device interval");
      assert.ok(event.time_target == null,"Blank Day off duration must remain blank");
    } else assert.equal(event.workout_doc.steps[0].duration, durationSeconds, `${label}: saved duration`);
    if (type === "Swim") assert.equal(event.workout_doc.options.pool_length, "25y");
    if (type === "Rowing")
      assert.equal(
        event.distance_target,
        500,
        "Rowing provider distance must remain 500 metres, without converting to miles"
      );
    assert.ok(event.description.includes(description));
    assert.doesNotMatch(
      event.description,
      /Workout editor v1|training-agent-.*-v1|"version":|"duration_seconds":/
    );
    await page.goto(
      `${origin}/calendar?workout=${encodeURIComponent(`event:${event.id}`)}&theme=light`,
      { waitUntil: "domcontentloaded" }
    );
    await page.waitForFunction(
      (value) =>
        document.querySelector('textarea[aria-label="Workout description"]')?.value === value,
      description
    );
    assert.equal(
      await page.getByLabel("Planned duration", { exact: true }).inputValue(),
      durationText,
      `${label}: reloaded duration`
    );
    assert.equal(
      await page.getByRole("textbox", { name: "Workout description", exact: true }).inputValue(),
      description,
      `${label}: reloaded instructions`
    );
    assert.equal(
      await page.getByRole("heading", { name: title, exact: true }).textContent(),
      title,
      `${label}: reloaded title`
    );
    if (type === "Swim") {
      const pool = page.getByRole("combobox", { name: "Workout pool", exact: true });
      assert.equal(await pool.isDisabled(), true);
      assert.equal(await pool.inputValue(), "");
      const editor = await (await page.request.get(`${origin}/api/workouts/${encodeURIComponent(`event:${event.id}`)}/editor`)).json();
      assert.equal(editor.model.poolLength, "25y", "Disabled equipment Default must not overwrite native pool length");
    }
    if (variant) {
      const loaded=(await (await page.request.get(`${origin}/api/workouts/${encodeURIComponent(`event:${event.id}`)}/editor`)).json()).model;
      assert.equal(loaded.sport,"Other");assert.equal(loaded.variant,variant);
      if(variant==="day-off")assert.equal(loaded.unstructured,true);
      assert.equal(await page.locator(".desktop-workout-context").getByText(label,{exact:true}).count(),1);
      if(variant==="brick"){
        await page.waitForFunction(()=>document.querySelector('input[aria-label="Workout bike"]')?.value==="Synthetic brick bike");
        assert.equal(await page.getByLabel("Workout shoes",{exact:true}).inputValue(),"Synthetic brick shoes");
        const personal=(await (await page.request.get(`${origin}/api/workouts/${encodeURIComponent(`event:${event.id}`)}/personal`)).json()).value;
        assert.equal(personal.bikeEquipment,"Synthetic brick bike");assert.equal(personal.shoeEquipment,"Synthetic brick shoes");
      }
    }
    if (type === "Rowing") {
      assert.equal(await page.getByLabel("Planned distance", { exact: true }).inputValue(), "500");
      assert.equal(
        await page.getByLabel("Planned average pace", { exact: true }).inputValue(),
        "2:00"
      );
      assert.equal(
        (await page.locator(".desktop-workout-value-unit").first().textContent()).trim(),
        "m"
      );
    }
    if (dualSpeed) {
      assert.equal(
        await page.getByLabel("Planned average speed", { exact: true }).inputValue(),
        "8.6"
      );
      assert.equal(
        await page.getByLabel("Planned average pace", { exact: true }).inputValue(),
        "7:00"
      );
      const valueUrl = `${origin}/api/workouts/${encodeURIComponent(`event:${event.id}`)}/planned-values`;
      const initial = await (await page.request.get(valueUrl)).json();
      assert.ok(
        Math.abs(initial.workout.workout_summary.planned.average_speed - 1609.344 / 420) < 1e-10,
        "The seven-minute split must retain exact SI speed despite rounded8.6mph"
      );
      for (const [field, value, expectedOther, expectedDuration, expectedSpeed] of [
        ["Planned average speed", "15", "4:00", 240, 15 / 2.2369362921],
        ["Planned average pace", "3:00", "20.0", 180, 1609.344 / 180],
      ]) {
        await page.getByLabel(field, { exact: true }).fill(value);
        const other =
          field === "Planned average speed" ? "Planned average pace" : "Planned average speed";
        assert.equal(await page.getByLabel(other, { exact: true }).inputValue(), expectedOther);
        const response = page.waitForResponse(
          (result) => result.request().method() === "PUT" && result.url().includes("planned-values")
        );
        await page.getByRole("button", { name: "Save workout", exact: true }).click();
        assert.equal((await response).ok(), true);
        const updated = await (await page.request.get(valueUrl)).json();
        assert.ok(
          Math.abs(updated.workout.workout_summary.planned.average_speed - expectedSpeed) < 1e-10
        );
        assert.equal(updated.workout.workout_summary.planned.duration_seconds, expectedDuration);
        const rawSaved = (
          await (await page.request.get(`${origin}/api/preview/provider-records`)).json()
        ).events.find((entry) => entry.id === event.id);
        assert.equal(rawSaved.time_target, expectedDuration);
        assert.equal(rawSaved.distance_target, 1609.344);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          (value) =>
            document.querySelector('input[aria-label="Planned average pace"]')?.value === value,
          field === "Planned average speed" ? expectedOther : value
        );
      }
      await page.screenshot({
        path: path.join(output, "mountain-bike-both-views-edited.png"),
        animations: "disabled",
      });
    }
    checks.push({
      label,
      type,
      name: "chooser-create-provider-save-and-reload",
      providerId: event.id,
      durationSeconds,
      ...(variant ? {variant,nativeSport:"Other",privateVariantReadback:true} : {}),
      ...(type === "Swim" ? { disabledPoolEquipmentVerified: true, nativePoolLength: "25y", unchangedThroughBuilder: true } : {}),
      ...(type === "Rowing"
        ? { distanceMeters: 500, displayed500mSplit: "2:00", nativeMetresVerified: true }
        : {}),
      ...(dualSpeed
        ? {
            reciprocalViewsEditedAndReloaded: true,
            persistedSpeedKeys: 1,
            exactSevenMinuteSplitVerified: true,
          }
        : {}),
      cleanDescription: true,
    });
  }
  assert.deepEqual(errors, []);
} catch (error) {
  process.exitCode = 1;
  errors.push(error.stack || error.message);
  await page
    .screenshot({ path: path.join(output, "failure.png"), animations: "disabled" })
    .catch(() => {});
  console.error(error.message);
} finally {
  await fs.writeFile(path.join(output,"network.json"),JSON.stringify(network.entries,null,2));
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ synthetic: true, referenceParityClaim: false, checks, errors }, null, 2)
  );
  console.log(JSON.stringify({ checks: checks.length, errors: errors.length, output }));
  await browser.close();
}
