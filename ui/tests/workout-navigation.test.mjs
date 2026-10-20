import test from "node:test";
import assert from "node:assert/strict";
import { restoreOpenWorkout, workoutRouteId } from "../src/lib/workout-navigation.ts";

test("recovers the supplied activity link with a literal external_id suffix", () => {
  globalThis.window = { location: { search: "?workout=activity%3Ai193565756$external_id$" } };
  assert.equal(workoutRouteId(), "activity:i193565756");
  window.location.search = "?workout=activity%3Ai193565756";
  assert.equal(workoutRouteId(), "activity:i193565756");
});

const workout = {
  id: "fixture",
  sport: "Run",
  title: "Fixture workout",
  duration: "30m",
  workout_date: "2026-10-06",
};

test("a valid matching context row takes precedence over the saved workout", () => {
  globalThis.window = { location: { search: "?workout=fixture" } };
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ ...workout, title: "Old title" }) };
  assert.equal(restoreOpenWorkout([workout]).title, "Fixture workout");
});

test("corrupt or mismatched saved workouts safely use context loading", () => {
  globalThis.window = { location: { search: "?workout=fixture" } };
  for (const saved of [
    { id: "fixture", sport: {}, workout_summary: "broken" },
    { ...workout, id: "other" },
    { ...workout, workout_date: "2026-02-31" },
    { ...workout, workout_summary: "broken" },
  ]) {
    globalThis.sessionStorage = { getItem: () => JSON.stringify(saved) };
    assert.equal(restoreOpenWorkout(), null);
  }
  globalThis.sessionStorage = { getItem: () => JSON.stringify(workout) };
  assert.deepEqual(restoreOpenWorkout([{ ...workout, sport: {} }]), workout);
});

test("blocked storage and absent deep links cannot open a workout", () => {
  globalThis.window = { location: { search: "?workout=fixture" } };
  globalThis.sessionStorage = {
    getItem: () => {
      throw Error("Storage blocked");
    },
  };
  assert.equal(restoreOpenWorkout(), null);
  globalThis.window.location.search = "";
  assert.equal(restoreOpenWorkout([workout]), null);
});
test("undated library previews restore from their saved snapshot after reload",()=>{
  globalThis.window={location:{search:"?workout=library%3A15"}};
  const saved={...workout,id:"library:15",workout_date:undefined,date:"Saved workout"};
  globalThis.sessionStorage={getItem:()=>JSON.stringify(saved)};
  const restored=restoreOpenWorkout();assert.equal(restored.id,"library:15");assert.equal(restored.workout_date,undefined);assert.equal(restored.status,"upcoming");
  globalThis.sessionStorage={getItem:()=>JSON.stringify({...saved,workout_summary:{planned:{tss:"corrupt"}}})};assert.equal(restoreOpenWorkout(),null);
});
