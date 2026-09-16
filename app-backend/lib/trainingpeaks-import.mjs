import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createSupabaseSettingsStore } from "./settings-store.mjs";
import { createIntervalsClient } from "./intervals.mjs";

export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift().map((x) => x.replace(/^\uFEFF/, ""));
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

// Read session summaries only; original FIT files are uploaded unmodified.
export function fitSessions(buffer) {
  const b = gunzipSync(buffer),
    defs = new Map(),
    sessions = [];
  let p = b[0];
  const end = p + b.readUInt32LE(4);
  while (p < end) {
    const h = b[p++],
      compressed = !!(h & 128),
      local = compressed ? (h >> 5) & 3 : h & 15;
    if (!compressed && h & 64) {
      p++;
      const big = b[p++];
      const global = big ? b.readUInt16BE(p) : b.readUInt16LE(p);
      p += 2;
      const count = b[p++],
        fields = [];
      for (let i = 0; i < count; i++) {
        fields.push({ id: b[p], size: b[p + 1] });
        p += 3;
      }
      let extra = 0;
      if (h & 32) {
        const n = b[p++];
        for (let i = 0; i < n; i++) {
          extra += b[p + 1];
          p += 3;
        }
      }
      defs.set(local, { global, big, fields, extra });
    } else {
      const d = defs.get(local);
      if (!d) throw new Error("Unknown FIT definition");
      const values = {};
      for (const f of d.fields) {
        if (compressed && f.id === 253) continue;
        if ([1, 2, 4].includes(f.size))
          values[f.id] =
            f.size === 1
              ? b[p]
              : f.size === 2
                ? d.big
                  ? b.readUInt16BE(p)
                  : b.readUInt16LE(p)
                : d.big
                  ? b.readUInt32BE(p)
                  : b.readUInt32LE(p);
        p += f.size;
      }
      p += d.extra;
      if (d.global === 18 && values[2] && values[2] !== 4294967295) {
        const utc = new Date(Date.UTC(1989, 11, 31) + values[2] * 1000);
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Chicago",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
            .formatToParts(utc)
            .map((x) => [x.type, x.value])
        );
        sessions.push({
          date: `${parts.year}-${parts.month}-${parts.day}`,
          seconds: values[8] / 1000,
          type: { 1: "Run", 2: "Ride", 5: "Swim", 4: "WeightTraining" }[values[5]] || "Workout",
        });
      }
    }
  }
  return sessions;
}

const types = {
  Bike: "Ride",
  Run: "Run",
  Swim: "Swim",
  Strength: "WeightTraining",
  Other: "Workout",
  Walk: "Walk",
  Hike: "Hike",
};
export const normalizedType = (type) =>
  ({ VirtualRide: "Ride", OpenWaterSwim: "Swim", Other: "Workout" })[type] || type;
export function matchingActivities(existing, date, type, seconds, used = new Set()) {
  const sameDay = existing.filter(
    (a) =>
      !used.has(a.id) &&
      a.start_date_local?.slice(0, 10) === date &&
      normalizedType(a.type) === type
  );
  const recordings = sameDay.filter((a) => a.file_type === "fit");
  const pool = recordings.length ? recordings : sameDay;
  return pool.length === 1 ? pool : pool.filter((a) => Math.abs(a.moving_time - seconds) < 120);
}
export async function importHistory(
  directory,
  apply = false,
  { start = "2026-08-17", end = "2026-09-15" } = {}
) {
  const rows = parseCsv(
    await fs.readFile(path.join(directory, "Workout/workouts.csv"), "utf8")
  ).filter((r) => r.WorkoutDay >= start && r.WorkoutDay <= end && Number(r.TimeTotalInHours) > 0);
  const metrics = parseCsv(
    await fs.readFile(path.join(directory, "Metrics/metrics.csv"), "utf8")
  ).filter((r) => r.Timestamp.slice(0, 10) >= start && r.Timestamp.slice(0, 10) <= end);
  const bootstrap = JSON.parse(await fs.readFile(new URL("../config.json", import.meta.url)));
  const config = { ...bootstrap, ...(await createSupabaseSettingsStore(bootstrap).read()) },
    request = createIntervalsClient(config);
  let existing = await request(`/athlete/0/activities?oldest=${start}&newest=${end}`);
  const files = [];
  for (const name of await fs.readdir(path.join(directory, "WorkoutFile"))) {
    if (!/\.fit\.gz$/i.test(name)) continue;
    const buffer = await fs.readFile(path.join(directory, "WorkoutFile", name));
    const sessions = fitSessions(buffer);
    if (sessions.length && sessions.every((s) => s.date >= start && s.date <= end))
      files.push({ name, buffer, sessions });
  }
  const neededFiles = files.filter(
    (f) =>
      !f.sessions.every((s) =>
        existing.some(
          (a) =>
            a.file_type === "fit" &&
            a.start_date_local?.slice(0, 10) === s.date &&
            normalizedType(a.type) === s.type
        )
      )
  );
  const report = {
    window: { start, end },
    completedRows: rows.length,
    files: files.length,
    newFiles: neededFiles.length,
    uploaded: [],
    manual: [],
    matched: [],
    wellnessDays: 0,
    unmappedMetricTypes: [],
    existingSummaryDuplicates: existing
      .filter(
        (a) =>
          a.external_id?.startsWith("trainingpeaks-summary:") &&
          existing.some(
            (f) =>
              f.file_type === "fit" &&
              f.start_date_local?.slice(0, 10) === a.start_date_local?.slice(0, 10) &&
              normalizedType(f.type) === normalizedType(a.type)
          )
      )
      .map((a) => a.id),
  };
  if (!apply) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  for (const f of neededFiles) {
    const form = new FormData();
    form.append("file", new Blob([f.buffer]), f.name);
    const external = "trainingpeaks-file:" + createHash("sha256").update(f.buffer).digest("hex");
    const response = await fetch(
      `https://intervals.icu/api/v1/athlete/0/activities?external_id=${external}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from("API_KEY:" + config.INTERVALS_API_KEY).toString("base64")}`,
        },
        body: form,
        signal: AbortSignal.timeout(60000),
      }
    );
    if (!response.ok) throw new Error(`FIT upload failed (${response.status}): ${f.name}`);
    await response.json();
    report.uploaded.push(f.name);
    console.log("Uploaded", f.name);
  }
  existing = await request(`/athlete/0/activities?oldest=${start}&newest=${end}`);
  const used = new Set();
  for (const [index, r] of rows.entries()) {
    const seconds = Math.round(Number(r.TimeTotalInHours) * 3600),
      type = types[r.WorkoutType];
    if (!type) throw new Error("Unmapped workout type " + r.WorkoutType);
    const candidates = matchingActivities(existing, r.WorkoutDay, type, seconds, used);
    if (candidates.length > 1)
      throw new Error("Ambiguous activity match " + r.WorkoutDay + " " + r.Title);
    const patch = {
      name: r.Title,
      description: [r.WorkoutDescription, r.AthleteComments, "Imported from TrainingPeaks export."]
        .filter(Boolean)
        .join("\n\n"),
    };
    if (r.TSS !== "" && Number.isFinite(Number(r.TSS)))
      patch.icu_training_load = Math.round(Number(r.TSS));
    if (candidates.length) {
      used.add(candidates[0].id);
      await request(`/activity/${candidates[0].id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      report.matched.push(candidates[0].id);
    } else {
      const sameDayRecording = existing.some(
        (a) =>
          a.file_type === "fit" &&
          a.start_date_local?.slice(0, 10) === r.WorkoutDay &&
          normalizedType(a.type) === type
      );
      if (sameDayRecording)
        throw new Error("Recording exists but cannot safely match " + r.WorkoutDay + " " + r.Title);
      const activity = await request("/athlete/0/activities/manual", {
        method: "POST",
        body: JSON.stringify({
          ...patch,
          type,
          start_date_local: r.WorkoutDay + "T12:00:00",
          moving_time: seconds,
          distance: Number(r.DistanceInMeters) || 0,
          external_id: `trainingpeaks-summary:${r.WorkoutDay}:${index}`,
        }),
      });
      report.manual.push(activity.id);
      used.add(activity.id);
    }
  }
  const current = await request(`/athlete/0/wellness?oldest=${start}&newest=${end}`),
    byDate = new Map(current.map((w) => [w.id, w])),
    days = new Map(),
    unmapped = new Set();
  const fields = {
    "Sleep Hours": ["sleepSecs", 3600],
    HRV: ["hrv", 1],
    Pulse: ["restingHR", 1],
    "Weight Pounds": ["weight", 0.45359237],
  };
  for (const r of metrics) {
    const mapping = fields[r.Type];
    if (!mapping) {
      unmapped.add(r.Type);
      continue;
    }
    const date = r.Timestamp.slice(0, 10);
    if (r.Value === "" || !Number.isFinite(Number(r.Value))) continue;
    const [field, factor] = mapping;
    if (byDate.get(date)?.[field] != null) continue;
    const d = days.get(date) || { id: date };
    d[field] = Number(r.Value) * factor;
    days.set(date, d);
  }
  if (days.size)
    await request("/athlete/0/wellness-bulk", {
      method: "PUT",
      body: JSON.stringify([...days.values()]),
    });
  report.wellnessDays = days.size;
  report.unmappedMetricTypes = [...unmapped];
  const verified = await request(`/athlete/0/activities?oldest=${start}&newest=${end}`);
  report.verifiedActivities = verified.length;
  report.totalLoad = verified.reduce((s, a) => s + (a.icu_training_load || 0), 0);
  await createSupabaseSettingsStore(bootstrap).save({
    TRAININGPEAKS_IMPORT_REPORT: JSON.stringify(report),
  });
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))
)
  await importHistory(process.argv[2], process.argv.includes("--apply"));
