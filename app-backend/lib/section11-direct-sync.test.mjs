import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { runSection11DirectSync, section11WorkerOrigin } from "./section11-direct-sync.mjs";

test("worker uses the public app URL instead of the protected deployment URL", () => {
  const env = {
    APP_ORIGIN: "https://app.example",
    VERCEL_URL: "protected.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "public.vercel.app",
  };
  assert.equal(section11WorkerOrigin(env), "https://app.example");
  assert.equal(section11WorkerOrigin({ ...env, APP_ORIGIN: "" }), "https://public.vercel.app");
  assert.equal(
    section11WorkerOrigin({ ...env, SECTION11_DIRECT_SYNC_ORIGIN: "https://worker.example" }),
    "https://worker.example"
  );
});

test("worker platform errors are readable instead of becoming object Object", async () => {
  await assert.rejects(
    runSection11DirectSync({
      repo: "athlete/data",
      branch: "main",
      githubToken: "fake",
      intervalsKey: "fake",
      athleteId: "i123",
      origin: "https://app.example",
      fetchImpl: async () =>
        Response.json(
          { error: { code: "DEPLOYMENT_NOT_FOUND", message: "Deployment unavailable" } },
          { status: 404 }
        ),
    }),
    /GitHub export failed \(HTTP 404\).*Deployment unavailable/
  );
});

test("direct sync signs a server-only request to the Python worker", async () => {
  const result = await runSection11DirectSync({
    repo: "athlete/data",
    branch: "main",
    githubToken: "test-github-token",
    intervalsKey: "test-intervals-key",
    athleteId: "i123",
    origin: "https://training.example",
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(url.href, "https://training.example/internal/section11-worker");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["X-Section11-Timestamp"], "1700000000");
      const expected = createHmac("sha256", "test-github-token")
        .update(`1700000000.${options.body}`)
        .digest("hex");
      assert.equal(options.headers["X-Section11-Signature"], expected);
      assert.equal(options.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(options.body), {
        repo: "athlete/data",
        branch: "main",
        athlete_id: "i123",
        intervals_key: "test-intervals-key",
        days: 7,
        week_start: "",
        zone_preference: "",
      });
      return Response.json({ status: "complete", commit: "a".repeat(40) });
    },
  });
  assert.equal(result.commit, "a".repeat(40));
});
