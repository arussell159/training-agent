import test from "node:test"
import assert from "node:assert/strict"
import {
  createStrengthLibraryClient,
  strengthLibraryAttempt,
  readStrengthLibraryPending,
  selectStrengthLibraryExercise,
} from "../src/lib/strength-exercise-library.ts"
import {
  newStrengthExerciseDefinition,
  strengthLibraryExerciseBlock,
} from "../../app-backend/lib/strength-exercise-library-model.mjs"
import {
  copyStrengthPrescription,
  validateStrengthPrescription,
} from "../../app-backend/lib/workout-strength-model.mjs"
const scope = "a".repeat(64),
  revision = "b".repeat(64),
  exerciseId = "exercise:" + "c".repeat(64),
  operationId = "retained-operation-0001"
const definition = () => ({
  ...newStrengthExerciseDefinition(),
  title: "Independent custom lift",
  muscleGroup: "Quads",
  instructions: "Pause, then stand.",
  videoUrl: "https://youtu.be/dQw4w9WgXcQ",
})
const row = (value = definition()) => ({
  ...value,
  id: exerciseId,
  revision: "d".repeat(64),
  accountScope: scope,
  owner: "me",
  editable: true,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
})
const catalog = () => ({
  exercises: [],
  revision,
  accountScope: scope,
  total: 0,
  readOnly: false,
})
const result = (attempt) => ({
  id: exerciseId,
  operationId: attempt.body.operationId,
  accountScope: scope,
  catalogRevision: "e".repeat(64),
  verified: true,
  exercise: row(attempt.body.definition),
})
const store = () => {
  const values = new Map()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

test("immutable account-scoped recovery identity is durably read back before first HTTP and verified full definition readback clears it", async () => {
  const storage = store(),
    attempt = strengthLibraryAttempt(
      catalog(),
      definition(),
      undefined,
      operationId
    ),
    before = structuredClone(attempt),
    requests = []
  assert.equal(
    attempt.id,
    null,
    "New exercise IDs are opaque server-owned identities"
  )
  const client = createStrengthLibraryClient(
    async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) })
      assert.deepEqual(readStrengthLibraryPending(storage, scope), before)
      return response(result(before))
    },
    () => storage
  )
  const pending = client.mutate(attempt)
  attempt.body.definition.title = "Changed caller object"
  const saved = await pending
  assert.equal(saved.exercise.title, before.body.definition.title)
  assert.deepEqual(requests, [
    { path: "/api/strength-exercises", body: before.body },
  ])
  assert.equal(client.pending(scope), null)
})

test("lost response survives new client/remount and only immutable reconcile requests can confirm it without a second create", async () => {
  const storage = store(),
    attempt = strengthLibraryAttempt(
      catalog(),
      definition(),
      undefined,
      operationId
    ),
    requests = []
  const first = createStrengthLibraryClient(
    async (path, options) => {
      requests.push(JSON.parse(options.body))
      throw Error("Reply lost after commit")
    },
    () => storage
  )
  await assert.rejects(first.mutate(attempt), /Reply lost/)
  assert.deepEqual(first.pending(scope), attempt)
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const recovered = createStrengthLibraryClient(
    async (path, options) => {
      requests.push(JSON.parse(options.body))
      await gate
      return response(result(attempt))
    },
    () => storage
  )
  await assert.rejects(recovered.mutate(attempt), /must be rechecked/)
  const recheck = recovered.mutate(recovered.pending(scope), true)
  await assert.rejects(
    recovered.mutate(attempt, true),
    /already being confirmed/
  )
  release()
  await recheck
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1], { ...requests[0], reconcileOnly: true })
  assert.equal(recovered.pending(scope), null)
})

test("malformed successful same-date/name responses cannot acknowledge another account, operation or altered definition", async () => {
  for (const change of [
    (value) => ({ ...value, operationId: "another-operation-0002" }),
    (value) => ({ ...value, accountScope: "f".repeat(64) }),
    (value) => ({
      ...value,
      exercise: { ...value.exercise, instructions: "Different instructions" },
    }),
    (value) => ({
      ...value,
      exercise: {
        ...value.exercise,
        parameters: value.exercise.parameters.map((column, index) =>
          index === 1 ? { ...column, unit: "kg" } : column
        ),
      },
    }),
    (value) => ({ ...value, exercise: { ...value.exercise, videoUrl: "" } }),
    (value) => ({
      ...value,
      exercise: { ...value.exercise, id: "exercise:" + "f".repeat(64) },
    }),
  ]) {
    const storage = store(),
      attempt = strengthLibraryAttempt(
        catalog(),
        definition(),
        undefined,
        operationId
      ),
      client = createStrengthLibraryClient(
        async () => response(change(result(attempt))),
        () => storage
      )
    await assert.rejects(client.mutate(attempt), /could not be verified/)
    assert.deepEqual(client.pending(scope), attempt)
  }
})

test("blocked, corrupt or silently failing recovery storage prevents every first request", async () => {
  let requests = 0
  for (const storage of [
    {
      getItem() {
        throw Error("blocked")
      },
      setItem() {},
      removeItem() {},
    },
    {
      getItem() {
        return null
      },
      setItem() {
        throw Error("quota")
      },
      removeItem() {},
    },
    {
      getItem() {
        return null
      },
      setItem() {},
      removeItem() {},
    },
    {
      getItem() {
        return '{"version":7}'
      },
      setItem() {},
      removeItem() {},
    },
  ]) {
    const client = createStrengthLibraryClient(
      async () => {
        requests++
        return response({})
      },
      () => storage
    )
    await assert.rejects(
      client.mutate(
        strengthLibraryAttempt(catalog(), definition(), undefined, operationId)
      ),
      /recovery|retained/
    )
  }
  assert.equal(requests, 0)
})

test("definite initial precommit rejection allows editing, while any recheck rejection and account change retain the original immutable intent", async () => {
  const storage = store(),
    attempt = strengthLibraryAttempt(
      catalog(),
      definition(),
      undefined,
      operationId
    )
  const first = createStrengthLibraryClient(
    async () =>
      response(
        { error: "Rejected before commit", code: "STRENGTH_LIBRARY_REJECTED" },
        400
      ),
    () => storage
  )
  await assert.rejects(first.mutate(attempt), /Rejected before commit/)
  assert.equal(first.pending(scope), null)
  const unknown = createStrengthLibraryClient(
    async () =>
      response(
        { error: "Commit not confirmed", code: "STRENGTH_LIBRARY_UNCONFIRMED" },
        502
      ),
    () => storage
  )
  await assert.rejects(unknown.mutate(attempt), /not confirmed/)
  const recheck = createStrengthLibraryClient(
    async () =>
      response(
        {
          error: "Validation error on replay",
          code: "STRENGTH_LIBRARY_INVALID",
        },
        400
      ),
    () => storage
  )
  await assert.rejects(recheck.mutate(attempt, true), /Validation/)
  assert.deepEqual(recheck.pending(scope), attempt)
  const changed = createStrengthLibraryClient(
    async () =>
      response(
        { error: "Another account", code: "STRENGTH_LIBRARY_ACCOUNT_CHANGED" },
        409
      ),
    () => storage
  )
  await assert.rejects(changed.mutate(attempt, true), /Another account/)
  assert.deepEqual(changed.pending(scope), attempt)
  await assert.rejects(
    changed.mutate(
      strengthLibraryAttempt(
        catalog(),
        { ...definition(), title: "Second request" },
        undefined,
        "another-operation-0002"
      )
    ),
    /retained/
  )
  assert.throws(
    () =>
      strengthLibraryAttempt({ ...catalog(), readOnly: true }, definition()),
    /read-only/
  )
})

test("catalog and exact-ID history reject wrong-scope and same-name different-exercise substitutions", async () => {
  const exercise = row(),
    block = strengthLibraryExerciseBlock(exercise)
  const history = {
    id: exerciseId,
    accountScope: scope,
    records: [
      {
        workoutId: "event:10",
        date: "2026-10-20",
        title: "Actual prescribed workout",
        workoutCompleted: false,
        actualResultsAvailable: false,
        exercises: block.exercises,
      },
    ],
    legacyMatches: [],
    coverage: "retained-calendar-context",
    actualResultsAvailable: false,
  }
  const client = createStrengthLibraryClient(
    async (path) =>
      response(
        path.endsWith("/history")
          ? history
          : { ...catalog(), exercises: [exercise], total: 1 }
      ),
    () => store()
  )
  assert.equal((await client.list()).exercises[0].id, exerciseId)
  assert.equal(
    (await client.history(exerciseId, scope)).records[0].exercises[0]
      .libraryExerciseId,
    exerciseId
  )
  const different = structuredClone(history)
  different.records[0].exercises[0].libraryExerciseId =
    "exercise:" + "f".repeat(64)
  const wrong = createStrengthLibraryClient(
    async () => response(different),
    () => store()
  )
  await assert.rejects(wrong.history(exerciseId, scope), /does not match/)
  await assert.rejects(
    client.history(exerciseId, "f".repeat(64)),
    /could not be verified/
  )
})

test("explicit selection, duplicate and Undo snapshots preserve linked identity, parameters, exact zero/null prescriptions without mutating saved definitions", () => {
  const exercise = row(),
    before = structuredClone(exercise),
    block = strengthLibraryExerciseBlock(exercise),
    current = block.exercises[0]
  assert.equal(current.sets.length, 3)
  assert.ok(
    current.sets.every((set) =>
      Object.values(set.values).every((value) => value === null)
    )
  )
  current.sets = current.sets.slice(0, 1)
  current.sets[0].values[current.parameters[0].id] = 0
  current.sets[0].values[current.parameters[1].id] = 45
  const undo = structuredClone(current),
    selected = selectStrengthLibraryExercise(current, {
      ...exercise,
      title: "Updated title",
    })
  assert.equal(selected.libraryExerciseId, exercise.id)
  assert.equal(selected.sets.length, 1)
  assert.deepEqual(Object.values(selected.sets[0].values), [0, 45])
  const copied = copyStrengthPrescription({
    version: 1,
    blocks: [{ ...block, exercises: [selected] }],
  })
  assert.notEqual(copied.blocks[0].exercises[0].id, selected.id)
  assert.equal(copied.blocks[0].exercises[0].libraryExerciseId, exercise.id)
  assert.deepEqual(
    Object.values(copied.blocks[0].exercises[0].sets[0].values),
    [0, 45]
  )
  assert.deepEqual(current, undo)
  assert.deepEqual(exercise, before)
  assert.deepEqual(validateStrengthPrescription(copied), [])
})

test("changed-receipt resolution requires exact immutable operation proof and authoritative same-account reload before explicit acknowledgement", async () => {
  const storage = store(),
    attempt = strengthLibraryAttempt(
      catalog(),
      definition(),
      undefined,
      operationId
    ),
    updated = row({
      ...attempt.body.definition,
      title: "Later renamed definition",
    }),
    requests = []
  let proofScope = scope
  const client = createStrengthLibraryClient(
    async (path, options) => {
      requests.push({ path, method: options?.method || "GET" })
      if (options?.method)
        return response(
          {
            error: "Original save later changed",
            code: "STRENGTH_LIBRARY_REPLAY_CHANGED",
            exerciseId,
            accountScope: proofScope,
            operationId,
          },
          409
        )
      if (path === "/api/strength-exercises")
        return response({ ...catalog(), exercises: [updated], total: 1 })
      return response(updated)
    },
    () => storage
  )
  await assert.rejects(client.mutate(attempt), /later changed/)
  assert.equal(client.changed(scope).exerciseId, exerciseId)
  assert.deepEqual(client.pending(scope), attempt)
  assert.throws(
    () =>
      client.acknowledgeChanged({
        exercise: updated,
        catalog: catalog(),
        attempt,
      }),
    /Reload/
  )
  const inspection = await client.inspectChanged(attempt)
  assert.equal(inspection.exercise.title, "Later renamed definition")
  assert.equal(
    inspection.attempt.body.definition.title,
    "Independent custom lift"
  )
  assert.deepEqual(
    client.pending(scope),
    attempt,
    "Reload alone must not discard retained intent"
  )
  client.acknowledgeChanged(inspection)
  assert.equal(client.pending(scope), null)
  assert.equal(
    requests.filter((request) => request.method !== "GET").length,
    1,
    "Explicit resolution never sends another create or update"
  )
  proofScope = "f".repeat(64)
  await assert.rejects(client.mutate(attempt), /later changed/)
  assert.equal(
    client.changed(scope),
    null,
    "Another account is never accepted as receipt resolution proof"
  )
})

test("deleted changed receipt can only be acknowledged after current-account list and exact saved-id 404, never by automatic recreation", async () => {
  const storage = store(),
    attempt = strengthLibraryAttempt(
      catalog(),
      definition(),
      undefined,
      operationId
    ),
    writes = []
  let listScope = scope
  const client = createStrengthLibraryClient(
    async (path, options) => {
      if (options?.method) {
        writes.push(options)
        return response(
          {
            error: "Original exercise deleted",
            code: "STRENGTH_LIBRARY_REPLAY_CHANGED",
            exerciseId,
            accountScope: scope,
            operationId,
          },
          409
        )
      }
      if (path === "/api/strength-exercises")
        return response({ ...catalog(), accountScope: listScope })
      return response(
        { error: "Deleted", code: "STRENGTH_LIBRARY_NOT_FOUND" },
        404
      )
    },
    () => storage
  )
  await assert.rejects(client.mutate(attempt), /deleted/)
  listScope = "f".repeat(64)
  await assert.rejects(client.inspectChanged(attempt), /another account/)
  assert.deepEqual(client.pending(scope), attempt)
  listScope = scope
  const inspection = await client.inspectChanged(attempt)
  assert.equal(inspection.exercise, null)
  client.acknowledgeChanged(inspection)
  assert.equal(client.pending(scope), null)
  assert.equal(writes.length, 1)
})

test("delete acknowledges only the exact saved row and immutable operation, retaining prescriptions independently", async () => {
  const exercise = row(),
    block = strengthLibraryExerciseBlock(exercise),
    prescription = structuredClone(block),
    attempt = strengthLibraryAttempt(catalog(), null, exercise, operationId),
    storage = store()
  const wrong = createStrengthLibraryClient(
    async () =>
      response({
        verified: true,
        deleted: true,
        id: "exercise:" + "f".repeat(64),
        operationId,
        accountScope: scope,
        catalogRevision: revision,
      }),
    () => storage
  )
  await assert.rejects(wrong.mutate(attempt), /could not be verified/)
  assert.deepEqual(wrong.pending(scope), attempt)
  const valid = createStrengthLibraryClient(
    async () =>
      response({
        verified: true,
        deleted: true,
        id: exercise.id,
        operationId,
        accountScope: scope,
        catalogRevision: revision,
      }),
    () => storage
  )
  await valid.mutate(attempt, true)
  assert.equal(valid.pending(scope), null)
  assert.deepEqual(block, prescription)
})
