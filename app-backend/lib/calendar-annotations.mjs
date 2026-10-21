import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { contentFingerprint as hash } from "./content-fingerprint.mjs";
import { mapIntervalsWorkout, assertEditableCalendarEvent } from "./intervals.mjs";
import { athleteLocalDate } from "./athlete-date.mjs";
import {
  annotationDate,
  shiftAnnotationDate,
  validateCalendarAnnotationEntry,
  calendarAnnotationKey,
  annotationNativeProjection,
  annotationInclusiveEnd,
  annotationIsAllDay,
} from "./calendar-annotations-model.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message, status = 502, code = "ANNOTATION_UNCONFIRMED") => {
  throw Object.assign(Error(message), { status, code });
};
const operationId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const hydrationReads = new WeakMap();
const eventNumber = (id) => {
  if (!/^event:[1-9]\d*$/.test(String(id)))
    fail("Choose a valid calendar entry.", 400, "INVALID_ANNOTATION");
  return id.slice(6);
};
const fresh = () => ({
  revision: 0,
  eventId: null,
  entry: null,
  nativeHash: null,
  deleted: false,
  pending: null,
  receipts: [],
});
const sportMap = {
  Run: "Run",
  Bike: "Ride",
  Swim: "Swim",
  Crosstrain: "Workout",
  "Mtn Bike": "MountainBikeRide",
  Strength: "WeightTraining",
  "XC-Ski": "NordicSki",
  Rowing: "Rowing",
  Walk: "Walk",
  Other: "Other",
};
// Current public Event.can_train_sports enum. An unsupported reference sport
// must never silently become an unrelated native restriction.
const allNativeSports = [
  "Ride",
  "Run",
  "Swim",
  "WeightTraining",
  "Hike",
  "Walk",
  "AlpineSki",
  "BackcountrySki",
  "Badminton",
  "Canoeing",
  "Crossfit",
  "EBikeRide",
  "EMountainBikeRide",
  "Elliptical",
  "Golf",
  "GravelRide",
  "TrackRide",
  "Handcycle",
  "HighIntensityIntervalTraining",
  "Hockey",
  "IceSkate",
  "InlineSkate",
  "Kayaking",
  "Kitesurf",
  "MountainBikeRide",
  "Cyclocross",
  "NordicSki",
  "OpenWaterSwim",
  "Padel",
  "Pilates",
  "Pickleball",
  "Racquetball",
  "Rugby",
  "RockClimbing",
  "RollerSki",
  "Rowing",
  "Sail",
  "Skateboard",
  "Snowboard",
  "Snowshoe",
  "Soccer",
  "Squash",
  "StairStepper",
  "StandUpPaddling",
  "Surfing",
  "TableTennis",
  "Tennis",
  "TrailRun",
  "Transition",
  "Velomobile",
  "VirtualRide",
  "VirtualRow",
  "VirtualRun",
  "VirtualSki",
  "WaterSport",
  "Wheelchair",
  "Windsurf",
  "Workout",
  "Yoga",
  "Other",
];
const completeSports = (entry) =>
  entry.kind !== "availability" ||
  entry.mode !== "limited" ||
  entry.sports.every((sport) => sportMap[sport]);
function nativeBody(entry, key) {
  const base = {
    name:
      entry.kind === "goals"
        ? entry.title
        : entry.mode === "limited"
          ? "Limited Availability"
          : "Unavailable",
    category: "NOTE",
    start_date_local: `${entry.date}T00:00:00`,
    end_date_local: `${shiftAnnotationDate(entry.endDate, 1)}T00:00:00`,
    external_id: `training-agent:annotation:${entry.kind}:${key}`,
  };
  if (entry.kind === "goals")
    return {
      ...base,
      description: entry.goals
        .map((goal) => `${goal.completed ? "[x]" : "[ ]"} ${goal.text}`)
        .join("\n"),
    };
  const sports = completeSports(entry)
    ? entry.sports.map((sport) => sportMap[sport])
    : allNativeSports;
  return {
    ...base,
    category: { Injury: "INJURED", Sick: "SICK", Vacation: "HOLIDAY" }[entry.reason] || "NOTE",
    training_availability: entry.mode === "limited" ? "LIMITED" : "UNAVAILABLE",
    can_train_sports: entry.mode === "limited" ? sports : [],
    description: [
      `Availability: ${entry.mode === "limited" ? "Limited" : "Unavailable"}`,
      ...(entry.mode === "limited" ? [`Available sports: ${entry.sports.join(", ")}`] : []),
      `Reason: ${entry.reason}`,
      ...(entry.description ? ["", entry.description] : []),
    ].join("\n"),
  };
}
const sameNative = (event, expected) =>
  Object.entries(expected).every(([key, value]) =>
    key === "can_train_sports"
      ? hash([...(event[key] || [])].sort()) === hash([...value].sort())
      : event[key] === value
  );
function content(event) {
  return {
    description: event.description || "",
    category: event.category,
    external_id: event.external_id,
    ...(event.training_availability
      ? {
          training_availability: event.training_availability,
          can_train_sports: [...(event.can_train_sports || [])].sort(),
        }
      : {}),
  };
}
function checkedEvent(value, id) {
  if (
    !object(value) ||
    !/^[1-9]\d*$/.test(String(value.id || "")) ||
    (id && String(value.id) !== eventNumber(id))
  )
    fail("The provider returned an invalid calendar entry.", 502, "ANNOTATION_PROVIDER_INVALID");
  if (
    (value.description != null && typeof value.description !== "string") ||
    (value.can_train_sports != null &&
      (!Array.isArray(value.can_train_sports) ||
        value.can_train_sports.some((sport) => typeof sport !== "string")))
  )
    fail(
      "The provider returned invalid calendar entry fields.",
      502,
      "ANNOTATION_PROVIDER_INVALID"
    );
  try {
    annotationDate(String(value.start_date_local || "").slice(0, 10));
    if (value.end_date_local) annotationDate(String(value.end_date_local).slice(0, 10));
  } catch {
    fail("The provider returned invalid calendar dates.", 502, "ANNOTATION_PROVIDER_INVALID");
  }
  if (!calendarAnnotationKey(value.external_id))
    fail("This entry is not an app Goals or Availability record.", 403, "ANNOTATION_READ_ONLY");
  return value;
}
function mutationInput(input, action) {
  if (
    !object(input) ||
    !operationId(input.operationId) ||
    Object.keys(input).some(
      (key) => !["operationId", "revision", "entry", "reconcileOnly"].includes(key)
    ) ||
    (input.reconcileOnly != null && typeof input.reconcileOnly !== "boolean")
  )
    fail("Keep a valid calendar save identity.", 400, "INVALID_ANNOTATION");
  if (action !== "create" && !/^[a-f0-9]{64}$/.test(input.revision || ""))
    fail("Reload the calendar entry before saving.", 400, "INVALID_ANNOTATION");
  if (action === "delete" && Object.hasOwn(input, "entry"))
    fail("A delete must not change calendar fields.", 400, "INVALID_ANNOTATION");
  return {
    operationId: input.operationId,
    ...(action !== "create" ? { revision: input.revision } : {}),
    ...(action !== "delete" ? { entry: validateCalendarAnnotationEntry(input.entry) } : {}),
  };
}

export function createCalendarAnnotationsService({
  request,
  record,
  now = () => new Date(),
  hydrationRecord = record,
}) {
  const index = () => record("index", () => ({ byId: {} }));
  const store = (key) => record(`entry:${key}`, fresh);
  async function readState(key, hydration = false) {
    const value = await (hydration ? hydrationRecord(`entry:${key}`, fresh) : store(key)).read();
    try {
      if (
        !object(value) ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        typeof value.deleted !== "boolean" ||
        !Array.isArray(value.receipts) ||
        value.receipts.length > 64 ||
        (value.eventId !== null && !/^[1-9]\d*$/.test(value.eventId))
      )
        throw Error();
      if (value.entry !== null) validateCalendarAnnotationEntry(value.entry);
      if (value.nativeHash !== null && !/^[a-f0-9]{64}$/.test(value.nativeHash)) throw Error();
      if (value.entry !== null && (!value.eventId || !value.nativeHash)) throw Error();
      if (new Set(value.receipts.map((receipt) => receipt?.id)).size !== value.receipts.length)
        throw Error();
      for (const receipt of value.receipts)
        if (
          !object(receipt) ||
          !operationId(receipt.id) ||
          !/^[a-f0-9]{64}$/.test(receipt.fingerprint || "") ||
          !["create", "update", "delete"].includes(receipt.action)
        )
          throw Error();
      if (value.pending !== null) {
        const pending = value.pending;
        if (
          !object(pending) ||
          !operationId(pending.id) ||
          !["create", "update", "delete"].includes(pending.action) ||
          typeof pending.attempted !== "boolean" ||
          !/^[a-f0-9]{64}$/.test(pending.fingerprint || "") ||
          !object(pending.input) ||
          hash(mutationInput(pending.input, pending.action)) !== pending.fingerprint
        )
          throw Error();
        if (
          hash(pending.expected) !==
          hash(
            pending.action === "delete"
              ? {}
              : nativeBody(validateCalendarAnnotationEntry(pending.input.entry), key)
          )
        )
          throw Error();
      }
    } catch {
      fail(
        "Saved calendar entry metadata could not be verified.",
        502,
        "ANNOTATION_STORAGE_INVALID"
      );
    }
    return value;
  }
  async function remember(id, key) {
    await index().update((state) => {
      if (!object(state.byId) || Object.keys(state.byId).length > 20000)
        fail(
          "Saved calendar entry index could not be verified.",
          502,
          "ANNOTATION_STORAGE_INVALID"
        );
      if (state.byId[id] && state.byId[id] !== key)
        fail("Calendar identity changed unexpectedly.", 409, "ANNOTATION_CONFLICT");
      if (!state.byId[id] && Object.keys(state.byId).length >= 20000)
        fail(
          "The saved calendar entry index has reached its limit.",
          413,
          "ANNOTATION_INDEX_LIMIT"
        );
      state.byId[id] = key;
    });
  }
  async function lookup(id) {
    const value = await index().read(),
      key = value?.byId?.[id];
    if (
      !object(value?.byId) ||
      Object.keys(value.byId).length > 20000 ||
      (key != null && !operationId(key))
    )
      fail("Saved calendar entry index could not be verified.", 502, "ANNOTATION_STORAGE_INVALID");
    return key;
  }
  async function native(id, missing = false) {
    try {
      return checkedEvent(await request(`/athlete/0/events/${eventNumber(id)}`), id);
    } catch (error) {
      if (missing && error.status === 404) return null;
      throw error;
    }
  }
  function row(event, state) {
    const entry = state.entry || state.pending?.input.entry;
    if (!entry || state.deleted)
      fail("This saved calendar entry is unavailable.", 404, "ANNOTATION_NOT_FOUND");
    const date = annotationDate(String(event.start_date_local).slice(0, 10));
    const endDate = annotationInclusiveEnd(event);
    if (endDate < date || (entry.kind === "goals" && endDate !== date))
      fail(
        "The provider calendar dates no longer match this entry.",
        409,
        "ANNOTATION_PROVIDER_CHANGED"
      );
    const validTitle =
      typeof event.name === "string" &&
      (entry.kind !== "goals" || event.name.length <= 150) &&
      !event.name.includes("\0");
    const metadataCurrent =
      validTitle &&
      annotationIsAllDay(event) &&
      hash(content(event)) === (state.nativeHash || hash(content(state.pending.expected)));
    let editable = metadataCurrent && !state.pending;
    try {
      assertEditableCalendarEvent(event);
    } catch {
      editable = false;
    }
    return {
      ...entry,
      id: `event:${event.id}`,
      creationId: calendarAnnotationKey(event.external_id),
      date,
      endDate,
      title: event.name || (entry.kind === "goals" ? "Goals" : "Availability"),
      revision: hash([annotationNativeProjection(event), state.revision, state.entry]),
      metadataCurrent,
      editable,
      nativeSportsComplete: completeSports(entry),
      ...(!completeSports(entry)
        ? {
            nativeWarning:
              "Brick and Custom availability is preserved in this app. Intervals.icu receives Limited availability with all native sports allowed; it cannot enforce those exact sport selections.",
          }
        : {}),
      ...(!metadataCurrent
        ? {
            providerDescription: event.description || "",
            nativeWarning: !validTitle
              ? "The native title is outside this editor's supported bounds. Review it in Intervals.icu before editing here."
              : !annotationIsAllDay(event)
                ? "The native entry now has a time. Review it in Intervals.icu; this editor supports all-day entries."
                : "The native calendar content changed outside this app. Review it in Intervals.icu before editing this checklist or availability.",
          }
        : {}),
    };
  }
  function result(event, state, replayed = false) {
    const annotation = row(event, state),
      workout = mapIntervalsWorkout(event, athleteLocalDate(now(), "America/Chicago"));
    return {
      annotation,
      workoutId: annotation.id,
      workout: { ...workout, calendar_annotation: annotation },
      event,
      verified: true,
      ...(replayed ? { replayed: true } : {}),
    };
  }
  async function finish(key, pending, event) {
    try {
      if (event) await remember(`event:${event.id}`, key);
      await store(key).update((state) => {
        if (
          state.receipts.some(
            (receipt) => receipt.id === pending.id && receipt.fingerprint === pending.fingerprint
          )
        )
          return;
        if (state.pending?.id !== pending.id || state.pending.fingerprint !== pending.fingerprint)
          fail("Calendar entry changed during save.", 409, "ANNOTATION_CONFLICT");
        state.revision++;
        state.deleted = pending.action === "delete";
        if (event) {
          state.entry = pending.input.entry;
          state.eventId = String(event.id);
          state.nativeHash = hash(content(event));
        }
        state.pending = null;
        state.receipts = [
          ...state.receipts,
          { id: pending.id, fingerprint: pending.fingerprint, action: pending.action },
        ].slice(-64);
      });
    } catch (error) {
      if (error.code) throw error;
      fail(
        "The native save was checked but private metadata is unconfirmed. Recheck this same draft."
      );
    }
    return event
      ? result(event, await readState(key))
      : {
          id: `event:${(await readState(key)).eventId}`,
          workoutId: `event:${(await readState(key)).eventId}`,
          deleted: true,
          verified: true,
        };
  }
  async function find(key, date) {
    const values = await request(`/athlete/0/events?oldest=${date}&newest=${date}`);
    if (!Array.isArray(values))
      fail("The provider returned an invalid calendar list.", 502, "ANNOTATION_PROVIDER_INVALID");
    const matches = values.filter((value) => calendarAnnotationKey(value?.external_id) === key);
    if (matches.length > 1)
      fail(
        "Multiple native entries match this save. Review the calendar before continuing.",
        409,
        "ANNOTATION_CONFLICT"
      );
    return matches.length ? native(`event:${matches[0].id}`) : null;
  }
  async function mutate(id, raw, action) {
    const input = mutationInput(raw, action),
      fingerprint = hash(input);
    let event = action === "create" ? null : await native(id, action === "delete");
    const key =
      action === "create"
        ? input.operationId
        : event
          ? calendarAnnotationKey(event.external_id)
          : await lookup(id);
    if (!key) fail("This calendar entry is not available.", 404, "ANNOTATION_NOT_FOUND");
    let state = await readState(key);
    const receipt = state.receipts.find((receipt) => receipt.id === input.operationId);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint || receipt.action !== action)
        fail(
          "This save identity belongs to different changes.",
          409,
          "ANNOTATION_OPERATION_REUSED"
        );
      if (action === "delete") {
        if (event)
          fail(
            "The deleted entry exists again. Reload before changing it.",
            409,
            "ANNOTATION_CONFLICT"
          );
        return { id, workoutId: id, deleted: true, verified: true, replayed: true };
      }
      event ||= await native(`event:${state.eventId}`);
      if (
        !sameNative(event, nativeBody(input.entry, key)) ||
        hash(state.entry) !== hash(input.entry)
      )
        fail(
          "This save was confirmed earlier, but the entry has since changed. Reload before continuing with this draft.",
          409,
          "ANNOTATION_REPLAY_CHANGED"
        );
      return result(event, state, true);
    }
    let pending = state.pending;
    if (
      pending &&
      (pending.id !== input.operationId ||
        pending.fingerprint !== fingerprint ||
        pending.action !== action)
    )
      fail(
        "Another calendar save is awaiting confirmation. Recheck its original draft.",
        409,
        "ANNOTATION_WRITE_BUSY"
      );
    if (action === "create")
      event = state.eventId
        ? await native(`event:${state.eventId}`, true)
        : await find(key, input.entry.date);
    if (pending && (action === "delete" ? !event : event && sameNative(event, pending.expected)))
      return finish(key, pending, event);
    if (pending?.attempted || raw.reconcileOnly)
      fail(
        "This save is not confirmed yet. Recheck the unchanged draft; no duplicate write was sent."
      );
    if (!pending) {
      if (action === "create" && (event || state.entry || state.deleted))
        fail("This creation identity is already in use.", 409, "ANNOTATION_OPERATION_REUSED");
      if (action !== "create") {
        if (!event)
          fail(
            "The calendar entry no longer exists. Reload before changing it.",
            409,
            "ANNOTATION_CONFLICT"
          );
        assertEditableCalendarEvent(event);
        const current = row(event, state);
        if (current.revision !== input.revision)
          fail(
            "This calendar entry changed elsewhere. Reload before saving your draft.",
            409,
            "ANNOTATION_CONFLICT"
          );
        if (action === "update" && (!current.metadataCurrent || input.entry.kind !== current.kind))
          fail(
            "The native content changed or the entry kind differs. Review it before editing.",
            409,
            "ANNOTATION_PROVIDER_CHANGED"
          );
      }
      pending = {
        id: input.operationId,
        fingerprint,
        action,
        input,
        attempted: false,
        expected: action === "delete" ? {} : nativeBody(input.entry, key),
      };
      await store(key).update((current) => {
        if (current.revision !== state.revision || current.pending)
          fail("Another calendar edit started.", 409, "ANNOTATION_WRITE_BUSY");
        current.pending = pending;
        if (event) current.eventId = String(event.id);
      });
    }
    const claimed = await store(key).update((current) => {
      if (
        current.pending?.id !== pending.id ||
        current.pending.fingerprint !== fingerprint ||
        current.pending.attempted
      )
        return false;
      current.pending.attempted = true;
      return true;
    });
    if (!claimed) fail("Another request is confirming this same save. Recheck shortly.");
    const path = action === "create" ? "/athlete/0/events" : `/athlete/0/events/${eventNumber(id)}`;
    const patch =
      action === "delete"
        ? null
        : action === "create"
          ? pending.expected
          : Object.fromEntries(
              Object.entries(pending.expected).filter(
                ([key, value]) => !sameNative(event, { [key]: value })
              )
            );
    let response;
    try {
      if (action === "delete" || Object.keys(patch).length)
        response = await request(path, {
          method: action === "create" ? "POST" : action === "delete" ? "DELETE" : "PUT",
          ...(patch ? { body: JSON.stringify(patch) } : {}),
        });
    } catch (error) {
      if ([400, 401, 403, 422].includes(error.status)) {
        await store(key).update((current) => {
          if (current.pending?.id === pending.id) current.pending = null;
        });
        throw error;
      }
      // Readback reconciles ambiguous transport errors; an attempted POST/PUT
      // is never blindly repeated, even after process restart.
    }
    let verified;
    try {
      verified =
        action === "create"
          ? response?.id
            ? await native(`event:${response.id}`)
            : await find(key, input.entry.date)
          : await native(id, action === "delete");
    } catch {
      fail("The calendar save could not be confirmed. Keep the draft and recheck this save.");
    }
    if (
      action === "delete" ? verified !== null : !verified || !sameNative(verified, pending.expected)
    )
      fail(
        "The provider did not confirm the expected calendar entry. Keep this draft and recheck."
      );
    return finish(key, pending, verified);
  }
  async function load(id) {
    const event = await native(id),
      key = calendarAnnotationKey(event.external_id);
    let state = await readState(key);
    if (
      state.pending &&
      state.pending.action !== "delete" &&
      sameNative(event, state.pending.expected)
    ) {
      await finish(key, state.pending, event);
      state = await readState(key);
    }
    return row(event, state);
  }
  async function list(start, end) {
    annotationDate(start);
    annotationDate(end);
    if (end < start || Date.parse(end) - Date.parse(start) > 370 * 86400000)
      fail("Choose a calendar range of 371 days or fewer.", 400, "INVALID_ANNOTATION");
    const values = await request(`/athlete/0/events?oldest=${start}&newest=${end}`);
    if (!Array.isArray(values))
      fail("The provider returned an invalid calendar list.", 502, "ANNOTATION_PROVIDER_INVALID");
    const rows = values.filter((event) => calendarAnnotationKey(event?.external_id));
    const annotations = [];
    for (let i = 0; i < rows.length; i += 8)
      annotations.push(
        ...(await Promise.all(
          rows
            .slice(i, i + 8)
            .map(async (event) =>
              row(checkedEvent(event), await readState(calendarAnnotationKey(event.external_id)))
            )
        ))
      );
    return { annotations };
  }
  async function hydrateContext(context) {
    const unique = new Map(
      [...(context.history || []), ...(context.planned || []), ...(context.workouts || [])].map(
        (workout) => [workout.id, workout]
      )
    );
    const candidates = [...unique.values()].filter(
      (workout) => workout.calendar_annotation_key && workout.calendar_annotation_source
    );
    for (let i = 0; i < candidates.length; i += 8)
      await Promise.all(
        candidates.slice(i, i + 8).map(async (workout) => {
          try {
            const event = checkedEvent(workout.calendar_annotation_source, workout.id),
              key = calendarAnnotationKey(event.external_id);
            if (key !== workout.calendar_annotation_key)
              fail(
                "Saved annotation identity differs from its calendar entry.",
                502,
                "ANNOTATION_STORAGE_INVALID"
              );
            const state = await readState(key, true);
            const { calendar_annotation_error, ...plain } = workout;
            unique.set(workout.id, { ...plain, calendar_annotation: row(event, state) });
          } catch {
            const { calendar_annotation, ...plain } = workout;
            unique.set(workout.id, {
              ...plain,
              calendar_annotation_error:
                "Saved Goals or Availability details are unavailable. Open this entry to retry; native calendar content is retained.",
            });
          }
        })
      );
    const apply = (values) => (values || []).map((workout) => unique.get(workout.id) || workout);
    return {
      ...context,
      history: apply(context.history),
      planned: apply(context.planned),
      ...(context.workouts ? { workouts: apply(context.workouts) } : {}),
    };
  }
  return {
    load,
    list,
    create: (input) => mutate(null, input, "create"),
    update: (id, input) => mutate(id, input, "update"),
    delete: (id, input) => mutate(id, input, "delete"),
    hydrateContext,
  };
}

export function calendarAnnotationsService(config, request, fetchImpl = fetch) {
  const connection = providerConnection(config);
  const record = (key, initial) =>
    createEncryptedRecordStore(
      config,
      `${connection}:${key}`,
      {
        namespace: "calendar-annotations",
        name: "CALENDAR_ANNOTATIONS",
        fresh: initial,
        timestampCas: true,
      },
      fetchImpl
    );
  const cacheKey = hash([
    connection,
    config.SUPABASE_URL,
    config.SUPABASE_SECRET_KEY,
    config.SETTINGS_ENCRYPTION_KEY,
  ]);
  let scopes = hydrationReads.get(fetchImpl);
  if (!scopes) hydrationReads.set(fetchImpl, (scopes = new Map()));
  const hydrationRecord = (key, initial) => ({
    read: async () => {
      let cache = scopes.get(cacheKey);
      if (!cache) {
        scopes.set(cacheKey, (cache = new Map()));
        if (scopes.size > 32) scopes.delete(scopes.keys().next().value);
      }
      let entry = cache.get(key);
      if (!entry || entry.expires <= Date.now()) {
        const current = { expires: Infinity, promise: null };
        current.promise = record(key, initial)
          .read()
          .then((value) => {
            current.expires = Date.now() + 2000;
            return value;
          })
          .catch((error) => {
            if (cache.get(key) === current) cache.delete(key);
            throw error;
          });
        cache.set(key, (entry = current));
        if (cache.size > 512) cache.delete(cache.keys().next().value);
      }
      return structuredClone(await entry.promise);
    },
  });
  const service = createCalendarAnnotationsService({ request, record, hydrationRecord });
  const write = async (method, args) => {
    scopes.delete(cacheKey);
    try {
      return await service[method](...args);
    } finally {
      scopes.delete(cacheKey);
    }
  };
  return {
    ...service,
    create: (...args) => write("create", args),
    update: (...args) => write("update", args),
    delete: (...args) => write("delete", args),
    hydrateContext: (context) => {
      const owner = context.provider_connection || context.cache_scope;
      return owner && owner !== connection ? context : service.hydrateContext(context);
    },
  };
}
