import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFitSwimLengths, normalizeAnalysis } from "./activity-analysis.mjs";
import { loadActivityView } from "./activity-bundle.mjs";
import { swimSplits } from "../../ui/src/lib/swim-splits.ts";

function fitMessage(type, fields, rows) {
  const definition = Buffer.from([
    0x40,
    0,
    0,
    type & 255,
    type >> 8,
    fields.length,
    ...fields.flatMap(([id, size]) => [id, size, size === 1 ? 2 : size === 2 ? 0x84 : 0x86]),
  ]);
  const data = rows.map((row) => {
    const buffer = Buffer.alloc(1 + fields.reduce((sum, [, size]) => sum + size, 0));
    let offset = 1;
    fields.forEach(([, size], index) => {
      buffer.writeUIntLE(row[index], offset, size);
      offset += size;
    });
    return buffer;
  });
  return Buffer.concat([definition, ...data]);
}

function swimFit(poolLength = 2286) {
  const payload = Buffer.concat([
    // Exports may repeat the session start in timestamp (253), including on
    // the session summary. Length start_time and session elapsed time are valid.
    fitMessage(
      18,
      [
        [2, 4],
        [7, 4],
        [44, 2],
        [253, 4],
      ],
      [[1000, 240000, poolLength, 1000]]
    ),
    fitMessage(
      101,
      [
        [2, 4],
        [3, 4],
        [4, 4],
        [12, 1],
        [253, 4],
      ],
      [
        [1000, 25000, 22500, 1, 1000],
        [1025, 25000, 23000, 1, 1000],
        [1050, 25000, 22000, 1, 1000],
        [1075, 25000, 23500, 1, 1000],
        [1100, 20000, 20000, 0, 1000],
        [1120, 25000, 25000, 1, 1000],
        [1145, 25000, 25000, 1, 1000],
        [1170, 25000, 25000, 1, 1000],
        [1195, 25000, 25000, 1, 1000],
      ]
    ),
  ]);
  const header = Buffer.alloc(14);
  header[0] = 14;
  header.writeUInt32LE(payload.length, 4);
  header.write(".FIT", 8);
  return Buffer.concat([header, payload]);
}

const start = new Date(Date.UTC(1989, 11, 31) + 1000000).toISOString();
const activity = { id: "i1", type: "Swim", start_date: start };

test("FIT pool lengths produce exact 100-yard swim splits, excluding rest and paused timer time", () => {
  const lengths = readFitSwimLengths(gzipSync(swimFit()));
  assert.equal(lengths.length, 8);
  assert.equal(lengths[0].distance, 22.86);
  assert.equal(lengths[0].elapsedDuration, 25);
  assert.equal(lengths[0].duration, 22.5);
  const analysis = normalizeAnalysis(activity, [], [], lengths);
  const splits = swimSplits(analysis);
  assert.deepEqual(
    splits.map((s) => ({
      yards: Math.round(s.distance / 0.9144),
      pace: s.pace,
      estimated: s.estimated,
    })),
    [
      { yards: 100, pace: 91, estimated: false },
      { yards: 100, pace: 100, estimated: false },
    ]
  );
  assert.equal(splits[0].start, 0);
  assert.equal(splits[1].start, 120);
  assert.deepEqual(readFitSwimLengths(swimFit(0)), []);
});

test("100-yard splits retain the individual length timings within a longer recorded repeat", () => {
  const swimLengths = Array.from({ length: 12 }, (_, i) => ({
    start: i * 30,
    end: i * 30 + 30,
    distance: 22.86,
    seconds: i < 4 ? 20 : i < 8 ? 25 : 30,
  }));
  const splits = swimSplits({ swimLengths, laps: [{ start: 0, end: 360, distance: 274.32 }] });
  assert.deepEqual(
    splits.map((s) => s.pace),
    [80, 100, 120]
  );
  assert.ok(splits.every((s) => !s.estimated));
});

test("older recordings combine active 50-yard laps without counting intervening rest", () => {
  const splits = swimSplits({
    laps: [
      { start: 30, end: 82, distance: 45.72 },
      { start: 82, end: 120, distance: 0 },
      { start: 120, end: 171, distance: 45.72 },
      { start: 200, end: 291, distance: 91.44 },
      { start: 320, end: 345, distance: 22.86 },
    ],
  });
  assert.deepEqual(
    splits.map((s) => ({
      yards: Math.round(s.distance / 0.9144),
      pace: s.pace,
      estimated: s.estimated,
    })),
    [
      { yards: 100, pace: 103, estimated: false },
      { yards: 100, pace: 91, estimated: false },
      { yards: 25, pace: 100, estimated: false },
    ]
  );
});

test("incomplete lengths fall back to all lap distance and mark prorated split times as estimates", () => {
  const splits = swimSplits({
    swimLengths: [{ start: 0, end: 25, seconds: 25, distance: 22.86 }],
    laps: [{ start: 0, end: 300, distance: 274.32 }],
  });
  assert.equal(splits.length, 3);
  assert.ok(splits.every((s) => s.estimated && Math.abs(s.pace - 100) < 0.0001));
  assert.deepEqual(
    swimSplits({
      laps: [
        { start: 0, end: 0, distance: 91.44 },
        { start: 0, end: 90, distance: null },
        { start: 0, end: 90, distance: NaN },
      ],
    }),
    []
  );
  assert.deepEqual(swimSplits({}), []);
});

test("version 5 archives rebuild swim splits from their original FIT without a provider download", async () => {
  let saved;
  const bundle = {
    activity,
    streams: [],
    fitLaps: [],
    original_file: { type: "fit", data: swimFit().toString("base64") },
  };
  const archive = {
    ready: true,
    loadView: async () => ({ version: 5 }),
    load: async () => bundle,
    saveViews: async (_id, views) => {
      saved = views.analysis;
    },
  };
  const analysis = await loadActivityView(
    archive,
    {},
    () => {
      throw Error("Unexpected network request");
    },
    "i1",
    "analysis"
  );
  assert.equal(analysis.version, 7);
  assert.deepEqual(
    swimSplits(analysis).map((s) => s.pace),
    [91, 100]
  );
  assert.deepEqual(analysis, saved);
});
