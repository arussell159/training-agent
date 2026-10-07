// Read-only latency probe: uses the existing backend connection without changing
// training data, authentication state, settings, or webhook subscriptions.
import fs from "node:fs/promises";
import { createSettingsService } from "../app-backend/lib/settings-store.mjs";
import { createContextStore } from "../app-backend/lib/supabase-context.mjs";
import { fastViewId } from "../app-backend/lib/fast-context.mjs";
import { createIntervalsClient, fetchIntervalsContext } from "../app-backend/lib/intervals.mjs";

let local = {};
try {
  local = JSON.parse(
    await fs.readFile(new URL("../app-backend/config.json", import.meta.url), "utf8")
  );
} catch {
  /* environment-only deployment */
}
const environment = Object.fromEntries(
  [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SETTINGS_ENCRYPTION_KEY",
    "SETTINGS_SCOPE",
    "INTERVALS_API_KEY",
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]])
);
const config = await createSettingsService({
  readBootstrap: async () => ({ ...environment, ...local }),
  writeBootstrap: async () => {
    throw Error("Read-only probe");
  },
}).read();
if (config.settingsError || !config.INTERVALS_API_KEY)
  throw Error(config.settingsError || "Intervals.icu connection unavailable");
const store = createContextStore(config);
const readings = [];
for (let index = 0; index < 3; index++) {
  const started = performance.now();
  const view = await store.getSyncRecord(fastViewId(config), { fresh: true });
  if (!view?.athlete) throw Error("No prepared training snapshot");
  readings.push({
    milliseconds: Math.round(performance.now() - started),
    bytes: Buffer.byteLength(JSON.stringify(view)),
  });
}
let providerRequests = 0;
const client = createIntervalsClient(config);
const started = performance.now();
await fetchIntervalsContext(
  (...args) => {
    providerRequests++;
    return client(...args);
  },
  { includeFutureRaces: true }
);
console.log(
  JSON.stringify(
    {
      snapshotReads: readings,
      providerRefresh: {
        milliseconds: Math.round(performance.now() - started),
        requests: providerRequests,
      },
      unchangedResponseBytes: Buffer.byteLength(
        JSON.stringify({ unchanged: true, version: "x".repeat(64) })
      ),
    },
    null,
    2
  )
);
