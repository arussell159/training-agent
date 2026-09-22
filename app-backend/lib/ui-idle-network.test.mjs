import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("idle authentication timers and resume handlers are local expiry checks only", () => {
  const text = fs.readFileSync(
    new URL("../../ui/src/components/app-auth.tsx", import.meta.url),
    "utf8"
  );
  assert.match(text, /setInterval\(checkExpiry, 60000\)/);
  for (const event of ["focus", "pageshow", "visibilitychange"])
    assert.ok(text.includes('addEventListener("' + event + '", checkExpiry)'));
  const clock = text.slice(text.indexOf("const checkExpiry ="), text.indexOf("const storage ="));
  assert.ok(clock.includes("expiresAt"));
  assert.ok(!/refresh\(|fetch\(|authRequest\(/.test(clock));
  assert.ok(text.includes("app-auth-required"));
  assert.ok(text.includes("training-app-signed-out"));
});
test("report views no longer run an unbounded database status timer", () => {
  const text = fs.readFileSync(
    new URL("../../ui/src/components/section11-report.tsx", import.meta.url),
    "utf8"
  );
  assert.ok(!text.includes("setInterval"));
  assert.ok(text.includes("training-context-updated"));
});
