import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.dirname(moduleDir);
const vendorDir = path.join(backendDir, "vendor", "section-11");
const scriptPath = path.join(vendorDir, "examples", "sync.py");
const dataDir = path.join(backendDir, "section-11-data");
const artifactNames = ["latest", "history", "intervals", "routes", "ftp_history", "saved_workouts"];
const maxAgeMs = 15 * 60 * 1000;
let activeRefresh = null;
let cached = null;

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function pythonExecutable() {
  const configured = process.env.SECTION11_PYTHON;
  if (configured) return configured;
  const local = path.join(
    backendDir,
    ".section11-python",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python3"
  );
  if (await exists(local)) return local;
  if (process.platform === "win32" && process.env.USERPROFILE) {
    const bundled = path.join(
      process.env.USERPROFILE,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "python",
      "python.exe"
    );
    if (await exists(bundled)) return bundled;
  }
  return process.platform === "win32" ? "python.exe" : "python3";
}

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function artifactAge() {
  try {
    return Date.now() - (await stat(path.join(dataDir, "latest.json"))).mtimeMs;
  } catch {
    return Infinity;
  }
}

async function readArtifacts() {
  const values = await Promise.all(artifactNames.map(readJson));
  const artifacts = Object.fromEntries(artifactNames.map((name, index) => [name, values[index]]));
  if (!artifacts.latest) return null;
  return {
    status: "ready",
    source: "intervals.icu",
    producer: "official-section-11-sync",
    generated_at:
      artifacts.latest.metadata?.last_updated ||
      artifacts.latest.generated_at ||
      artifacts.latest.data_timestamp ||
      null,
    age_ms: await artifactAge(),
    ...artifacts,
  };
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = "",
      stderr = "",
      settled = false;
    const timer = setTimeout(
      () => {
        if (!settled) {
          settled = true;
          child.kill();
          reject(new Error("Section 11 sync exceeded eight minutes"));
        }
      },
      8 * 60 * 1000
    );
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-64000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-64000);
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0
        ? resolve(stdout)
        : reject(new Error((stderr || stdout || `Section 11 sync exited ${code}`).trim()));
    });
  });
}

export async function refreshSection11Artifacts(config, athleteId) {
  if (activeRefresh) return activeRefresh;
  activeRefresh = (async () => {
    if (!config?.INTERVALS_API_KEY) throw new Error("Intervals.icu is not connected");
    if (!/^i?\d+$/.test(String(athleteId || "")))
      throw new Error("Intervals.icu athlete ID is unavailable");
    await mkdir(dataDir, { recursive: true });
    const python = await pythonExecutable();
    // Intervals accepts athlete/0 as the authenticated athlete and this avoids
    // account-scope differences between API keys that reject the literal ID.
    await run(
      python,
      [scriptPath, "--athlete-id", "0", "--days", "180", "--output", "latest.json", "--lockfile"],
      {
        cwd: dataDir,
        env: {
          ...process.env,
          INTERVALS_KEY: config.INTERVALS_API_KEY,
          PYTHONPATH: vendorDir,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONIOENCODING: "utf-8",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    cached = await readArtifacts();
    if (!cached) throw new Error("Section 11 sync completed without latest.json");
    return cached;
  })().finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

export async function loadSection11Artifacts(
  config,
  athleteId,
  { force = false, waitForRefresh = false } = {}
) {
  if (!cached) cached = await readArtifacts();
  const stale = !cached || cached.age_ms > maxAgeMs;
  if (force || stale) {
    const refresh = refreshSection11Artifacts(config, athleteId);
    if (waitForRefresh) return refresh;
    refresh.catch(() => {});
  }
  return (
    cached || {
      status: "refreshing",
      source: "intervals.icu",
      producer: "official-section-11-sync",
    }
  );
}

const pick = (object, keys) =>
  Object.fromEntries(
    keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]])
  );

export function section11CoachView(artifacts) {
  const latest = artifacts?.latest;
  if (!latest) return null;
  const history = artifacts.history || {};
  return {
    source: "intervals.icu",
    producer: artifacts.producer,
    generated_at: artifacts.generated_at,
    sync_version: latest.metadata?.version || null,
    data_quality: latest.derived_metrics?.data_quality || latest.data_quality || null,
    current_status: latest.current_status || null,
    derived_metrics: latest.derived_metrics || null,
    phase_detection: latest.derived_metrics?.phase_detection || latest.phase_detection || null,
    readiness_decision: latest.readiness_decision || null,
    alerts: latest.alerts || [],
    health_context: latest.health_context || null,
    race_calendar: latest.race_calendar || latest.upcoming_races || null,
    recent_activities: (latest.recent_activities || [])
      .slice(-14)
      .map((row) =>
        pick(row, [
          "id",
          "date",
          "type",
          "name",
          "duration_hours",
          "distance_km",
          "tss",
          "intensity_factor",
          "avg_power",
          "normalized_power",
          "avg_hr",
          "max_hr",
          "variability_index",
          "decoupling",
          "efficiency_factor",
          "hrrc",
          "rpe",
          "feel",
          "effort_response",
          "zone_distribution",
          "has_intervals",
          "has_dfa",
          "weather",
          "weather_status",
          "terrain_summary",
          "terrain_status",
        ])
      ),
    planned_workouts: (latest.planned_workouts || [])
      .slice(0, 14)
      .map((row) =>
        pick(row, [
          "id",
          "date",
          "name",
          "type",
          "sport_type",
          "planned_tss",
          "duration_hours",
          "workout_summary",
          "has_terrain",
        ])
      ),
    longitudinal: {
      data_range: history.data_range || null,
      data_gaps: history.data_gaps || [],
      daily_90d: (history.daily_90d || [])
        .slice(-14)
        .map((row) =>
          pick(row, [
            "date",
            "total_hours",
            "total_tss",
            "ctl",
            "atl",
            "tsb",
            "hrv",
            "rhr",
            "sleep_hours",
            "phase_detected",
          ])
        ),
      weekly_180d: (history.weekly_180d || [])
        .slice(-12)
        .map((row) =>
          pick(row, [
            "week_start",
            "total_hours",
            "total_tss",
            "primary_sport",
            "activity_count",
            "ctl_end",
            "atl_end",
            "tsb_end",
            "ramp_rate",
            "avg_hrv",
            "avg_rhr",
            "avg_sleep_hours",
            "z1_z2_pct",
            "z3_pct",
            "z4_plus_pct",
            "hard_days",
            "monotony",
            "acwr",
            "phase_detected",
            "durability_mean",
            "durability_qualifying",
            "ef_mean",
            "ef_qualifying",
            "hrrc_mean",
            "hrrc_qualifying",
          ])
        ),
      ftp_timeline: (history.ftp_timeline || []).slice(-20),
      period_summaries: history.summaries || history.period_summaries || null,
    },
    interval_detail_available: Boolean(artifacts.intervals),
    route_detail_available: Boolean(artifacts.routes),
    missing_inputs:
      latest.missing_inputs ||
      latest.derived_metrics?.data_quality?.missing_inputs ||
      latest.data_quality?.missing_inputs ||
      [],
    artifact_freshness: pick(artifacts, ["status", "age_ms"]),
  };
}

export function section11SyncStatus(artifacts) {
  const latest = artifacts?.latest;
  return {
    status: artifacts?.status || "unavailable",
    source: artifacts?.source || "intervals.icu",
    producer: artifacts?.producer || "official-section-11-sync",
    generated_at: artifacts?.generated_at || null,
    age_ms: artifacts?.age_ms ?? null,
    sync_version: latest?.metadata?.version || null,
    missing_inputs:
      latest?.missing_inputs ||
      latest?.derived_metrics?.data_quality?.missing_inputs ||
      latest?.data_quality?.missing_inputs ||
      [],
    artifacts: Object.fromEntries(artifactNames.map((name) => [name, Boolean(artifacts?.[name])])),
  };
}
