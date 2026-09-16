import { test } from "node:test";
import assert from "node:assert/strict";
import { toFunctionUrl, resolveApiRoute } from "./api-routing.mjs";

test("API requests use the actual Vercel function and retain route and query", () => {
  for (const path of [
    "/api/config",
    "/api/training-context?scope=full&refresh=1",
    "/api/workouts/event%3A123/move",
    "/api/conversations?limit=500",
  ]) {
    assert.ok(toFunctionUrl(path).startsWith("/api/handler?"));
    assert.equal(resolveApiRoute(toFunctionUrl(path)), path);
  }
});
test("direct localhost routes still work and invalid function routes are rejected", () => {
  assert.equal(resolveApiRoute("/api/config?x=1"), "/api/config?x=1");
  assert.throws(() => resolveApiRoute("/api/handler"), /Invalid API route/);
  assert.throws(() => resolveApiRoute("/api/handler?__api_route=../config"), /Invalid API route/);
});
