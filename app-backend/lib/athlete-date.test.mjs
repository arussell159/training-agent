import { test } from "node:test";
import assert from "node:assert/strict";
import { athleteLocalDate } from "./athlete-date.mjs";

test("calendar dates follow the athlete timezone across a UTC date boundary", () => {
  assert.equal(athleteLocalDate(new Date("2026-09-16T01:00:00Z"), "America/Chicago"), "2026-09-15");
});
