import fs from "node:fs/promises";
import http from "node:http";
import { parseEnv } from "node:util";
import { createPreviewFetch } from "./lib/local-preview.mjs";

if (process.env.VERCEL) throw new Error("The local preview cannot run on Vercel.");
const envPath = new URL("../.env.local", import.meta.url);
Object.assign(process.env, parseEnv(await fs.readFile(envPath, "utf8")));
if (process.env.VERCEL) throw new Error("Remove VERCEL from the local environment file.");
process.env.NUTRITION_LOCAL_PREVIEW = "true";
process.env.LOCAL_DATABASE_OFFLINE = "true";
let config = {};
try {
  config = JSON.parse(await fs.readFile(new URL("./config.json", import.meta.url), "utf8"));
} catch {}
// Install before importing the server so every database adapter receives the guard.
globalThis.fetch = createPreviewFetch(fetch, [process.env.SUPABASE_URL, config.SUPABASE_URL]);
const { handleRequest } = await import("./server.mjs");
http.createServer(handleRequest).listen(4190, "127.0.0.1", () => {
  console.log(
    "Nutrition preview API: http://127.0.0.1:4190 — .env.local loaded; Supabase blocked."
  );
});
