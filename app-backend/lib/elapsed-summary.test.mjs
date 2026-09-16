import { test } from "node:test";
import assert from "node:assert/strict";
import { elapsedSummary } from "./elapsed-summary.mjs";
test("elapsed pace includes all rests", () => {
  assert.deepEqual(elapsedSummary({ distance: 400, elapsed_time: 600, moving_time: 400 }), {
    elapsed_time_seconds: 600,
    elapsed_speed: 400 / 600,
  });
});
test("missing elapsed time is never replaced with moving time", () => {
  assert.deepEqual(elapsedSummary({ distance: 400, moving_time: 400 }), {
    elapsed_time_seconds: null,
    elapsed_speed: null,
  });
});
