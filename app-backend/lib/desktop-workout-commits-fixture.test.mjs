import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
import { createDesktopWorkoutCommits } from "../../tools/desktop-workout-commits-fixture.mjs";

for (const sport of ["run", "bike", "swim"])
  test(`synthetic durable worker ${sport}: duplicate acceptance preserves one native identity and full model`, async () => {
    const calendar = createDesktopCalendarPreview(
      createDesktopPreviewFixtures(new Date("2026-10-21T12:00:00Z"))
    );
    const existing = calendar
      .context()
      .planned.find((row) => row.title === `Editable ${sport} workout`);
    const editor = await calendar.handle(
      `workouts/${existing.id}/editor`,
      "GET",
      {},
      new URL("http://localhost")
    );
    const service = createDesktopWorkoutCommits({ calendar });
    const workoutId = `app:${randomUUID()}`,
      operationId = randomUUID(),
      input = { model: { ...editor.model, name: `Disposable ${sport} commit` } };
    const command = { workoutId, operationId, action: "create", input };
    const accepted = await service.accept(command),
      duplicate = await service.accept(command);
    assert.equal(accepted.syncStatus, "pending");
    assert.equal(duplicate.operationRevision, 1);
    const before = await calendar.handle(
      "preview/provider-records",
      "GET",
      {},
      new URL("http://localhost")
    );
    assert.equal(
      before.events.some(
        (row) => row.external_id === `training-agent:editor:${workoutId.slice(4)}`
      ),
      false
    );
    await Promise.all([service.drain(), service.drain()]);
    const status = (await service.status()).workouts.find((row) => row.workoutId === workoutId);
    assert.equal(status.syncStatus, "synced");
    assert.equal(status.syncedRevision, 1);
    assert.deepEqual(status.model, input.model);
    const after = await calendar.handle(
      "preview/provider-records",
      "GET",
      {},
      new URL("http://localhost")
    );
    const rows = after.events.filter(
      (row) => row.external_id === `training-agent:editor:${workoutId.slice(4)}`
    );
    assert.equal(rows.length, 1);
    assert.equal(status.providerWorkoutId, `event:${rows[0].id}`);
    const reopened = await service.editor(workoutId);
    assert.deepEqual(reopened.model, input.model);
  });
