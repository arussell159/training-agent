import fs from "node:fs/promises";
import { createSupabaseSettingsStore } from "./settings-store.mjs";
import { createIntervalsClient } from "./intervals.mjs";

const easy = "10:30-11:00",
  race = "9:50-10:00";
const seconds = (p) => p.split(":").reduce((m, v) => m * 60 + Number(v), 0);
const clock = (n) => (n % 60 === 0 ? `${n / 60} ${n === 60 ? "min" : "mins"}` : `${n} secs`);
const power = (n, w, end, extra = {}) => ({
  duration: n,
  power: end ? { start: w, end, units: "w" } : { value: w, units: "w" },
  ...(end ? { ramp: true } : {}),
  ...extra,
});
const run = (n, p = easy) => ({
  duration: n,
  pace: p.includes("-")
    ? { start: seconds(p.split("-")[0]), end: seconds(p.split("-")[1]), units: "secs/mi" }
    : { value: seconds(p), units: "secs/mi" },
});
const swim = (y, z, text = "") => ({
  distance: y * 0.9144,
  duration: (y / 100) * [0, 110, 103, 99, 96, 92][z],
  pace: { value: z, units: "pace_zone" },
  text,
});
const rest = (n) => ({ duration: n, intensity: "rest", text: "Rest" });
const repeat = (reps, ...steps) => ({ reps, steps });
const bp = (n, w, e) => power(n * 60, w, e);
const rp = (n, p) => run(n * 60, p);
const sw = (reps, y, z, r, text = "") => repeat(reps, swim(y, z, text), rest(r));
const ramp = (n, a = 112, b = 132) => bp(n, a, b);
const cool = (n) => ramp(n, 112, 102);

function swimStroke(text = "") {
  if (!text) return "FS";
  if (text === "free with fins") return "FS with fins";
  if (text === "drill") return "Drill";
  if (text === "build") return "FS Build";
  if (text.startsWith("descend")) return `FS ${text[0].toUpperCase()}${text.slice(1)}`;
  if (text.startsWith("sight")) return `FS, ${text}`;
  return `FS ${text}`;
}
function segmentText(s, type, { recovery = false } = {}) {
  if (s.steps)
    return `${s.reps} x (${s.steps.map((x, index) => segmentText(x, type, { recovery: index > 0 })).join(" + ")})`;
  if (s.intensity === "rest") return `${s.duration} sec ${recovery ? "rests" : "rest"}`;
  if (type === "Swim")
    return `${Math.round(s.distance / 0.9144)} ${swimStroke(s.text)} in Z${s.pace.value}`;
  const amount = s.distance ? `${s.distance / 1609.344} mi` : clock(s.duration);
  const t = s.power || s.pace;
  const v =
    t.value ?? (s.power ? `${t.start}${s.ramp ? " → " : "–"}${t.end}` : `${t.start}–${t.end}`);
  const target = s.power
    ? `${v}`
    : t.value != null
      ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`
      : [t.start, t.end]
          .map((x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`)
          .join("–");
  const easyRange = easy.split("-").map(seconds);
  const isEasyRun =
    type === "Run" && t.value == null && t.start === easyRange[0] && t.end === easyRange[1];
  const purpose =
    type === "Run" && recovery && isEasyRun ? " recovery" : isEasyRun ? " easy jog" : "";
  return `${amount}${purpose} at ${target}${s.power ? " W" : " min/mile"}${s.cadence ? ` (${s.cadence.value} rpm)` : ""}`;
}
function sectionInstructions(steps, type) {
  if (!steps.length) return "None; continue into the adjacent section.";
  const lines = steps.map((step) =>
    step.steps
      ? segmentText(step, type)
      : type === "Swim"
        ? `1 x (${segmentText(step, type)})`
        : segmentText(step, type)
  );
  return lines.map((line, index) => `${line}${index === lines.length - 1 ? "." : ","}`).join("\n");
}
function totals(steps) {
  return steps.reduce(
    (a, s) => {
      const t = s.steps
        ? totals(s.steps)
        : { duration: s.duration || 0, distance: s.distance || 0 };
      return {
        duration: a.duration + t.duration * (s.reps || 1),
        distance: a.distance + t.distance * (s.reps || 1),
      };
    },
    { duration: 0, distance: 0 }
  );
}
function workout(date, type, name, warm, main, down, notes = "") {
  const groups = [warm, main, down];
  const description =
    groups
      .map(
        (group, index) =>
          `${["Warm Up:", "Main Set:", "Warm Down:"][index]}\n${sectionInstructions(group, type)}`
      )
      .join("\n\n") + (notes ? `\n\n${notes.trim()}` : "");
  const steps = [
    ...warm.map((s) => ({ ...s, warmup: true })),
    ...main,
    ...down.map((s) => ({ ...s, cooldown: true })),
  ];
  return {
    category: "WORKOUT",
    type,
    name,
    start_date_local: date + "T00:00:00",
    description,
    external_id: `alex-waco-plan:${date}:${type}`,
    workout_doc: {
      steps,
      ...totals(steps),
      options: type === "Swim" ? { pool_length: "25y" } : {},
    },
    ...(type === "Swim" ? { distance: totals(steps).distance } : {}),
  };
}
const bikeNotes =
  "Plan FTP: 203W. Cadence 85–95 rpm unless specified. Stay in the aerobars. Easy valleys and warm down provide recovery; adjacent efforts are continuous.";
const runNotes =
  "Use the plan pace ranges, not faster targets. Easy sections provide recovery. Shorten efforts if the shins flare; do not push through pain.";
const swimNotes =
  "25-yard pool. Z1 easy; Z2 race effort; Z3 steady; Z4 strong; Z5 CSS. Rest is seconds on the wall, not a send-off. Unlisted pauses are continuous (0 secs rest).";
const plans = [];
const B = (d, n, w, m, c, notes = "") =>
  plans.push(workout(d, "Ride", n, w, m, c, bikeNotes + " " + notes));
const R = (d, n, w, m, c, notes = "") =>
  plans.push(workout(d, "Run", n, w, m, c, runNotes + " " + notes));
const S = (d, n, w, m, c) => plans.push(workout(d, "Swim", n, w, m, c, swimNotes));
const brick = (d, a, b, c) =>
  R(
    d,
    `Brick Run ${b}min Race Pace`,
    [rp(a)],
    [rp(b, race)],
    [rp(c)],
    "Start immediately after the bike and time the transition."
  );

B(
  "2026-09-15",
  "Bike 3x5min Race Power",
  [ramp(10), repeat(3, power(30, 173), power(30, 106)), bp(2, 106)],
  [
    repeat(3, bp(3, 148), bp(2, 166)),
    bp(4, 106),
    repeat(4, bp(2, 146), power(90, 173)),
    bp(4, 106),
    bp(6, 152),
    bp(2, 183),
    bp(4, 142),
  ],
  [cool(11)]
);
brick("2026-09-15", 5, 5, 5);
R(
  "2026-09-16",
  "Run 3x6min Threshold",
  [rp(15)],
  [repeat(3, rp(6, "8:50-9:00"), rp(2)), rp(3), repeat(2, rp(4, "9:30-9:40"), rp(2))],
  [rp(6)]
);
S(
  "2026-09-17",
  "Swim 12x100 CSS",
  [swim(300, 1, "free with fins"), sw(4, 50, 1, 10, "drill"), sw(4, 50, 4, 15, "build")],
  [repeat(4, sw(3, 100, 5, 20), swim(50, 1), rest(30))],
  [swim(100, 1)]
);
R("2026-09-17", "Aerobic Run", [], [rp(30)], []);
B(
  "2026-09-19",
  "Bike Race Rehearsal",
  [ramp(15)],
  [
    repeat(4, bp(8, 154), bp(2, 146)),
    bp(5, 106),
    repeat(3, bp(6, 148), bp(1, 173), bp(3, 132)),
    bp(5, 106),
    { ...bp(10, 126), cadence: { value: 100, units: "rpm" } },
    bp(20, 148),
    bp(5, 138),
    bp(5, 106),
    repeat(2, bp(10, 152), bp(2, 138)),
  ],
  [cool(21)],
  "Rehearse race nutrition. Hard cap 154W on the climb. Outdoors on rolling roads preferred."
);
brick("2026-09-19", 5, 20, 5);
R("2026-09-20", "Run 3x15min Race Pace", [rp(30)], [repeat(3, rp(15, race), rp(5))], [rp(15)]);
S(
  "2026-09-21",
  "Swim 2x800 Race Rhythm",
  [
    swim(300, 1, "free with fins"),
    repeat(4, swim(25, 1, "drill"), swim(25, 1)),
    sw(4, 50, 4, 15, "descend 1–4"),
  ],
  [repeat(2, swim(500, 2), rest(30), swim(200, 4), rest(30), swim(100, 1), rest(20))],
  [swim(100, 1)]
);
B(
  "2026-09-22",
  "Bike 4x3min Race Power Surges",
  [ramp(10), repeat(4, power(20, 193), power(40, 106)), bp(2, 106)],
  [
    repeat(4, power(150, 148), power(30, 179)),
    bp(3, 106),
    repeat(3, bp(3, 152), bp(1, 132)),
    bp(3, 106),
    { ...bp(6, 146), cadence: { value: 95, units: "rpm" } },
  ],
  [cool(8)]
);
brick("2026-09-22", 3, 8, 4);
R(
  "2026-09-23",
  "Run 6-5-4-3min Progression",
  [rp(12)],
  [
    rp(6, "9:30-9:40"),
    rp(2),
    rp(5, "9:10-9:20"),
    rp(2),
    rp(4, "8:50-9:00"),
    rp(2),
    rp(3),
    repeat(2, rp(3, race), rp(1)),
  ],
  [rp(6)]
);
S(
  "2026-09-24",
  "Swim 6x150 Sighting",
  [swim(300, 1, "free with fins"), sw(4, 50, 1, 10, "drill")],
  [sw(6, 150, 4, 20, "sight every 6th stroke on middle 50"), sw(4, 100, 2, 15)],
  [swim(200, 1)]
);
R("2026-09-24", "Aerobic Run", [], [rp(25)], []);
B(
  "2026-09-26",
  "Bike Progressive Race Power",
  [ramp(15)],
  [
    bp(20, 146),
    bp(5, 106),
    bp(15, 152),
    bp(5, 106),
    bp(10, 158),
    bp(5, 106),
    repeat(3, bp(4, 162), bp(2, 142)),
    bp(5, 106),
    repeat(2, bp(8, 148), bp(2, 132)),
  ],
  [cool(17)]
);
brick("2026-09-26", 3, 12, 5);
R(
  "2026-09-27",
  "Run 2x20min Progressive Race Pace",
  [rp(25)],
  [rp(20, "10:10-10:20"), rp(20, race)],
  [rp(10)]
);
S(
  "2026-09-28",
  "Swim 6x100 Strong",
  [swim(300, 1, "free with fins"), repeat(4, swim(25, 1, "drill"), swim(25, 1))],
  [sw(6, 100, 4, 20), sw(4, 50, 5, 20), swim(300, 2)],
  [swim(200, 1)]
);
B(
  "2026-09-29",
  "Bike Race-Week Openers",
  [ramp(10)],
  [repeat(3, bp(3, 148), bp(2, 106)), bp(3, 106), repeat(4, bp(1, 183), bp(2, 106))],
  [cool(10)]
);
brick("2026-09-29", 4, 4, 2);
R(
  "2026-09-30",
  "Run 3x3min Race Pace",
  [rp(12)],
  [repeat(3, rp(3, race), rp(2))],
  [rp(8)],
  "Wear race shoes and socks."
);
S(
  "2026-10-01",
  "Swim 6x50 CSS Openers",
  [swim(300, 1, "free with fins"), sw(4, 50, 4, 15, "build")],
  [sw(6, 50, 5, 20), swim(200, 2)],
  [swim(200, 1)]
);
B(
  "2026-10-03",
  "Bike 3x1min Race-Week Openers",
  [{ duration: 600, power: { start: 112, end: 126, units: "w" } }],
  [repeat(3, bp(1, 152), bp(2, 106))],
  [cool(6)]
);
R(
  "2026-10-03",
  "Run 3x20s Race-Week Openers",
  [rp(4)],
  [repeat(3, run(20, race), run(60))],
  [rp(2)],
  "10 min total; the unallocated easy time in the source is distributed as 4 min warm up, 60 secs recovery per rep, and 2 min warm down."
);

export const racePlan = plans;
export const DEVICE_DEFINITION_MARKER = "\n\nIntervals.icu device definition:\n";
const expandNestedSteps = (steps, depth = 0) => {
  if (depth > 8) throw new Error("Workout repeat nesting is too deep");
  return steps.flatMap((step) =>
    step.steps
      ? Array.from({ length: step.reps || 1 }, () =>
          expandNestedSteps(step.steps, depth + 1)
        ).flat()
      : [step]
  );
};
// Intervals.icu supports one repeat level. Preserve every top-level set as a
// real repeat and expand only repeats nested inside that set.
export function deviceWorkoutSteps(p) {
  return p.workout_doc.steps.map((step) =>
    step.steps ? { ...step, steps: expandNestedSteps(step.steps) } : step
  );
}
export function nativeWorkoutDefinition(p) {
  const line = (s) => {
    if (s.intensity === "rest") return `- Rest ${s.duration}s intensity=rest`;
    const yardDistance = s.distance ? Math.round(s.distance / 0.9144) : null;
    const amount = yardDistance
      ? `${yardDistance}${p.type === "Swim" ? "mtr" : "y"}`
      : `${s.duration}s`;
    const t = s.power || s.pace;
    const paceClock = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
    // Intervals.icu currently needs the `mtr` token to parse pool steps for
    // Garmin, even when the pool and the numeric amounts are yards. Keep the
    // athlete's intended seconds-per-100-yard number unchanged: do not perform
    // a metres-to-yards pace conversion here.
    const target = s.power
      ? t.value != null
        ? `${t.value}w`
        : `${s.ramp ? "ramp " : ""}${t.start}-${t.end}w`
      : p.type === "Swim"
        ? `${paceClock(Math.round((s.duration * 100) / yardDistance))} Pace`
        : (t.value != null ? paceClock(t.value) : `${paceClock(t.start)}-${paceClock(t.end)}`) +
          "/mi Pace";
    return `- ${amount} ${target}${s.text ? ` ${s.text}` : ""}${s.cadence ? ` ${s.cadence.value}rpm` : ""}${s.warmup ? " intensity=warmup" : s.cooldown ? " intensity=cooldown" : ""}`;
  };
  const blocks = deviceWorkoutSteps(p).map((step) =>
    step.steps ? `${step.reps}x\n${step.steps.map(line).join("\n")}` : line(step)
  );
  return (p.type === "Swim" ? "Pool length: 25y\n\n" : "") + blocks.join("\n\n");
}
export async function importRacePlan(apply = false) {
  const bootstrap = JSON.parse(await fs.readFile("app-backend/config.json", "utf8"));
  const store = createSupabaseSettingsStore(bootstrap);
  const config = { ...bootstrap, ...(await store.read()) };
  const request = createIntervalsClient(config);
  const settings = await request("/athlete/0/sport-settings");
  const patches = [
    ["Ride", { ftp: 203 }],
    [
      "Run",
      { threshold_pace: 1609.344 / 535, pace_units: "MINS_MILE", workout_order: "PACE_HR_POWER" },
    ],
    [
      "Swim",
      {
        threshold_pace: 91.44 / 93,
        pace_units: "SECS_100Y",
        pace_zones: [(93 / 108) * 100, (93 / 102) * 100, (93 / 98) * 100, (93 / 95) * 100, 999],
        pace_zone_names: ["Easy", "Race effort", "Steady", "Strong", "CSS"],
        workout_order: "PACE_HR_POWER",
      },
    ],
  ];
  if (!apply)
    return {
      count: plans.length,
      patches,
      plans: plans.map((p) => ({
        date: p.start_date_local,
        name: p.name,
        type: p.type,
        totals: totals(p.workout_doc.steps),
        description: p.description,
      })),
    };
  const equal = (a, b) =>
    typeof b === "number"
      ? Number.isFinite(a) && Math.abs(a - b) < 0.0001
      : Array.isArray(b)
        ? Array.isArray(a) && a.length === b.length && b.every((x, i) => equal(a[i], x))
        : a === b;
  for (const [type, patch] of patches) {
    const s = settings.find((s) => s.types.includes(type));
    if (!s) throw new Error("Missing sport settings " + type);
    await request(`/athlete/0/sport-settings/${s.id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    const verified = await request(`/athlete/0/sport-settings/${s.id}`);
    for (const [key, value] of Object.entries(patch)) {
      if (!equal(verified[key], value))
        throw new Error("Settings verification failed " + type + " " + key);
    }
  }
  const existing = await request("/athlete/0/events?oldest=2026-09-15&newest=2026-10-04");
  const imported = [];
  for (const p of plans) {
    const match = existing.find((e) => e.external_id === p.external_id);
    if (
      !match &&
      existing.some((e) => e.start_date_local === p.start_date_local && e.type === p.type)
    )
      throw new Error("Possible scheduled duplicate " + p.start_date_local + " " + p.type);
    const { workout_doc, ...metadata } = p;
    metadata.description = p.description + DEVICE_DEFINITION_MARKER + nativeWorkoutDefinition(p);
    const event = await request(match ? `/athlete/0/events/${match.id}` : "/athlete/0/events", {
      method: match ? "PUT" : "POST",
      body: JSON.stringify(metadata),
    });
    const verified = await request(`/athlete/0/events/${event.id}`);
    const expand = (steps) =>
      steps.flatMap((s) =>
        s.steps ? Array.from({ length: s.reps }, () => expand(s.steps)).flat() : [s]
      );
    const repeatOutline = (steps) =>
      (steps || []).flatMap((step, index) =>
        step.steps ? [{ index, reps: step.reps || 1, steps: expand(step.steps).length }] : []
      );
    const expected = expand(workout_doc.steps),
      actual = expand(verified.workout_doc?.steps || []);
    if (verified.description !== metadata.description || actual.length !== expected.length)
      throw new Error("Workout verification failed " + p.name);
    if (
      JSON.stringify(repeatOutline(verified.workout_doc?.steps)) !==
      JSON.stringify(repeatOutline(deviceWorkoutSteps(p)))
    )
      throw new Error("Repeat verification failed " + p.name);
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i],
        a = actual[i];
      if (
        e.distance
          ? p.type === "Swim"
            ? Math.abs(a.distance - Math.round(e.distance / 0.9144)) > 0.001
            : Math.abs(a.distance - e.distance) > 0.001
          : a.duration !== e.duration
      )
        throw new Error("Interval units verification failed " + p.name + " " + i);
      if (e.intensity === "rest" && a.intensity !== "rest")
        throw new Error("Rest verification failed " + p.name + " " + i);
      if (p.type === "Swim" && e.pace) {
        const yards = Math.round(e.distance / 0.9144),
          pace = Math.round((e.duration * 100) / yards);
        if (a.pace?.units !== "secs" || a.pace?.value !== pace)
          throw new Error("Target verification failed " + p.name + " " + i);
      } else
        for (const key of ["pace", "power"])
          if (
            e[key] &&
            (a[key]?.units !== e[key].units ||
              (e[key].value != null
                ? !equal(a[key]?.value, e[key].value)
                : !equal(a[key]?.start, e[key].start) || !equal(a[key]?.end, e[key].end)))
          )
            throw new Error("Target verification failed " + p.name + " " + i);
    }
    imported.push({ id: event.id, date: p.start_date_local, type: p.type, name: p.name });
  }
  const raceEvent = {
    category: "RACE_A",
    type: "Other",
    name: "IRONMAN 70.3 Waco",
    start_date_local: "2026-10-04T00:00:00",
    external_id: "alex-waco-race:2026-10-04",
    moving_time: 21300,
    description:
      "Race overview from supplied plan; not a mixed-sport device workout.\n\nSwim: 1.2 mi at Z2, target 37–39 min. Controlled first 200 yd, sight every 6–8 strokes.\nT1: under 5 min.\nBike: 56 mi at 142–152w, cap 154w on climb and 160w on short rises; flat finish 142–148w. Last 10 min at 126–132w, 90+ rpm. Target 2:55–3:00.\nT2: under 4 min.\nRun: 13.1 mi. First 2 mi at 10:10–10:20 min/mile, miles 3–11 at 9:50–10:00 min/mile, final 2.1 mi by effort. Target 2:08–2:12.\n\nGoal: sub-6 hours; plan split calculation 5:55.",
  };
  const priorRace = existing.find((e) => e.external_id === raceEvent.external_id);
  const createdRace = await request(
    priorRace ? `/athlete/0/events/${priorRace.id}` : "/athlete/0/events",
    { method: priorRace ? "PUT" : "POST", body: JSON.stringify(raceEvent) }
  );
  const verifiedRace = await request(`/athlete/0/events/${createdRace.id}`);
  if (verifiedRace.category !== "RACE_A" || verifiedRace.description !== raceEvent.description)
    throw new Error("Race overview verification failed");
  imported.push({
    id: createdRace.id,
    date: raceEvent.start_date_local,
    type: raceEvent.type,
    name: raceEvent.name,
  });
  await store.save({
    RACE_PLAN_IMPORT_REPORT: JSON.stringify({
      source: "Alex_Russell_Triathlon_Sep-Oct (3).docx",
      imported,
      imported_at: new Date().toISOString(),
    }),
  });
  return { imported };
}
