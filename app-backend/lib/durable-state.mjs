import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSupabaseSettingsStore } from "./settings-store.mjs";

const configPath = fileURLToPath(new URL("../config.json", import.meta.url));
async function store() {
  let local = {};
  try {
    local = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch {}
  const environment = Object.fromEntries(
    ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SETTINGS_ENCRYPTION_KEY", "SETTINGS_SCOPE"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]])
  );
  return createSupabaseSettingsStore(
    process.env.VERCEL ? { ...local, ...environment } : { ...environment, ...local }
  );
}
// Files are migration inputs and read-through caches, never the durable save destination.
export function createDurableState({
  getStore = store,
  readFile = fs.readFile,
  writeFile = fs.writeFile,
} = {}) {
  return {
    async read(name, cachePath, fallback) {
      const remote = await getStore();
      const values = await remote.read([name]);
      if (values[name]) return JSON.parse(values[name]);
      let initial;
      try {
        initial = JSON.parse(await readFile(cachePath, "utf8"));
      } catch {
        initial = typeof fallback === "function" ? await fallback() : fallback;
      }
      if (initial == null) return initial;
      await remote.save({ [name]: JSON.stringify(initial) });
      return initial;
    },
    async write(name, value, cachePath) {
      await (await getStore()).save({ [name]: JSON.stringify(value) });
      if (cachePath) {
        try {
          await writeFile(cachePath, JSON.stringify(value, null, 2));
        } catch {
          /* Cache failure cannot undo a confirmed database save. */
        }
      }
    },
  };
}
const state = createDurableState();
export const readDurableState = (...args) => state.read(...args);
export const writeDurableState = (...args) => state.write(...args);
