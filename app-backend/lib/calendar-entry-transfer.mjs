import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { contentFingerprint as hash } from "./content-fingerprint.mjs";
import { calendarAnnotationsService } from "./calendar-annotations.mjs";
import { raceEventDetailsService } from "./race-event-details.mjs";
import {
  validateCalendarEntryTransfer,
  calendarEntryTransferValue,
} from "./calendar-entry-transfer-model.mjs";
const fail = (message, status = 502, code = "ENTRY_TRANSFER_UNCONFIRMED") => {
  throw Object.assign(Error(message), { status, code });
};
const fresh = () => ({ intent: null, attempted: false });
const id = (value) => {
  if (!/^event:[1-9]\d*$/.test(value || ""))
    fail("Choose a saved calendar entry.", 400, "ENTRY_TRANSFER_INVALID");
  return value;
};
export function createCalendarEntryTransferService({ annotations, events, record }) {
  async function transfer(sourceId, raw) {
    id(sourceId);
    const input = validateCalendarEntryTransfer(raw),
      fingerprint = hash({ sourceId, ...input }),
      store = record(input.operationId, fresh);
    let state = await store.read();
    const validate = (state) => {
      try {
        if (
          !state ||
          typeof state !== "object" ||
          Array.isArray(state) ||
          typeof state.attempted !== "boolean"
        )
          throw Error();
        if (state.attempted && !state.intent) throw Error();
        if (state.intent) {
          id(state.intent.sourceId);
          const saved = validateCalendarEntryTransfer(state.intent.input);
          if (
            state.intent.fingerprint !== hash({ sourceId: state.intent.sourceId, ...saved }) ||
            !state.intent.entry ||
            hash(calendarEntryTransferValue(saved.kind, state.intent.entry, saved.date)) !==
              hash(state.intent.entry)
          )
            throw Error();
        }
      } catch {
        fail(
          "Saved transfer intent could not be verified. Keep the original paste identity.",
          502,
          "ENTRY_TRANSFER_STORAGE_INVALID"
        );
      }
      if (state.intent && state.intent.fingerprint !== fingerprint)
        fail(
          "This paste identity belongs to another entry or destination. Recheck its original paste.",
          409,
          "ENTRY_TRANSFER_CONFLICT"
        );
      return state;
    };
    validate(state);
    const service = input.kind === "event" ? events : annotations;
    if (!state.intent) {
      if (raw.reconcileOnly)
        fail(
          "This paste has no confirmed prepared intent. Recheck the original destination before starting another."
        );
      const source = await service.load(sourceId);
      if (source.editable !== true || source.metadataCurrent !== true)
        fail(
          "Reload the authoritative calendar entry before copying or moving it.",
          403,
          "ENTRY_TRANSFER_READ_ONLY"
        );
      if (source.revision !== input.revision)
        fail(
          "This calendar entry changed after selection. Reload before pasting.",
          409,
          "ENTRY_TRANSFER_CONFLICT"
        );
      const intent = {
        sourceId,
        input,
        entry: calendarEntryTransferValue(input.kind, source, input.date, input.action),
        fingerprint,
      };
      await store.update((current) => {
        validate(current);
        if (!current.intent) current.intent = intent;
      });
      state = validate(await store.read());
    }
    let claimed = false;
    if (!raw.reconcileOnly)
      await store.update((current) => {
        validate(current);
        if (!current.intent) fail("The prepared transfer disappeared.");
        if (!current.attempted) {
          current.attempted = true;
          claimed = true;
        }
      });
    const entry = state.intent.entry,
      reconcileOnly = !claimed || raw.reconcileOnly === true;
    const result =
      input.kind === "event"
        ? input.action === "copy"
          ? await service.create({ ...entry, creationId: input.operationId, reconcileOnly })
          : await service.update(sourceId, { ...entry, revision: input.revision, reconcileOnly })
        : input.action === "copy"
          ? await service.create({ entry, operationId: input.operationId, reconcileOnly })
          : await service.update(sourceId, {
              entry,
              revision: input.revision,
              operationId: input.operationId,
              reconcileOnly,
            });
    const row = input.kind === "event" ? result.event : result.annotation;
    if (
      result.verified !== true ||
      !row ||
      row.editable !== true ||
      row.metadataCurrent !== true ||
      !/^event:[1-9]\d*$/.test(row.id) ||
      row.date !== entry.date ||
      (input.kind !== "event" && row.endDate !== entry.endDate) ||
      (input.action === "copy" ? row.id === sourceId : row.id !== sourceId) ||
      hash(calendarEntryTransferValue(input.kind, row, input.date)) !== hash(entry)
    )
      fail(
        "The paste result differs from its retained intent. Recheck before changing this draft."
      );
    return {
      ...result,
      sourceId,
      kind: input.kind,
      action: input.action,
      operationId: input.operationId,
      workoutId: row.id,
    };
  }
  return { transfer };
}
export function calendarEntryTransferService(config, request, fetchImpl = fetch) {
  return createCalendarEntryTransferService({
    annotations: calendarAnnotationsService(config, request, fetchImpl),
    events: raceEventDetailsService(config, request, fetchImpl),
    record: (key, initial) =>
      createEncryptedRecordStore(
        config,
        `${providerConnection(config)}:${key}`,
        {
          namespace: "calendar-entry-transfer",
          name: "CALENDAR_ENTRY_TRANSFER",
          fresh: initial,
          timestampCas: true,
        },
        fetchImpl
      ),
  });
}
