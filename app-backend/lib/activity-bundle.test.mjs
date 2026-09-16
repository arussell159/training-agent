import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadActivityBundle, downloadOriginalActivityFile } from "./activity-bundle.mjs";

test("bundle retains every available stream and the original FIT bytes, with ready-to-display views", async () => {
  const bytes = Buffer.alloc(14);
  bytes[0] = 14;
  bytes.write(".FIT", 8);
  const activity = {
    id: "i1",
    type: "Swim",
    file_type: "fit",
    start_date_local: "2026-09-15T10:00:00",
    distance: 91.44,
    moving_time: 103,
    icu_intervals: [{ type: "WORK", start_time: 0, end_time: 103, distance: 91.44 }],
  };
  const streams = [
    { type: "time", data: [0, 103] },
    { type: "velocity_smooth", data: [0.887, 0.887] },
    { type: "heartrate", data: [140, 142] },
    { type: "temperature", data: [25, 26] },
    {
      type: "latlng",
      data: [
        [1, 2],
        [3, 4],
      ],
    },
  ];
  const requested = [];
  const bundle = await downloadActivityBundle(
    async (path) => {
      requested.push(path);
      return path.endsWith("streams.json") ? streams : activity;
    },
    "i1",
    async () => bytes
  );
  assert.ok(requested.includes("/activity/i1/streams.json"));
  assert.deepEqual(bundle.streams, streams);
  assert.deepEqual(Buffer.from(bundle.original_file.data, "base64"), bytes);
  assert.equal(bundle.original_file.sha256.length, 64);
  assert.equal(bundle.analysis.points.length, 2);
  assert.equal(bundle.analysis.laps[0].distance, 91.44);
  assert.equal(bundle.summary.distance_meters, 91.44);
  assert.equal(bundle.route.length, 2);
});
test("manual workouts explicitly record missing streams/files without fabricating data", async () => {
  const bundle = await downloadActivityBundle(
    async (path) => {
      if (path.endsWith("streams.json")) {
        const error = Error("not found");
        error.status = 404;
        throw error;
      }
      return {
        id: "i2",
        type: "WeightTraining",
        moving_time: 600,
        start_date_local: "2026-09-15T10:00:00",
      };
    },
    "i2",
    async () => {
      throw Error("manual workout has no file");
    }
  );
  assert.equal(bundle.original_file, null);
  assert.deepEqual(bundle.availability, { streams: false, original_file: false });
  assert.deepEqual(bundle.analysis.points, []);
});
test("transient provider failures must not be cached as empty successful downloads", async () => {
  await assert.rejects(
    downloadOriginalActivityFile({ INTERVALS_API_KEY: "test" }, "i1", async () => ({
      status: 503,
      ok: false,
    })),
    /503/
  );
  await assert.rejects(
    downloadActivityBundle(
      async (path) => {
        if (path.endsWith("streams.json")) throw Error("offline");
        return { id: "i1" };
      },
      "i1",
      async () => null
    ),
    /offline/
  );
});
