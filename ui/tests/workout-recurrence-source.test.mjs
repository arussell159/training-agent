import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {recurrenceProviderSource} from "../src/lib/workout-recurrence-source.ts";
const app="app:bd2c38fd-63f7-4c8f-95be-80989e469b7a";
test("recurrence retains existing numeric events and maps app identity only to a valid linked event",()=>{
  assert.equal(recurrenceProviderSource("event:123"),"event:123");
  assert.equal(recurrenceProviderSource(app,"event:456"),"event:456");
  for(const id of [undefined,"event:0","activity:123",app])assert.equal(recurrenceProviderSource(id),undefined);
  for(const provider of [undefined,"event:0","activity:123",app])assert.equal(recurrenceProviderSource(app,provider),undefined);
});
test("unmapped app recurrence cannot silently submit and mapping updates re-enable the existing adapter",()=>{
  const source=fs.readFileSync(new URL("../src/components/desktop-workout-recurrence.tsx",import.meta.url),"utf8");
  assert.match(source,/disabled=\{disabled \|\| pendingProvider\}/);
  assert.match(source,/Repeats available after sync/);
  assert.match(source,/addEventListener\("workout-commits-updated",update\)/);
  assert.match(source,/loadWorkoutRecurrence\(sourceId/);
  assert.match(source,/applyWorkoutRecurrence\(sourceId/);
});
