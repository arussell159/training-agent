import { test } from "node:test";
import assert from "node:assert/strict";
import { dfaSignal } from "./dfa-signal.mjs";
import { normalizeAnalysis } from "./activity-analysis.mjs";
import { loadActivityView } from "./activity-bundle.mjs";

test("DFA statistics exclude sentinels, high artifacts and recording gaps without inventing artifact coverage", () => {
  const signal = dfaSignal([
    { time: 0, dfaA1: 1, dfaArtifacts: 1 },
    { time: 10, dfaA1: 0, dfaArtifacts: 2 },
    { time: 20, dfaA1: 2, dfaArtifacts: 8 },
    { time: 30, dfaA1: 0.5, dfaArtifacts: null },
    { time: 40, dfaA1: 1.5, dfaArtifacts: null },
    { time: 100, dfaA1: 1.5, dfaArtifacts: null },
  ]);
  assert.equal(signal.average, 0.75);
  assert.equal(signal.minimum, 0.5);
  assert.equal(signal.maximum, 1.5);
  assert.equal(signal.validSeconds, 20);
  assert.equal(signal.validPercent, 20);
  assert.equal(signal.artifactCoveragePercent, 30);
  assert.equal(signal.averageArtifacts, 11 / 3);
  assert.equal(dfaSignal([{ time: 0, dfaA1: null }]), null);
  assert.equal(
    dfaSignal([
      { time: 0, dfaA1: 1 },
      { time: 10, dfaA1: 1 },
    ]).averageArtifacts,
    null
  );
});

test("DFA streams survive analysis and cached analysis migration for cycling and running", async () => {
  for (const type of ["Ride", "Run"]) {
    const activity = { id: "i1", type };
    const streams = [
      { type: "time", data: [0, 10, 20] },
      { type: "dfa_a1", data: [1, 0.8, 0.6] },
      { type: "artifacts", data: [1, 2, 3] },
    ];
    const fresh = normalizeAnalysis(activity, streams, []);
    assert.equal(fresh.points[1].dfaA1, 0.8);
    assert.equal(fresh.points[1].dfaArtifacts, 2);
    assert.equal(fresh.dfa.average, 0.9);
    let saved;
    const upgraded = await loadActivityView(
      {
        ready: true,
        loadView: async () => ({ version: 3 }),
        load: async () => ({ activity, streams, fitLaps: [] }),
        saveViews: async (_id, views) => {
          saved = views.analysis;
        },
      },
      {},
      () => {
        throw Error("No network required");
      },
      "i1",
      "analysis"
    );
    assert.equal(upgraded.version, 5);
    assert.deepEqual(upgraded.dfa, fresh.dfa);
    assert.deepEqual(saved, upgraded);
    assert.equal(normalizeAnalysis({ ...activity, type: "Swim" }, streams, []).dfa, null);
  }
});
