import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Preview files remain local. Serialize updates and rename atomically before acknowledging saves. */
export function localNutritionRecords(directory) {
  const queues = new Map();
  return (key, fresh) => {
    if (!/^(preferences|library|\d{4}-\d{2})$/.test(key)) throw Error("Invalid nutrition record.");
    const file = path.join(directory, `${key}.cache`);
    const read = async () => {
      try {
        return JSON.parse(await fs.readFile(file, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return fresh();
        throw error;
      }
    };
    return {
      read: async () => {
        await queues.get(key);
        return read();
      },
      update(change) {
        const update = (queues.get(key) || Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const state = await read(),
              result = change(state);
            await fs.mkdir(directory, { recursive: true });
            const temp = `${file}.${randomUUID()}.tmp`;
            await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 });
            await fs.rename(temp, file);
            return result;
          });
        queues.set(key, update);
        void update
          .finally(() => {
            if (queues.get(key) === update) queues.delete(key);
          })
          .catch(() => {});
        return update;
      },
    };
  };
}
