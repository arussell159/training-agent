import test from "node:test";
import assert from "node:assert/strict";
import { section11CoachView, section11SyncStatus } from "./section-11-sync.mjs";
import { section11Snapshot } from "./section-11-adapter.mjs";

const artifacts = {
  status: "ready",
  source: "intervals.icu",
  producer: "official-section-11-sync",
  age_ms: 1000,
  generated_at: "2026-09-16T12:00:00",
  latest: {
    metadata: { version: "3.133", last_updated: "2026-09-16T12:00:00" },
    current_status: { fitness: { ctl: 42 } },
    derived_metrics: {
      acwr: 1.1,
      phase_detection: { phase: "Build" },
      data_quality: { activities_28d: 20 },
    },
    readiness_decision: { recommendation: "go" },
    alerts: [],
    health_context: { source_status: "ok" },
    recent_activities: [],
    planned_workouts: [],
  },
  history: {
    daily_90d: [{ date: "2026-09-16" }],
    weekly_180d: [{ week: "2026-09-14" }],
    summaries: { days_90: { tss: 500 } },
  },
  intervals: { activities: [] },
  routes: { events: [] },
  ftp_history: { entries: [] },
  saved_workouts: { folders: [] },
};

test("official Section 11 artifacts become authoritative coach metrics", () => {
  const view = section11CoachView(artifacts);
  assert.equal(view.sync_version, "3.133");
  assert.equal(view.derived_metrics.acwr, 1.1);
  assert.equal(view.phase_detection.phase, "Build");
  assert.equal(view.readiness_decision.recommendation, "go");
  assert.deepEqual(view.longitudinal.period_summaries, { days_90: { tss: 500 } });
  const snapshot = section11Snapshot({ section11_artifacts: artifacts }, "2026-09-16");
  assert.equal(snapshot.availability.section11_sync_artifacts, true);
  assert.equal(snapshot.section11_metrics.source, "intervals.icu");
});

test("sync status reports every generated artifact without exposing credentials", () => {
  const status = section11SyncStatus(artifacts);
  assert.equal(status.sync_version, "3.133");
  assert.deepEqual(status.artifacts, {
    latest: true,
    history: true,
    intervals: true,
    routes: true,
    ftp_history: true,
    saved_workouts: true,
  });
  assert.equal(JSON.stringify(status).includes("INTERVALS"), false);
});
