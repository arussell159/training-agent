import test from "node:test";
import assert from "node:assert/strict";
import {workoutRouteId} from "../src/lib/workout-navigation.ts";
test("recovers the supplied activity link with a literal external_id suffix", () => {
  globalThis.window = { location: { search: "?workout=activity%3Ai193565756$external_id$" } };
  assert.equal(workoutRouteId(), "activity:i193565756");
  window.location.search = "?workout=activity%3Ai193565756";
  assert.equal(workoutRouteId(), "activity:i193565756");
});
