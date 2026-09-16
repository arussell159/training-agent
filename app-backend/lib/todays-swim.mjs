import fs from "node:fs/promises";
import { createSupabaseSettingsStore } from "./settings-store.mjs";
import { createIntervalsClient } from "./intervals.mjs";
import { athleteLocalDate } from "./coach-training-context.mjs";
import { DEVICE_DEFINITION_MARKER } from "./race-plan-import.mjs";
import {
  readFitWorkoutSteps,
  expandFitWorkoutSteps,
  readFitWorkoutMetadata,
} from "./fit-workout-verification.mjs";

export const swimDescription = `Warm Up:
1 x (300 FS in Z1–2),
2 x (50 Drill in Z2 + 50 FS in Z2).

Main Set:
4 x (50 FS Build in Z2–4 + 15 sec rests),
3 x (400 FS in Z3 + 30 sec rests),
8 x (100 FS in Z4 + 15 sec rests).

Warm Down:
1 x (200 FS in Z1–2).

Rest is seconds on the wall, not a send-off. Unlisted pauses remain continuous. Total: 2,900 yd. Source planned duration: 54:25; source planned TSS: 63.`;

export const swimDefinition = `Pool length: 25y

Warm Up
- 300mtr 1:50 Pace freestyle intensity=warmup

2x
- 50mtr 1:43 Pace drill
- 50mtr 1:43 Pace swim

Main Set 4x
- 50mtr 1:39 Pace freestyle build
- Rest 15s intensity=rest

Main Set 3x
- 400mtr 1:39 Pace freestyle
- Rest 30s intensity=rest

Main Set 8x
- 100mtr 1:36 Pace freestyle
- Rest 15s intensity=rest

Warm Down
- 200mtr 1:50 Pace freestyle intensity=cooldown`;

export async function buildTodaysSwim() {
  const bootstrap = JSON.parse(await fs.readFile("app-backend/config.json", "utf8"));
  const store = createSupabaseSettingsStore(bootstrap),
    config = { ...bootstrap, ...(await store.read()) },
    request = createIntervalsClient(config);
  const athlete = await request("/athlete/0"),
    today = athleteLocalDate(new Date(), athlete.timezone || "America/Chicago");
  const external_id = `alex-waco-plan:${today}:Swim:2900-aerobic-css`;
  const events = await request(`/athlete/0/events?oldest=${today}&newest=${today}`),
    existing = events.find((e) => e.external_id === external_id);
  const payload = {
    category: "WORKOUT",
    type: "Swim",
    name: "Aerobic Swim with Strong Repeats",
    start_date_local: today + "T00:00:00",
    external_id,
    description: swimDescription + DEVICE_DEFINITION_MARKER + swimDefinition,
  };
  const created = await request(
    existing ? `/athlete/0/events/${existing.id}` : "/athlete/0/events",
    { method: existing ? "PUT" : "POST", body: JSON.stringify(payload) }
  );
  const verified = await request(`/athlete/0/events/${created.id}`);
  const expand = (steps) =>
    steps.flatMap((s) =>
      s.steps ? Array.from({ length: s.reps }, () => expand(s.steps)).flat() : [s]
    );
  const steps = expand(verified.workout_doc?.steps || []);
  const distance = steps.reduce((sum, s) => sum + (s.distance || 0), 0),
    rests = steps.filter((s) => s.intensity === "rest");
  // The `mtr` token is the Intervals parser workaround. The numeric amounts
  // remain the intended yard amounts because the workout declares a 25y pool.
  if (
    Math.abs(distance - 2900) > 0.01 ||
    rests.length !== 15 ||
    rests.reduce((sum, s) => sum + s.duration, 0) !== 270
  )
    throw new Error("Swim structure verification failed");
  if (steps.filter((s) => s.distance).some((s) => !s.pace))
    throw new Error("Swim pace targets missing");
  await request(`/athlete/0/events/${created.id}`, {
    method: "PUT",
    body: JSON.stringify({ moving_time: 3265, icu_training_load: 63 }),
  });
  const response = await fetch(
    `https://intervals.icu/api/v1/athlete/0/events/${created.id}/download.fit`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from("API_KEY:" + config.INTERVALS_API_KEY).toString("base64")}`,
      },
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!response.ok) throw new Error(`Swim FIT export failed (${response.status})`);
  const fit = Buffer.from(await response.arrayBuffer());
  const pool = readFitWorkoutMetadata(fit)[0];
  if (pool?.poolLengthUnit !== "yards" || Math.abs(pool.poolLengthMeters - 25 * 0.9144) > 0.01)
    throw new Error("Swim FIT pool must be 25 yards");
  const rawFitSteps = readFitWorkoutSteps(fit);
  if (rawFitSteps.filter((s) => s.durationType === 6).length !== 4)
    throw new Error("Swim FIT repeat controls are missing");
  const fitSteps = expandFitWorkoutSteps(rawFitSteps);
  const fitDistance = fitSteps
    .filter((s) => s.durationType === 1)
    .reduce((sum, s) => sum + s.durationValue / 100, 0);
  const fitRest = fitSteps.filter((s) => s.intensity === 1);
  if (
    Math.abs(fitDistance - distance) > 0.01 ||
    fitRest.length !== 15 ||
    fitRest.some((s) => s.durationType !== 0) ||
    fitSteps.filter((s) => s.durationType === 1).some((s) => s.targetType === 2)
  )
    throw new Error("Swim FIT units/targets verification failed");
  const report = JSON.parse((await store.read()).RACE_PLAN_IMPORT_REPORT || "{}");
  await store.save({
    RACE_PLAN_IMPORT_REPORT: JSON.stringify({
      ...report,
      additional_workouts: [
        ...(report.additional_workouts || []).filter((w) => w.id !== created.id),
        {
          id: created.id,
          date: today,
          name: payload.name,
          yards: 2900,
          fit_steps: fitSteps.length,
        },
      ],
    }),
  });
  return {
    id: created.id,
    date: today,
    name: payload.name,
    yards: 2900,
    restSeconds: 270,
    fitSteps: fitSteps.length,
  };
}
