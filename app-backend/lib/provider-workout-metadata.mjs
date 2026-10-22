import { createHash } from "node:crypto";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { readEditorModel, verifyParsedWorkout } from "./workout-editor-model.mjs";
import { readPlannedValues } from "./planned-workout-values.mjs";
import {
  providerWorkoutDescription,
  workoutMetadataEnvelopes as envelopes,
} from "./workout-provider-description.mjs";
export { providerWorkoutDescription } from "./workout-provider-description.mjs";

// These are internal envelopes, not athlete instructions. Keep the existing
// in-app representation for compatibility, but never send the envelopes to ICU.
const hash = (text) => createHash("sha256").update(text).digest("hex");

function resource(pathname) {
  const path = pathname.split("?")[0];
  if (/^\/athlete\/[^/]+\/activities\/manual\/bulk$/.test(path))
    return { kind: "activity", id: null };
  const match = path.match(/^\/athlete\/[^/]+\/(events|workouts|activities)(?:\/([^/]+))?$/);
  if (match) {
    if (["bulk-delete"].includes(match[2])) return null;
    return {
      kind: match[1] === "activities" ? "activity" : match[1],
      id: /^\d+$/.test(match[2] || "") ? match[2] : null,
    };
  }
  const activity = path.match(/^\/activity\/([a-zA-Z0-9_-]+)$/);
  return activity ? { kind: "activity", id: activity[1] } : null;
}
function identities(kind, value, pathId) {
  return [
    value.id ?? pathId,
    value.external_id ? `external:${value.external_id}` : null,
    ...(kind === "workouts"
      ? (value.tags || [])
          .filter((tag) => /^training-agent-event-\d+$/.test(tag))
          .map((tag) => `tag:${tag}`)
      : []),
  ]
    .filter((id) => id != null)
    .map((id) => hash(`${kind}:${id}`));
}

/** An encrypted, account-scoped sidecar for internal editor data and totals.
 * The small index contains hashes only; full descriptions live in immutable
 * records. A fresh provider prescription must match before its editor model is
 * reattached. Provider prose always wins; comments remain attached to the workout.
 */
export function createProviderWorkoutMetadata({ record, readable = true }) {
  const texts = new Map();
  const observed = new Map();
  const index = () => record("index", () => ({ entries: {} })).read();
  const update = (change) => record("index", () => ({ entries: {} })).update(change);
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const cleanRow = (value) => ({
    ...value,
    ...(Object.hasOwn(value || {}, "description")
      ? { description: providerWorkoutDescription(value.description) }
      : {}),
  });
  async function commit(stages) {
    if (!stages.length) return;
    await update((state) => {
      for (const stage of stages) {
        if (state.pending?.[stage.key]?.digest !== stage.digest) {
          if (stage.ids.every((id) => state.entries[id]?.[stage.visible] === stage.digest))
            continue;
          throw Error("Workout editor save metadata changed. Recheck the same draft.");
        }
        for (const id of stage.ids) {
          const versions = { ...state.entries[id] };
          delete versions[stage.visible];
          state.entries[id] = Object.fromEntries(
            [...Object.entries(versions), [stage.visible, stage.digest]].slice(-4)
          );
        }
        delete state.pending[stage.key];
      }
    });
  }
  async function recover(value, info, state) {
    if (!state.pending) return state;
    if (
      typeof state.pending !== "object" ||
      Array.isArray(state.pending) ||
      Object.keys(state.pending).length > 1024
    )
      throw Error("Pending workout editor metadata could not be verified.");
    const ids = identities(info.kind, value, info.id),
      matches = [],
      visible = hash(providerWorkoutDescription(value.description));
    for (const [key, stage] of Object.entries(state.pending)) {
      if (
        !stage ||
        typeof stage.changed !== "boolean" ||
        !["POST", "PUT", "PATCH"].includes(stage.method) ||
        ![key, stage.digest, stage.visible].every((value) => /^[a-f0-9]{64}$/.test(value || "")) ||
        !Array.isArray(stage.ids) ||
        !stage.ids.length ||
        stage.ids.length > 256 ||
        !stage.ids.every((value) => /^[a-f0-9]{64}$/.test(value || ""))
      )
        throw Error("Pending workout editor metadata could not be verified.");
      if (stage.visible !== visible || !stage.ids.some((id) => ids.includes(id))) continue;
      if (!stage.changed && stage.method !== "POST") continue;
      const intent = await record(`intent:${key}`, () => ({ body: null })).read();
      if (
        !intent?.body ||
        hash(
          JSON.stringify({
            ids: stage.ids,
            digest: stage.digest,
            method: stage.method,
            body: intent.body,
            changed: stage.changed,
          })
        ) !== key
      )
        throw Error("Pending workout editor intent could not be verified.");
      // New external identity proves a lost POST created this exact record.
      // Existing-record private-only edits have no native proof and cannot be
      // acknowledged from an unchanged description after a failed request.
      if (
        stage.method === "POST" &&
        (!intent.body.external_id || intent.body.external_id !== value.external_id) &&
        !(
          info.kind === "workouts" &&
          intent.body.tags?.some(
            (tag) => /^training-agent-event-\d+$/.test(tag) && value.tags?.includes(tag)
          )
        )
      )
        continue;
      const native = cleanRow(value);
      // Older creates incorrectly included ICU's recalculated intensity as an
      // authored field. Recover only those lost POST acknowledgements, with the
      // immutable private IF and parsed prescription independently verified.
      // Existing-record/private-only updates still require their original proof.
      let legacyDerivedIntensity = false;
      if (
        stage.method === "POST" &&
        info.kind === "events" &&
        /^training-agent:editor:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          intent.body.external_id || ""
        ) &&
        Object.hasOwn(intent.body, "icu_intensity")
      ) {
        const saved = await textRecord(stage.digest);
        if (
          typeof saved?.text !== "string" ||
          hash(saved.text) !== stage.digest ||
          providerWorkoutDescription(saved.text) !== intent.body.description
        )
          throw Error("Pending workout editor data could not be verified.");
        const values = readPlannedValues(saved.text),
          model = readEditorModel(saved.text);
        legacyDerivedIntensity = Boolean(
          Object.hasOwn(values, "intensity_factor") &&
          same(
            intent.body.icu_intensity,
            values.intensity_factor == null ? null : values.intensity_factor * 100
          ) &&
          model &&
          !verifyParsedWorkout(model, value).length
        );
      }
      if (
        !Object.entries(intent.body).every(
          ([field, expected]) =>
            (field === "icu_intensity" && legacyDerivedIntensity) || same(native[field], expected)
        )
      )
        continue;
      matches.push({ ...stage, key });
    }
    if (matches.length > 1)
      throw Error(
        "Multiple pending workout editor intents match. Recheck the original draft before editing."
      );
    if (matches.length) {
      await commit(matches);
      return index();
    }
    return state;
  }
  async function textRecord(digest) {
    if (!texts.has(digest)) {
      texts.set(
        digest,
        record(`text:${digest}`, () => ({ text: null }))
          .read()
          .catch((error) => {
            texts.delete(digest);
            throw error;
          })
      );
    }
    return texts.get(digest);
  }
  async function hydrate(value, info, state) {
    if (
      !value ||
      !Object.hasOwn(value, "description") ||
      (value.description != null && typeof value.description !== "string")
    )
      return value;
    const original = value.description ?? "";
    const clean = providerWorkoutDescription(value.description);
    // Legacy provider records already carry all their data. Reads never migrate
    // or rewrite them; their next explicit save cleans the provider text.
    if (clean !== original) return value;
    state = await recover(value, info, state);
    const digest = hash(clean);
    const histories = identities(info.kind, value, info.id).map((id) => state.entries[id]);
    const exact = histories.map((versions) => versions?.[digest]).find(Boolean);
    const recent = histories.find((versions) => versions && Object.keys(versions).length);
    const [source, pointer] = exact ? [digest, exact] : Object.entries(recent || {}).at(-1) || [];
    if (!pointer) return value;
    const saved = await textRecord(pointer);
    if (
      typeof saved.text !== "string" ||
      hash(saved.text) !== pointer ||
      hash(providerWorkoutDescription(saved.text)) !== source
    )
      throw Error(
        "Workout editor data could not be verified. Reload before saving; your draft is retained."
      );
    if (exact) return { ...value, description: saved.text };
    // Prose can be changed in ICU without losing comments, planned fields, or
    // the exact editor grouping of an unchanged prescription. Never reattach
    // a stale model after native steps change (including a cleared workout).
    const marker = "\n\nIntervals.icu device definition:\n";
    const native = (text) => (text.includes(marker) ? text.slice(text.indexOf(marker)) : null);
    const sameNative =
      native(clean) !== null && native(clean) === native(providerWorkoutDescription(saved.text));
    const savedModel = readEditorModel(saved.text);
    const sameUnstructured =
      (savedModel?.unstructured === true || savedModel?.strength) &&
      native(clean) === null &&
      !verifyParsedWorkout(savedModel, value).length;
    const blocks = [...saved.text.matchAll(envelopes)]
      .map(([block]) => block)
      .filter(
        (block) =>
          sameNative || sameUnstructured || !/^\r?\n\r?\n```\r?\nWorkout editor v1\r?\n/.test(block)
      );
    return { ...value, description: clean + blocks.join("") };
  }
  return {
    wrap(request) {
      return async (pathname, options = {}) => {
        const info = resource(pathname);
        if (!info) return request(pathname, options);
        const method = (options.method || "GET").toUpperCase();
        const stages = [];
        let outgoing = options;
        if (["POST", "PUT", "PATCH"].includes(method) && typeof options.body === "string") {
          const body = JSON.parse(options.body);
          const rows = Array.isArray(body) ? body : [body];
          for (const row of rows) {
            if (!row || typeof row.description !== "string") continue;
            const clean = providerWorkoutDescription(row.description);
            if (clean.length > 30000)
              throw Object.assign(
                Error(
                  "Workout text exceeds the 30,000 character provider limit. Your draft is retained."
                ),
                { status: 400, code: "WORKOUT_TEXT_LIMIT" }
              );
            if (clean === row.description) continue;
            const ids = identities(info.kind, row, info.id);
            if (!ids.length)
              throw Error("A stable workout identity is required to save editor data safely.");
            const digest = hash(row.description),
              visible = hash(clean);
            // Persist before touching the provider. A lost HTTP response can
            // then be reconciled by an independent GET, even after a restart.
            await record(`text:${digest}`, () => ({ text: null })).update((state) => {
              state.text = row.description;
            });
            texts.delete(digest);
            row.description = clean;
            const body = structuredClone(row),
              before = ids.map((id) => observed.get(id)).find(Boolean);
            const changed = Boolean(
              before &&
              Object.entries(body).some(
                ([field, expected]) =>
                  Object.hasOwn(before, field) && !same(before[field], expected)
              )
            );
            const key = hash(JSON.stringify({ ids, digest, method, body, changed }));
            await record(`intent:${key}`, () => ({ body: null })).update((state) => {
              state.body = body;
            });
            stages.push({ key, ids, digest, visible, method, changed });
          }
          if (stages.length) {
            await update((state) => {
              state.pending ??= {};
              if (
                typeof state.pending !== "object" ||
                Array.isArray(state.pending) ||
                Object.keys(state.pending).length +
                  stages.filter((stage) => !state.pending[stage.key]).length >
                  1024
              )
                throw Error(
                  "Too many pending workout editor saves. Recheck earlier drafts before editing."
                );
              for (const stage of stages) state.pending[stage.key] = stage;
            });
            outgoing = { ...options, body: JSON.stringify(body) };
          }
        }
        let result;
        try {
          result = await request(pathname, outgoing);
        } catch (error) {
          // Prepared intents are never committed pointers. Failure to clean up
          // after a definite rejection must not swallow its status or publish
          // private-only metadata on an unchanged native record.
          if (stages.length && error.status >= 400 && error.status < 500) {
            try {
              await update((state) => {
                for (const stage of stages)
                  if (state.pending?.[stage.key]?.digest === stage.digest)
                    delete state.pending[stage.key];
              });
            } catch {
              /* Keep the original provider rejection authoritative. */
            }
          }
          throw error;
        }
        await commit(stages);
        const rows = Array.isArray(result) ? result : [result];
        for (const row of rows)
          if (row && typeof row === "object" && !Array.isArray(row))
            for (const id of identities(info.kind, row, info.id)) {
              observed.set(id, cleanRow(row));
              if (observed.size > 512) observed.delete(observed.keys().next().value);
            }
        if (
          !rows.some(
            (row) =>
              row &&
              Object.hasOwn(row, "description") &&
              (row.description == null || typeof row.description === "string")
          )
        )
          return result;
        if (!readable && !stages.length) return result;
        let state;
        try {
          state = await index();
        } catch (error) {
          if (info.kind !== "workouts" || !Array.isArray(result) || method !== "GET") throw error;
          // One unavailable sidecar must not hide unrelated native templates.
          // Known app identities stay visible but explicitly cannot schedule.
          return rows.map((row) =>
            row &&
            Array.isArray(row.tags) &&
            row.tags.some((tag) => /^training-agent-(?:event-\d+|template-[a-f0-9]{64})$/.test(tag))
              ? {
                  ...row,
                  structure_read_only: true,
                  workout_metadata_error: "Private template metadata is unavailable.",
                }
              : row
          );
        }
        // Bound individual record reads when loading a long calendar range.
        const hydrated = [];
        for (let start = 0; start < rows.length; start += 8)
          hydrated.push(
            ...(await Promise.all(
              rows.slice(start, start + 8).map(async (row) => {
                try {
                  return await hydrate(row, info, state);
                } catch (error) {
                  if (info.kind !== "workouts" || !Array.isArray(result) || method !== "GET")
                    throw error;
                  return {
                    ...row,
                    structure_read_only: true,
                    workout_metadata_error: "Private template metadata is unavailable.",
                  };
                }
              })
            ))
          );
        return Array.isArray(result) ? hydrated : hydrated[0];
      };
    },
  };
}

export function intervalsWorkoutMetadata(config, fetchImpl = fetch) {
  const connection = hash(
    `${config.SETTINGS_SCOPE || "default"}:${config.INTERVALS_API_KEY || ""}`
  );
  return createProviderWorkoutMetadata({
    readable: Boolean(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY),
    record: (key, fresh) =>
      createEncryptedRecordStore(
        config,
        `${connection}/${key}`,
        {
          namespace: "workout-editor-data",
          name: "WORKOUT_EDITOR_DATA",
          fresh,
          timestampCas: true,
        },
        fetchImpl
      ),
  });
}
