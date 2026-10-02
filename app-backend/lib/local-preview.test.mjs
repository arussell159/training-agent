import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewFetch, previewConfig } from "./local-preview.mjs";

test("local preview blocks Supabase and custom database domains before network access", async () => {
  const calls = [];
  const fetch = createPreviewFetch(
    async (input) => {
      calls.push(input);
      return "ok";
    },
    ["https://database.example"]
  );
  for (const url of [
    "https://project.supabase.co/rest/v1/app_settings",
    "https://project.supabase.in/auth/v1/user",
    "https://database.example/rest/v1/sync_state",
  ])
    await assert.rejects(fetch(url), /Supabase is disabled/);
  assert.equal(calls.length, 0);
  assert.equal(await fetch("https://platform.fatsecret.com/rest/foods/search/v1"), "ok");
  assert.equal(calls.length, 1);
});
test("database isolation only applies to explicit non-hosted previews", () => {
  const config = {
    SUPABASE_URL: "https://db.example",
    SUPABASE_SECRET_KEY: "fixture",
    INTERVALS_API_KEY: "fixture",
  };
  assert.equal(previewConfig(config, { LOCAL_DATABASE_OFFLINE: "true" }).SUPABASE_URL, "");
  assert.deepEqual(previewConfig(config, {}), config);
  assert.deepEqual(previewConfig(config, { LOCAL_DATABASE_OFFLINE: "true", VERCEL: "1" }), config);
});
