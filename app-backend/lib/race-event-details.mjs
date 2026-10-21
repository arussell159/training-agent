import { createHash } from "node:crypto";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import {
  assertEditableCalendarEvent,
  createIntervalsRaceEvent,
  updateIntervalsRaceEvent,
} from "./intervals.mjs";
import {
  raceEventTypes,
  validateRaceEventDetails,
  emptyRaceGoals,
  raceDetailsDate,
  raceEventKey,
} from "./race-event-details-model.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, status = 502, code, details = {}) => {
  throw Object.assign(Error(message), { status, ...(code ? { code } : {}), ...details });
};
const number = (id) => {
  if (!/^event:[1-9]\d*$/.test(String(id))) fail("Choose a valid event.", 400);
  return id.slice(6);
};
const fresh = () => ({ entry: null, nativeHash: null, pending: null });
const projection = (event) => ({
  id: String(event.id),
  name: event.name,
  type: event.type,
  category: event.category,
  description: event.description || "",
  date: event.start_date_local,
  end: event.end_date_local || null,
});
const metadataProjection = (event) => ({ type: event.type, description: event.description || "" });
const revisionOf = (event, state) => hash([projection(event), state.entry, state.nativeHash]);
const expected = (entry) => ({
  name: entry.name,
  type: raceEventTypes[entry.eventType].sport,
  category: entry.priority ? `RACE_${entry.priority}` : "NOTE",
  description: entry.description,
  date: entry.date,
});
const matches = (event, entry) => {
  const body = expected(entry);
  return Object.entries(body).every(([key, value]) =>
    key === "date"
      ? String(event.start_date_local).slice(0, 10) === value
      : (event[key] || "") === value
  );
};

// Exact event type is app metadata: ICU does not have all the reference type
// categories. Human description alone goes to ICU, never a JSON envelope.
export function createRaceEventDetailsService({ request, record }) {
  const store = (id) => record(`event:${number(id)}`, fresh);
  const index = () => record("index", () => ({ ids: {} }));
  async function native(id) {
    const event = await request(`/athlete/0/events/${number(id)}`);
    if (
      !event ||
      String(event.id) !== number(id) ||
      (!/^RACE(?:_[ABC])?$/.test(event.category || "") && event.category !== "NOTE")
    )
      fail("This calendar entry is not a race event.", 404);
    if (event.category === "NOTE" && !raceEventKey(event.external_id)) {
      const state = await store(id).read();
      if (!state?.entry && !state?.pending) fail("This calendar note is not an app Event.", 404);
    }
    if (
      typeof event.name !== "string" ||
      typeof event.type !== "string" ||
      (event.description != null && typeof event.description !== "string")
    )
      fail("The provider returned malformed event text.");
    try {
      raceDetailsDate(String(event.start_date_local || "").slice(0, 10));
    } catch {
      fail("The provider returned an invalid event date.");
    }
    return event;
  }
  async function finish(event, entry, pendingRevision) {
    await index().update((state) => {
      if (
        !state.ids ||
        typeof state.ids !== "object" ||
        Array.isArray(state.ids) ||
        Object.keys(state.ids).length > 20000
      )
        fail("Saved Event index could not be verified.");
      state.ids[`event:${event.id}`] = true;
    });
    await store(`event:${event.id}`).update((state) => {
      if (
        pendingRevision &&
        (!state.pending ||
          state.pending.revision !== pendingRevision ||
          hash(state.pending.entry) !== hash(entry))
      )
        fail("The event metadata changed during save. Reload before retrying.", 409);
      state.entry = entry;
      state.nativeHash = hash(metadataProjection(event));
      state.pending = null;
    });
    return event;
  }
  async function row(event) {
    const state = await store(`event:${event.id}`).read();
    if (!state || typeof state !== "object" || Array.isArray(state))
      fail("Saved event details could not be verified.");
    if (state.entry)
      try {
        validateRaceEventDetails(state.entry);
      } catch {
        fail("Saved event details could not be verified.");
      }
    // Exact category/goals do not derive from prose. A native prose edit must
    // not erase them or restore the old description. Native sport changes are
    // a different source contract and stay read-only until reconciled.
    const current = state.entry && event.type === raceEventTypes[state.entry.eventType].sport;
    let editable = true;
    try {
      assertEditableCalendarEvent(event);
    } catch {
      editable = false;
    }
    if (state.entry && !current) editable = false;
    const inferredType =
      {
        Run: "RunningOther",
        TrailRun: "RunningTrail",
        Ride: "CyclingOther",
        MountainBikeRide: "CyclingMountain",
        Cyclocross: "CyclingCyclocross",
        TrackRide: "CyclingTrack",
        Swim: "SwimPool",
        OpenWaterSwim: "SwimOpenWater",
        Rowing: "RowingOther",
        AlpineSki: "SnowAlpine",
        NordicSki: "SnowNordic",
        BackcountrySki: "SnowSkiMountaineering",
        Snowshoe: "SnowSnowshoe",
        IceSkate: "OtherSpeedSkate",
      }[event.type] || "OtherOther";
    return {
      raceDistance: "",
      atpEventType: "",
      goals: emptyRaceGoals(),
      ...(current ? state.entry : {}),
      id: `event:${event.id}`,
      name: String(event.name || ""),
      date: String(event.start_date_local).slice(0, 10),
      priority: event.category.match(/^RACE_([ABC])$/)?.[1] || "",
      description: event.description || "",
      eventType: current ? state.entry.eventType : inferredType,
      revision: revisionOf(event, state),
      editable,
      metadataCurrent: Boolean(current),
    };
  }
  async function load(id) {
    return row(await native(id));
  }
  async function create(input) {
    const { creationId, reconcileOnly, ...fields } = input || {};
    if (reconcileOnly !== undefined && typeof reconcileOnly !== "boolean")
      fail("Choose a valid event recheck mode.", 400);
    if (typeof creationId !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(creationId))
      fail("Keep a valid event save identity.", 400);
    const entry = validateRaceEventDetails(fields),
      fingerprint = hash(entry);
    const creation = record(`create:${creationId}`, () => ({
      fingerprint: null,
      entry: null,
      attempted: false,
      eventId: null,
    }));
    let write = false;
    await creation.update((state) => {
      if (state.fingerprint && state.fingerprint !== fingerprint)
        fail(
          "This save identity belongs to another event draft. Reopen the event before changing it.",
          409
        );
      if (!state.fingerprint) {
        state.fingerprint = fingerprint;
        state.entry = entry;
      }
      if (!state.attempted) {
        if (reconcileOnly)
          fail(
            "The event creation has not been confirmed. Rechecking will not send another create.",
            502,
            "EVENT_CREATE_UNCONFIRMED"
          );
        state.attempted = true;
        write = true;
      }
    });
    const receipt = await creation.read();
    if (receipt.eventId) {
      const event = await native(`event:${receipt.eventId}`);
      const state = await store(`event:${receipt.eventId}`).read();
      if (
        !matches(event, entry) ||
        !state?.entry ||
        state.nativeHash !== hash(metadataProjection(event)) ||
        hash(state.entry) !== fingerprint
      )
        fail(
          "This Event changed after the original creation. Reload the current Event before saving; the earlier draft was not reapplied.",
          409,
          "EVENT_REPLAY_CHANGED",
          { eventId: `event:${receipt.eventId}` }
        );
      return { event: await row(event), providerEvent: event, verified: true };
    }
    const externalId = `training-agent-event:${creationId}`;
    let event;
    if (write) {
      try {
        event = await createIntervalsRaceEvent(request, {
          ...entry,
          ...expected(entry),
          externalId,
          allowUnprioritized: true,
        });
      } catch (error) {
        if ([400, 401, 403, 422].includes(error.status)) {
          await creation.update((state) => {
            state.attempted = false;
          });
          throw error;
        }
      }
    }
    if (!event) {
      const values = await request(`/athlete/0/events?oldest=${entry.date}&newest=${entry.date}`);
      const found =
        Array.isArray(values) && values.filter((value) => value.external_id === externalId);
      if (!found || found.length !== 1)
        fail(
          "The event save could not be confirmed. Keep this draft and recheck before creating another event."
        );
      event = await native(`event:${found[0].id}`);
    }
    if (!matches(event, entry)) fail("The provider did not confirm the expected event fields.");
    await finish(event, entry);
    await creation.update((state) => {
      state.eventId = String(event.id);
    });
    return { event: await row(event), providerEvent: event, verified: true };
  }
  async function update(id, input) {
    const { revision, reconcileOnly, ...fields } = input || {},
      entry = validateRaceEventDetails(fields);
    if (reconcileOnly !== undefined && typeof reconcileOnly !== "boolean")
      fail("Choose a valid event recheck mode.", 400);
    if (!/^[a-f0-9]{64}$/.test(revision || "")) fail("Reload the event before saving.", 400);
    const existing = await native(id);
    assertEditableCalendarEvent(existing);
    const state = await store(id).read();
    if (
      !state.pending &&
      state.entry &&
      state.nativeHash === hash(metadataProjection(existing)) &&
      hash(state.entry) === hash(entry) &&
      matches(existing, entry)
    )
      return { event: await row(existing), providerEvent: existing, verified: true };
    if (state.pending && hash(state.pending.entry) === hash(entry) && matches(existing, entry)) {
      await finish(existing, entry, state.pending.revision);
      return { event: await row(existing), providerEvent: existing, verified: true };
    }
    if (state.entry && existing.type !== raceEventTypes[state.entry.eventType]?.sport)
      fail(
        "This Event's sport changed in its source. Reload and review the source Event before editing its saved details.",
        409,
        "EVENT_SOURCE_CHANGED"
      );
    if (revision !== revisionOf(existing, state))
      fail("This event changed elsewhere. Reload it before saving.", 409);
    if (reconcileOnly)
      fail(
        "The event update is not confirmed. Rechecking will not write the event again.",
        502,
        "EVENT_UPDATE_UNCONFIRMED"
      );
    let write = false;
    await store(id).update((current) => {
      if (current.pending)
        fail("An earlier event save needs confirmation. Reload and recheck that draft first.", 409);
      current.pending = { entry, revision };
      write = true;
    });
    let event;
    if (matches(existing, entry)) event = existing;
    if (write && !event)
      try {
        event = await updateIntervalsRaceEvent(request, id, {
          ...entry,
          ...expected(entry),
          allowUnprioritized: true,
          appEvent: true,
        });
      } catch (error) {
        if ([400, 401, 403, 422].includes(error.status)) {
          await store(id).update((current) => {
            current.pending = null;
          });
          throw error;
        }
      }
    if (!event) event = await native(id);
    if (!matches(event, entry))
      fail("The event update could not be confirmed. Keep the draft and recheck this save.");
    await finish(event, entry, revision);
    return { event: await row(event), providerEvent: event, verified: true };
  }
  async function hydrateContext(context) {
    const state = await index().read();
    if (
      !state?.ids ||
      typeof state.ids !== "object" ||
      Array.isArray(state.ids) ||
      Object.keys(state.ids).length > 20000
    )
      fail("Saved Event index could not be verified.");
    const apply = (rows) =>
      (rows || []).map((workout) =>
        state.ids[workout.id] && /^(?:NOTE|RACE_[ABC])$/.test(workout.category || "")
          ? { ...workout, calendar_event_key: workout.calendar_event_key || `stored:${workout.id}` }
          : workout
      );
    return {
      ...context,
      history: apply(context.history),
      planned: apply(context.planned),
      ...(context.workouts ? { workouts: apply(context.workouts) } : {}),
    };
  }
  async function assertNotAppEvent(id) {
    const [indexed, saved] = await Promise.all([index().read(), store(id).read()]);
    if (
      !indexed?.ids ||
      typeof indexed.ids !== "object" ||
      Array.isArray(indexed.ids) ||
      Object.keys(indexed.ids).length > 20000 ||
      !saved ||
      typeof saved !== "object" ||
      Array.isArray(saved)
    )
      fail(
        "Saved Event identity could not be verified. Open the Event editor before changing this note."
      );
    if (indexed.ids[id] || saved.entry || saved.pending)
      fail("Open this Event in its own editor.", 403, "EVENT_NOTE_ROUTE");
  }
  return { load, create, update, hydrateContext, assertNotAppEvent };
}

export function raceEventDetailsService(config, request, fetchImpl = fetch) {
  const connection = providerConnection(config);
  return createRaceEventDetailsService({
    request,
    record: (key, initial) =>
      createEncryptedRecordStore(
        config,
        `${connection}:${key}`,
        {
          namespace: "race-event-details",
          name: "RACE_EVENT_DETAILS",
          fresh: initial,
          timestampCas: true,
        },
        fetchImpl
      ),
  });
}
