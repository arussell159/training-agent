import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTermsNavigation } from "../../ui/src/lib/terms-navigation.ts";
import {
  METRIC_DEFINITIONS,
  searchMetricDefinitions,
} from "../../ui/src/lib/terms-reference-data.ts";

test("every metric in the supplied reference remains discoverable in the shared dictionary", () => {
  const aliases = new Set(METRIC_DEFINITIONS.flatMap((metric) => metric.aliases || []));
  const lines = fs
    .readFileSync(new URL("../../docs/section-11-reference.md", import.meta.url), "utf8")
    .split(/\r?\n/);
  let section = 0;
  for (const line of lines) {
    if (line.startsWith("## ")) section = Number(line.match(/^## (\d+)\./)?.[1]);
    if (section >= 1 && section <= 8 && /^\| \*\*/.test(line)) {
      const name = line.split("|")[1].replaceAll("**", "").trim();
      assert.ok(aliases.has(name), `Missing reference metric: ${name}`);
    }
  }
  assert.equal(
    new Set(METRIC_DEFINITIONS.map((metric) => metric.id)).size,
    METRIC_DEFINITIONS.length
  );
  assert.ok(METRIC_DEFINITIONS.every((metric) => metric.name && metric.definition));
});

test("local search matches names, abbreviations, unicode and multiple words without searching unrelated notes", () => {
  assert.deepEqual(
    searchMetricDefinitions(" RHR ").map((metric) => metric.id),
    ["rhr"]
  );
  assert.deepEqual(
    searchMetricDefinitions("resting heart rate").map((metric) => metric.id),
    ["rhr"]
  );
  assert.ok(searchMetricDefinitions("np").some((metric) => metric.name === "Normalized Power"));
  assert.ok(
    searchMetricDefinitions("VO2max").some((metric) => metric.name === "Maximal Oxygen Uptake")
  );
  assert.ok(
    searchMetricDefinitions("DFA alpha 1").some((metric) => metric.abbreviation === "DFA a1 / α1")
  );
  assert.equal(searchMetricDefinitions("not-a-real-metric").length, 0);
  assert.equal(searchMetricDefinitions("").length, METRIC_DEFINITIONS.length);
});

test("contextual metrics do not acquire unsupported red bands or automatic skip advice", () => {
  for (const id of ["ftp", "ctl", "atl", "rpe", "fatigue-trend", "load-recovery-ratio", "di"]) {
    const metric = METRIC_DEFINITIONS.find((item) => item.id === id);
    assert.ok(metric);
    assert.ok((metric.bands || []).every((band) => !band.tone || band.tone === "neutral"));
  }
  const rhr = METRIC_DEFINITIONS.find((metric) => metric.id === "rhr");
  assert.equal(rhr.bands.find((band) => band.tone === "red").range, "≥5 bpm above baseline");
  assert.match(rhr.bands.find((band) => band.tone === "red").meaning, /combined rules/);
  const ri = METRIC_DEFINITIONS.find((metric) => metric.id === "ri");
  assert.equal(ri.bands.find((band) => band.tone === "red").range, "<0.60");
});

function fixture() {
  const origin = { calendarDate: "2026-09-18", tab: "week", filters: ["Swim"], workout: "i42" };
  const entries = [origin];
  let index = 0,
    pending = null,
    notifications = [];
  const history = {
    get state() {
      return entries[index];
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push(state);
      index++;
    },
    back() {
      pending = index - 1;
    },
    go(delta) {
      pending = index + delta;
    },
  };
  const nav = createTermsNavigation(history, (state) => notifications.push(state), "test");
  const pop = () => {
    index = pending;
    pending = null;
    return nav.pop(history.state);
  };
  return {
    origin,
    history,
    entries,
    nav,
    pop,
    notifications,
    forward() {
      pending = index + 1;
      return pop();
    },
  };
}

test("Back closes the sheet before terms, preserves original route state, and does not grow history", () => {
  const f = fixture();
  f.nav.open();
  f.nav.open(); // Effect replay must not duplicate the entry.
  f.nav.metric("hrv");
  assert.equal(f.entries.length, 3);
  assert.equal(f.history.state.calendarDate, f.origin.calendarDate);
  f.nav.back();
  f.nav.back(); // Repeated dismissal during animation is one Back.
  assert.equal(f.pop(), true);
  assert.deepEqual(f.nav.current(), { open: true, metricId: null });
  f.nav.back();
  f.pop();
  assert.deepEqual(f.history.state, f.origin);
  assert.deepEqual(f.nav.current(), { open: false, metricId: null });
  assert.equal(f.entries.length, 3);
  assert.equal(f.nav.pop({ anotherPage: true }), false);
});

test("Forward restores terms and metric, and closing/reopening a metric keeps history bounded", () => {
  const f = fixture();
  f.nav.open();
  f.nav.metric("hrv");
  f.nav.back();
  f.pop();
  f.nav.back();
  f.pop();
  f.forward();
  assert.deepEqual(f.nav.current(), { open: true, metricId: null });
  f.forward();
  assert.deepEqual(f.nav.current(), { open: true, metricId: "hrv" });
  f.nav.back();
  f.pop();
  f.nav.metric("rhr");
  assert.equal(f.entries.length, 3);
  f.nav.dismiss();
  f.pop();
  assert.deepEqual(f.history.state, f.origin);
});
