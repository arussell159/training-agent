import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";

const preview = (options) =>
  createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z")),
    options
  );
const entry = {
  kind: "goals",
  date: "2026-10-31",
  endDate: "2026-10-31",
  title: "October goals",
  goals: [
    { id: "first", text: "Keep a steady effort", completed: true },
    { id: "blank", text: " ", completed: false },
  ],
};

test("disposable annotation routes execute actual service and queue writes, hydrate reloads, and verify deletion independently", async () => {
  const source = preview(),
    input = { operationId: "preview-goals-operation", entry };
  assert.equal(source.canWrite("calendar/annotations", "POST"), true);
  const saved = await source.handle("calendar/annotations", "POST", input);
  assert.equal(saved.annotation.goals.length, 1);
  assert.equal(
    saved.context.planned.find((row) => row.id === saved.workoutId).calendar_annotation.goals[0]
      .completed,
    true
  );
  const route = `calendar/annotations/${encodeURIComponent(saved.workoutId)}`,
    loaded = await source.handle(route, "GET");
  const changed = await source.handle(route, "PUT", {
    operationId: "preview-goals-edit-operation",
    revision: loaded.revision,
    entry: { ...entry, goals: [{ id: "first", text: "Edited goal", completed: false }] },
  });
  const refreshed = await source.handle(
    "training-context",
    "GET",
    {},
    new URL("http://fixture.invalid/api/training-context")
  );
  assert.equal(
    refreshed.planned.find((row) => row.id === saved.workoutId).calendar_annotation.goals[0].text,
    "Edited goal"
  );
  const raw = await source.handle("preview/provider-records", "GET");
  const native = raw.events.find((row) => `event:${row.id}` === saved.workoutId);
  assert.equal(native.description, "[ ] Edited goal");
  assert.equal(native.category, "NOTE");
  assert.ok(!native.description.includes('"goals"'));
  const deleted = await source.handle(route, "DELETE", {
    operationId: "preview-goals-delete-operation",
    revision: changed.annotation.revision,
  });
  assert.equal(deleted.deleted, true);
  assert.equal(
    deleted.context.planned.some((row) => row.id === saved.workoutId),
    false
  );
  assert.equal(
    (await source.handle("preview/provider-records", "GET")).events.some(
      (row) => `event:${row.id}` === saved.workoutId
    ),
    false
  );
});

test("disposable multi-day availability crosses visible month windows with native enforcement and exact local labels", async () => {
  const source = preview(),
    saved = await source.handle("calendar/annotations", "POST", {
      operationId: "preview-availability-operation",
      entry: {
        kind: "availability",
        date: "2026-10-31",
        endDate: "2026-11-02",
        mode: "limited",
        sports: ["Run", "Swim"],
        reason: "Vacation",
        description: "Available in the morning",
      },
    });
  const context = await source.handle(
    "training-context",
    "GET",
    {},
    new URL(
      "http://fixture.invalid/api/training-context?scope=range&start=2026-11-01&end=2026-11-02"
    )
  );
  const row = [...context.history, ...context.planned].find((row) => row.id === saved.workoutId);
  assert.equal(row.calendar_annotation_kind, "availability");
  assert.equal(row.calendar_annotation.endDate, "2026-11-02");
  const raw = (await source.handle("preview/provider-records", "GET")).events.find(
    (row) => `event:${row.id}` === saved.workoutId
  );
  assert.equal(raw.training_availability, "LIMITED");
  assert.deepEqual(raw.can_train_sports, ["Run", "Swim"]);
  assert.equal(raw.end_date_local, "2026-11-03T00:00:00");
  assert.equal(raw.category, "HOLIDAY");
});

test("lost disposable annotation HTTP replies reconcile the same identity without another native POST", async () => {
  const source = preview({ loseAnnotationResponseOnce: true }),
    input = { operationId: "preview-lost-annotation-operation", entry };
  await assert.rejects(
    source.handle("calendar/annotations", "POST", input),
    (error) => error.code === "ANNOTATION_UNCONFIRMED"
  );
  const saved = await source.handle("calendar/annotations", "POST", {
    ...input,
    reconcileOnly: true,
  });
  assert.equal(saved.verified, true);
  assert.equal(saved.annotation.creationId, input.operationId);
  const raw = await source.handle("preview/provider-records", "GET");
  assert.equal(raw.events.filter((row) => row.external_id?.endsWith(input.operationId)).length, 1);
  assert.equal(
    raw.writes.filter(
      (write) => write.method === "POST" && write.body.external_id?.endsWith(input.operationId)
    ).length,
    1
  );
});
