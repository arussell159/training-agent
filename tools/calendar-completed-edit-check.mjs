// Production UI + real durable commits + memory provider only. No live data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  )
);
const port = Number(process.env.PERF_PORT || 19482),
  origin = `http://127.0.0.1:${port}`;
const engine = process.env.APP_TEST_BROWSER || "msedge";
const output = path.resolve(process.env.APP_TEST_OUTPUT || "artifacts/calendar-completed-edit");
await fs.mkdir(output, { recursive: true });
const server = spawn(
  process.execPath,
  ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
);
process.on("exit", () => server.kill());
await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(Error("Preview startup timed out")), 10000);
  server.on("error", reject);
  server.stdout.on("data", (value) => {
    if (String(value).includes(origin)) {
      clearTimeout(deadline);
      resolve();
    }
  });
  server.stderr.on("data", (value) => {
    clearTimeout(deadline);
    reject(Error(String(value)));
  });
});
const browser = await (engine === "webkit"
  ? webkit.launch({ headless: true, executablePath: process.env.APP_TEST_EXECUTABLE })
  : chromium.launch({ headless: true, channel: engine }));
const context = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  colorScheme: "light",
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const evidence = {
  conditions: `1280×820, ${engine} headless, production build, disposable memory provider; no live Supabase or Intervals requests`,
  checks: [],
  externalRequests: [],
  errors: [],
};
page.on("pageerror", (error) => evidence.errors.push(error.message));
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin !== origin) {
    evidence.externalRequests.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
const read = async (endpoint) => {
  const response = await page.request.get(origin + endpoint);
  assert.equal(response.ok(), true, endpoint);
  return response.json();
};
async function until(readValue, predicate, label) {
  const deadline = Date.now() + 20000;
  let last;
  do {
    last = await readValue();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw Error(label + ": " + JSON.stringify(last));
}
const title = "Parity completion browser fixture";
try {
  await page.goto(origin + "/calendar?theme=light");
  await page
    .getByRole("button", { name: /^Add workout for / })
    .first()
    .press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await page.getByLabel("Workout title", { exact: true }).fill(title);
  await page.getByLabel("Planned duration", { exact: true }).fill("0:20:00");
  assert.equal(await page.getByLabel("Completed duration", { exact: true }).isEnabled(), true);
  await page.getByLabel("Completed duration", { exact: true }).fill("0:18:00");
  await page.getByLabel("Completed distance", { exact: true }).fill("1");
  await page
    .getByRole("textbox", { name: "Workout description", exact: true })
    .fill("Original complete description");
  await page
    .getByLabel("New planned workout comment", { exact: true })
    .fill("First completion comment");
  await page.screenshot({
    path: path.join(output, "create-planned-and-completed.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Save & Close", exact: true }).click();
  await page.locator('[data-slot="dialog-content"]').waitFor({ state: "hidden" });
  const initial = await until(
    () => read("/api/preview/provider-records"),
    (data) => data.activities.some((activity) => activity.name === title),
    "Native manual completion not found"
  );
  const activity = initial.activities.find((activity) => activity.name === title),
    event = initial.events.find((event) => event.id === activity.paired_event_id);
  assert.equal(activity.moving_time, 1080);
  assert.equal(activity.icu_distance ?? activity.distance, 1609.344);
  assert.equal(event.name, title);
  assert.equal(event.time_target, 1200);
  assert.equal(event.paired_activity_id, activity.id);
  assert.equal(activity.description, "Original complete description");
  evidence.checks.push(
    "Creation commits a planned event plus paired manual activity with 20-minute planned and 18-minute completed duration."
  );
  await until(
    () => read("/api/preview/workout-commits"),
    (data) =>
      data.workouts.some((row) => row.workout?.title === title && row.syncStatus === "synced"),
    "Initial commit not verified"
  );
  const confirmedInitial = await read("/api/preview/provider-records");
  const plannedBefore = await read(
    `/api/workouts/${encodeURIComponent(`event:${event.id}`)}/editor`
  );
  assert.equal(
    confirmedInitial.writes.filter(
      (row) =>
        row.path === `/activity/${activity.id}/messages` &&
        row.method === "POST" &&
        row.body?.content === "First completion comment"
    ).length,
    1
  );
  await page.reload();
  await page.getByText(title, { exact: true }).first().click();
  await page.locator('output[aria-label="Completed duration"]').waitFor({ state: "visible" });
  assert.match(await page.getByLabel("Completed duration", { exact: true }).innerText(), /18:00/);
  await page.locator('input[aria-label="Completed distance"]').waitFor({ state: "visible" });
  assert.equal(await page.getByLabel("Completed distance", { exact: true }).inputValue(), "1");
  await page.getByLabel("Completed distance", { exact: true }).fill("1.25");
  await page
    .getByRole("textbox", { name: "Workout description", exact: true })
    .fill("Edited complete description");
  await page
    .getByLabel("New post-activity comment", { exact: true })
    .fill("Native activity comment after reopening");
  await page.getByRole("button", { name: "Save & Close", exact: true }).click();
  await page.locator('[data-slot="dialog-content"]').waitFor({ state: "hidden" });
  const updated = await until(
    () => read("/api/preview/provider-records"),
    (data) => {
      const actual = data.activities.find((row) => row.id === activity.id);
      return (actual?.icu_distance ?? actual?.distance) === 2011.68;
    },
    "Native completed edit not found"
  );
  const edited = updated.activities.find((row) => row.id === activity.id);
  assert.equal(
    edited.moving_time,
    1080,
    "Native duration stays unchanged after editing supported actual fields"
  );
  assert.equal(edited.description, "Edited complete description");
  assert.equal(
    updated.events.find((row) => row.id === event.id).description,
    confirmedInitial.events.find((row) => row.id === event.id).description
  );
  assert.deepEqual(
    updated.events.find((row) => row.id === event.id).workout_doc,
    event.workout_doc
  );
  const nativePosts = updated.writes.filter(
    (row) => row.path === `/activity/${activity.id}/messages` && row.method === "POST"
  );
  assert.equal(
    nativePosts.filter((row) => row.body?.content === "Native activity comment after reopening")
      .length,
    1
  );
  evidence.checks.push(
    "Reopened completed distance and description edit update the same native activity; native duration stays read-only and comment posts once to activity messages."
  );
  await until(
    () => read("/api/preview/workout-commits"),
    (data) =>
      data.workouts.some(
        (row) => row.workoutId === `activity:${activity.id}` && row.syncStatus === "synced"
      ),
    "Completed edit not verified"
  );
  await page.reload();
  await page.getByText(title, { exact: true }).first().waitFor();
  assert.equal(
    await page
      .locator(".calendar-workout-card[data-workout-id]")
      .filter({ hasText: title })
      .count(),
    1,
    "A completed edit must retain one paired calendar card"
  );
  await page.getByText(title, { exact: true }).first().click();
  await page.locator('output[aria-label="Completed duration"]').waitFor({ state: "visible" });
  assert.match(await page.getByLabel("Completed duration", { exact: true }).innerText(), /18:00/);
  await page.locator('input[aria-label="Completed distance"]').waitFor({ state: "visible" });
  assert.equal(await page.getByLabel("Completed distance", { exact: true }).inputValue(), "1.25");
  assert.equal(
    await page.getByRole("textbox", { name: "Workout description", exact: true }).inputValue(),
    "Edited complete description"
  );
  await page.getByText("Native activity comment after reopening", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "reopened-native-completed-edit.png"),
    animations: "disabled",
  });
  evidence.checks.push(
    "Reload and reopen show confirmed native completed values, description and comment."
  );
  // The planned prescription and native activity now have different prose.
  // Editing this reopened activity must compare against its own baseline.
  await page
    .getByRole("textbox", { name: "Workout description", exact: true })
    .fill("Second native-only description edit");
  await page
    .getByLabel("New post-activity comment", { exact: true })
    .fill("Second native comment with separate planned baseline");
  await page.getByRole("button", { name: "Save & Close", exact: true }).click();
  await page.locator('[data-slot="dialog-content"]').waitFor({ state: "hidden" });
  const final = await until(
    () => read("/api/preview/provider-records"),
    (data) =>
      data.activities.find((row) => row.id === activity.id)?.description ===
      "Second native-only description edit",
    "Separate native description baseline could not be updated"
  );
  const plannedAfter = await read(
    `/api/workouts/${encodeURIComponent(`event:${event.id}`)}/editor`
  );
  assert.deepEqual(
    plannedAfter.model,
    plannedBefore.model,
    "Actual-only editing must preserve the complete planned editor model"
  );
  assert.deepEqual(
    plannedAfter.plannedValues,
    plannedBefore.plannedValues,
    "Actual-only editing must preserve planned values"
  );
  assert.deepEqual(
    final.events.find((row) => row.id === event.id),
    confirmedInitial.events.find((row) => row.id === event.id),
    "Actual-only edits must leave the native planned event unchanged"
  );
  assert.equal(final.activities.find((row) => row.id === activity.id).paired_event_id, event.id);
  await until(
    () => read("/api/preview/workout-commits"),
    (data) =>
      data.workouts.some(
        (row) => row.workoutId === `activity:${activity.id}` && row.syncStatus === "synced"
      ),
    "Second completed edit not verified"
  );
  await page.reload();
  await page.getByText(title, { exact: true }).first().waitFor();
  assert.equal(
    await page
      .locator(".calendar-workout-card[data-workout-id]")
      .filter({ hasText: title })
      .count(),
    1
  );
  await page.getByText(title, { exact: true }).first().click();
  await page.locator('output[aria-label="Completed duration"]').waitFor({ state: "visible" });
  assert.equal(
    await page.getByRole("textbox", { name: "Workout description", exact: true }).inputValue(),
    "Second native-only description edit"
  );
  for (const body of [
    "First completion comment",
    "Native activity comment after reopening",
    "Second native comment with separate planned baseline",
  ]) {
    await page.getByText(body, { exact: true }).waitFor();
    assert.equal(await page.getByText(body, { exact: true }).count(), 1);
  }
  await page.screenshot({
    path: path.join(output, "separate-planned-and-actual-baselines.png"),
    animations: "disabled",
  });
  evidence.checks.push(
    "A second actual-only edit starts from native prose, preserves the full planned prescription and values, keeps one paired card, and retains all three native comments once."
  );
  evidence.providerIds = { event: event.id, activity: activity.id };
  evidence.providerWrites = final.writes.filter(
    (row) =>
      row.path.includes(String(event.id)) ||
      row.path.includes(activity.id) ||
      row.path.endsWith("activities/manual/bulk")
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-slot="dialog-content"]').waitFor({ state: "hidden" });
  await page.getByText("Aerobic run — recorded route and laps", { exact: true }).click();
  await page.locator('output[aria-label="Completed duration"]').waitFor({ state: "visible" });
  assert.equal(
    await page.getByRole("textbox", { name: "Workout description", exact: true }).isEnabled(),
    true
  );
  assert.equal(
    await page.getByLabel("New post-activity comment", { exact: true }).isEnabled(),
    true
  );
  evidence.checks.push(
    "Recorded-activity duration is read-only when the provider cannot persist it; descriptions and comments remain editable."
  );
  await page.screenshot({
    path: path.join(output, "recorded-provider-capabilities.png"),
    animations: "disabled",
  });
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(evidence.externalRequests, []);
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(evidence, null, 2));
  await Promise.all(
    ["failure.json", "failure.png"].map((name) => fs.rm(path.join(output, name), { force: true }))
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" });
  await fs.writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      {
        ...evidence,
        error: error.message,
        body: await page.locator("body").innerText(),
        provider: await read("/api/preview/provider-records"),
        commits: await read("/api/preview/workout-commits"),
      },
      null,
      2
    )
  );
  throw error;
} finally {
  await browser.close();
  server.kill();
}
