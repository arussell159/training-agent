import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 10;
export const ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;
const types = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  gpx: "application/gpx+xml",
  tcx: "application/xml",
  fit: "application/octet-stream",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const fail = (message, status = 400, code = "INVALID_PERSONAL_FIELDS") => {
  throw Object.assign(new Error(message), { status, code });
};
export function personalWorkoutId(value) {
  if (
    typeof value !== "string" ||
    !/^(?:event:[1-9]\d*|activity:[a-zA-Z0-9_-]{1,80}|draft:[a-zA-Z0-9-]{16,80})$/.test(value)
  )
    fail("Invalid workout identifier.");
  return value;
}
export const freshWorkoutPersonal = () => ({
  revision: 0,
  fields: { privateNotes: "", tags: [], equipment: "", autoCalculate: true },
  attachments: [],
  pendingDeletes: [],
  attachmentGenerations: {},
  updatedAt: null,
});
export function validateWorkoutPersonal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Enter personal workout fields.");
  if (
    Object.keys(value).some(
      (key) => !["privateNotes", "tags", "equipment", "autoCalculate"].includes(key)
    )
  )
    fail("Unsupported personal workout field.");
  if (typeof value.privateNotes !== "string" || value.privateNotes.length > 2000)
    fail("Private notes must be 2,000 characters or fewer.");
  if (
    !Array.isArray(value.tags) ||
    value.tags.length > 30 ||
    value.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 60)
  )
    fail("Use up to 30 tags of 60 characters or fewer.");
  if (typeof value.equipment !== "string" || value.equipment.length > 100)
    fail("Equipment names must be 100 characters or fewer.");
  if (typeof value.autoCalculate !== "boolean") fail("Choose whether to calculate planned values.");
  return {
    privateNotes: value.privateNotes,
    tags: [...new Set(value.tags.map((tag) => tag.trim()))],
    equipment: value.equipment.trim(),
    autoCalculate: value.autoCalculate,
  };
}
export function validateWorkoutAttachment(input) {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 180 ||
    /[\\/]/.test(input.name) ||
    [...input.name].some((char) => char.charCodeAt(0) < 32)
  )
    fail("Choose a valid attachment filename.");
  const extension = input.name.toLowerCase().split(".").pop(),
    type = types[extension];
  if (!type)
    fail(
      "Supported attachments: PDF, PNG, JPG, WebP, text, CSV, JSON, GPX, TCX, FIT, DOCX and XLSX."
    );
  if (
    typeof input.data !== "string" ||
    input.data.length > Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4 ||
    input.data.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)
  )
    fail("Attachment data is invalid or exceeds 2 MB.", 413, "ATTACHMENT_TOO_LARGE");
  const bytes = Buffer.from(input.data, "base64");
  if (
    !bytes.length ||
    bytes.length > ATTACHMENT_MAX_BYTES ||
    bytes.toString("base64") !== input.data
  )
    fail("Choose a nonempty attachment up to 2 MB.", 413, "ATTACHMENT_TOO_LARGE");
  return {
    name: input.name,
    type,
    size: bytes.length,
    data: input.data,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function createWorkoutPersonalService({
  record,
  authorizeWorkout = async () => {},
  now = () => new Date().toISOString(),
}) {
  const workout = (id) => record(`workout/${personalWorkoutId(id)}`, freshWorkoutPersonal);
  const blob = (id) => record(`attachment/${id}`, () => ({ deleted: true }));
  const equipment = () => record("equipment", () => ({ names: [] }));
  const publicState = (state) => ({
    value: state.fields,
    revision: state.revision,
    attachments: state.attachments.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      size: item.size,
      createdAt: item.createdAt,
    })),
    updatedAt: state.updatedAt,
    exists: state.revision > 0,
    ...(state.migratedTo ? { migratedTo: state.migratedTo } : {}),
  });
  async function authorize(id) {
    personalWorkoutId(id);
    if (!id.startsWith("draft:")) await authorizeWorkout(id);
  }
  async function read(id) {
    await authorize(id);
    let [state, options] = await Promise.all([
      workout(id).read(),
      equipment()
        .read()
        .catch(() => ({ names: [] })),
    ]);
    if (state.pendingDeletes?.length) {
      for (const attachmentId of state.pendingDeletes)
        await clearAttachmentBlob(id, attachmentId).catch(() => {});
      state = await workout(id).read();
    }
    return { ...publicState(state), equipmentOptions: options.names || [] };
  }
  async function save(id, input) {
    await authorize(id);
    const value = validateWorkoutPersonal(input?.value);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0)
      fail("Reload personal fields before saving.", 409, "PERSONAL_CONFLICT");
    let source;
    if (input.migrateFrom) {
      personalWorkoutId(input.migrateFrom);
      if (!input.migrateFrom.startsWith("draft:") || id.startsWith("draft:"))
        fail("Personal drafts can only be attached to a saved workout.");
      source = await workout(input.migrateFrom).update((state) => {
        if (
          (state.migratedTo && state.migratedTo !== id) ||
          (state.migrationTarget && state.migrationTarget !== id)
        )
          fail(
            "This personal draft is already attached to another workout.",
            409,
            "PERSONAL_CONFLICT"
          );
        state.migrationTarget = id;
        return JSON.parse(JSON.stringify(state));
      });
    }
    const changedAt = now();
    const result = await workout(id).update((state) => {
      if (state.migratedTo || state.migrationTarget)
        fail(
          "This draft is being saved. Open the saved workout to edit its personal fields.",
          409,
          "PERSONAL_DRAFT_MOVED"
        );
      if (input.importOnly && state.revision > 0) return publicState(state);
      // A timed-out retry with the exact desired state is already confirmed.
      if (
        state.revision !== input.revision &&
        JSON.stringify(state.fields) !== JSON.stringify(value)
      )
        fail(
          "Personal fields changed on another device. Reload before saving; your draft is retained.",
          409,
          "PERSONAL_CONFLICT"
        );
      const attachments = [...state.attachments];
      for (const item of source?.attachments || [])
        if (!attachments.some((existing) => existing.id === item.id)) attachments.push(item);
      if (
        attachments.length > ATTACHMENT_MAX_COUNT ||
        attachments.reduce((sum, item) => sum + item.size, 0) > ATTACHMENT_TOTAL_BYTES
      )
        fail("This workout has reached its attachment limit.");
      state.fields = value;
      state.attachments = attachments;
      state.revision++;
      state.updatedAt = changedAt;
      return publicState(state);
    });
    if (source)
      await workout(input.migrateFrom).update((state) => {
        state.migratedTo = id;
      });
    if (value.equipment)
      await equipment()
        .update((state) => {
          state.names = [...new Set([value.equipment, ...(state.names || [])])].slice(0, 100);
        })
        .catch(() => {});
    return result;
  }
  async function upload(id, input) {
    await authorize(id);
    const file = validateWorkoutAttachment(input);
    const current = await workout(id).read();
    if (current.migratedTo || current.migrationTarget)
      fail(
        "This draft is being saved. Attach files to the saved workout.",
        409,
        "PERSONAL_DRAFT_MOVED"
      );
    const sourceKey = createHash("sha256")
      .update(`${id}\0${file.name}\0${file.digest}`)
      .digest("hex");
    const generation = current.attachmentGenerations?.[sourceKey] || 0;
    const attachmentId = createHash("sha256").update(`${sourceKey}:${generation}`).digest("hex");
    const item = {
      id: attachmentId,
      sourceKey,
      name: file.name,
      type: file.type,
      size: file.size,
      createdAt: now(),
    };
    if (
      !current.attachments.some((existing) => existing.id === attachmentId) &&
      (current.attachments.length >= ATTACHMENT_MAX_COUNT ||
        current.attachments.reduce((sum, existing) => sum + existing.size, 0) + file.size >
          ATTACHMENT_TOTAL_BYTES)
    )
      fail("Use up to 10 attachments totaling 10 MB per workout.", 413, "ATTACHMENT_LIMIT");
    await blob(attachmentId).update((state) => {
      Object.assign(state, file, { deleted: false });
    });
    return workout(id).update((state) => {
      if (state.migratedTo || state.migrationTarget)
        fail(
          "This draft is being saved. Attach files to the saved workout.",
          409,
          "PERSONAL_DRAFT_MOVED"
        );
      if ((state.attachmentGenerations?.[sourceKey] || 0) !== generation)
        fail(
          "This attachment was removed while uploading. Select the file again.",
          409,
          "ATTACHMENT_CHANGED"
        );
      if (!state.attachments.some((existing) => existing.id === attachmentId)) {
        if (
          state.attachments.length >= ATTACHMENT_MAX_COUNT ||
          state.attachments.reduce((sum, existing) => sum + existing.size, 0) + file.size >
            ATTACHMENT_TOTAL_BYTES
        )
          fail("Use up to 10 attachments totaling 10 MB per workout.", 413, "ATTACHMENT_LIMIT");
        state.attachments.push(item);
        state.revision++;
        state.updatedAt = now();
      }
      return publicState(state);
    });
  }
  async function attachment(id, attachmentId) {
    await authorize(id);
    if (!/^[a-f0-9]{64}$/.test(attachmentId)) fail("Invalid attachment.", 404);
    const state = await workout(id).read();
    if (!state.attachments.some((item) => item.id === attachmentId))
      fail("Attachment not found.", 404);
    const file = await blob(attachmentId).read();
    if (file.deleted || !file.data) fail("Attachment not found.", 404);
    return file;
  }
  async function clearAttachmentBlob(id, attachmentId) {
    await blob(attachmentId).update((state) => {
      for (const key of Object.keys(state)) delete state[key];
      state.deleted = true;
    });
    return workout(id).update((state) => {
      state.pendingDeletes = (state.pendingDeletes || []).filter((item) => item !== attachmentId);
      return publicState(state);
    });
  }
  async function removeAttachment(id, attachmentId) {
    await authorize(id);
    if (!/^[a-f0-9]{64}$/.test(attachmentId)) fail("Invalid attachment.", 404);
    const current = await workout(id).read();
    if (current.migratedTo || current.migrationTarget)
      fail(
        "This draft is being saved. Remove attachments from the saved workout.",
        409,
        "PERSONAL_DRAFT_MOVED"
      );
    if (
      !current.attachments.some((item) => item.id === attachmentId) &&
      !current.pendingDeletes?.includes(attachmentId)
    )
      return publicState(current);
    await workout(id).update((state) => {
      if (state.migratedTo || state.migrationTarget)
        fail(
          "This draft is being saved. Remove attachments from the saved workout.",
          409,
          "PERSONAL_DRAFT_MOVED"
        );
      const removed = state.attachments.find((item) => item.id === attachmentId);
      if (removed?.sourceKey) {
        state.attachmentGenerations ||= {};
        state.attachmentGenerations[removed.sourceKey] =
          (state.attachmentGenerations[removed.sourceKey] || 0) + 1;
      }
      state.attachments = state.attachments.filter((item) => item.id !== attachmentId);
      state.pendingDeletes = [...new Set([...(state.pendingDeletes || []), attachmentId])];
      state.revision++;
      state.updatedAt = now();
    });
    return clearAttachmentBlob(id, attachmentId);
  }
  return { read, save, upload, attachment, removeAttachment };
}
