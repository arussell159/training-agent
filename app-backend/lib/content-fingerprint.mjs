import { createHash } from "node:crypto";

// JSONB reorders object keys. Content revisions must survive database round trips.
export function contentFingerprint(value) {
  const json = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );
  return createHash("sha256").update(json).digest("hex");
}
