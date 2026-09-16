import test from "node:test";
import assert from "node:assert/strict";
import { section11UpstreamStatus } from "./section-11-upstream.mjs";

test("upstream status identifies whether the installed Section 11 commit is current", async () => {
  const first = await section11UpstreamStatus(
    async () => new Response(JSON.stringify({ sha: "different" }), { status: 200 })
  );
  assert.equal(first.repository, "CrankAddict/section-11");
  assert.equal(first.update_available, true);
  assert.equal(first.latest_commit, "different");
});
