import test from "node:test"
import assert from "node:assert/strict"
import {
  createCalendarEntryTransferAttempt,
  createCalendarEntryTransferClient,
} from "../src/lib/calendar-entry-transfer.ts"
import { validateCalendarEntryClipboard } from "../src/lib/calendar-entry-clipboard.ts"
const row = () => ({
  kind: "availability",
  id: "event:42",
  revision: "a".repeat(64),
  editable: true,
  metadataCurrent: true,
  nativeSportsComplete: true,
  date: "2026-10-31",
  endDate: "2026-11-02",
  title: "Limited Availability",
  mode: "limited",
  sports: ["Run"],
  reason: "Work",
  description: "Exact prose",
})
const attempt = (action = "copy") =>
  createCalendarEntryTransferAttempt(
    "availability",
    row(),
    action,
    "2026-11-07",
    "immutable-transfer-identity"
  )
const success = (intent) => ({
  sourceId: intent.sourceId,
  kind: intent.body.kind,
  action: intent.body.action,
  operationId: intent.body.operationId,
  verified: true,
  workoutId: intent.body.action === "copy" ? "event:43" : "event:42",
  annotation: {
    ...row(),
    ...structuredClone(intent.expected),
    id: intent.body.action === "copy" ? "event:43" : "event:42",
  },
  workout: {
    sport: "Other",
    title: "Limited Availability",
    duration: "",
    id: intent.body.action === "copy" ? "event:43" : "event:42",
    workout_date: intent.body.date,
  },
})
const reply = (value) => Response.json(value)
test("calendar transfer attempts freeze exact destination span and source revision without retaining mutable row references", () => {
  const source = row(),
    intent = createCalendarEntryTransferAttempt(
      "availability",
      source,
      "copy",
      "2026-11-07",
      "immutable-transfer-identity"
    )
  source.sports.push("Swim")
  source.description = "Later source prose"
  assert.equal(intent.expected.endDate, "2026-11-09")
  assert.deepEqual(intent.expected.sports, ["Run"])
  assert.equal(intent.expected.description, "Exact prose")
  assert.equal(intent.body.revision, "a".repeat(64))
  assert.throws(
    () =>
      createCalendarEntryTransferAttempt(
        "availability",
        { ...row(), editable: false },
        "copy",
        "2026-11-07"
      ),
    /authoritative/
  )
  assert.throws(
    () =>
      createCalendarEntryTransferAttempt(
        "availability",
        row(),
        "copy",
        "2026-02-30"
      ),
    /date/i
  )
})
test("actual transfer client submits only immutable identity fields and accepts independent exact copy/move readback", async () => {
  const calls = []
  for (const action of ["copy", "move"]) {
    const intent = attempt(action),
      snapshot = structuredClone(intent),
      client = createCalendarEntryTransferClient(async (path, input) => {
        calls.push({ path, body: JSON.parse(input.body) })
        return reply(success(intent))
      })
    assert.equal(
      (await client.write(intent, { reconcileOnly: true })).workoutId,
      action === "copy" ? "event:43" : "event:42"
    )
    assert.deepEqual(intent, snapshot)
    assert.equal(calls.at(-1).path, "/api/calendar/entry-transfer/event%3A42")
    assert.deepEqual(calls.at(-1).body, { ...intent.body, reconcileOnly: true })
    assert.equal(Object.hasOwn(calls.at(-1).body, "expected"), false)
  }
})
test("mismatched transfer identity, dates, full private metadata and invalid context remain unconfirmed", async () => {
  const intent = attempt()
  const corruptions = [
    (value) => (value.sourceId = "event:99"),
    (value) => (value.operationId = "other"),
    (value) => (value.workoutId = "event:42"),
    (value) => value.annotation.sports.push("Swim"),
    (value) => (value.annotation.reason = "Vacation"),
    (value) => (value.annotation.endDate = "2026-11-08"),
    (value) => (value.annotation.metadataCurrent = false),
    (value) => (value.workout.id = "event:99"),
    (value) => (value.workout.duration = null),
    (value) => (value.context = { planned: [], history: [] }),
  ]
  for (const corrupt of corruptions) {
    const value = success(intent)
    corrupt(value)
    await assert.rejects(
      createCalendarEntryTransferClient(async () => reply(value)).write(intent),
      (error) => error.uncertain === true
    )
  }
})
test("transport ambiguity retains same operation; a denied recheck cannot prove the earlier write failed", async () => {
  const intent = attempt(),
    calls = []
  const client = createCalendarEntryTransferClient(async (_path, input) => {
    calls.push(JSON.parse(input.body))
    if (calls.length === 1) throw Error("Lost reply")
    return Response.json(
      { error: "Source changed", code: "ENTRY_TRANSFER_CONFLICT" },
      { status: 409 }
    )
  })
  await assert.rejects(
    client.write(intent),
    (error) => error.uncertain === true
  )
  await assert.rejects(
    client.write(intent, { reconcileOnly: true }),
    (error) =>
      error.status === 409 &&
      error.code === "ENTRY_TRANSFER_CONFLICT" &&
      error.uncertain === true
  )
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], { ...calls[0], reconcileOnly: true })
})
test("read source checks native row identity and abort before any request has no transfer side effect", async () => {
  let calls = 0
  const client = createCalendarEntryTransferClient(async () => {
    calls++
    return reply({ ...row(), id: "event:99" })
  })
  await assert.rejects(
    client.read("availability", "event:42"),
    /another identity/
  )
  const abort = new AbortController()
  abort.abort(new Error("Caller canceled"))
  await assert.rejects(
    client.write(attempt(), { signal: abort.signal }),
    (error) => error.uncertain === true && error.message === "Caller canceled"
  )
  assert.equal(calls, 1)
})

test("entry clipboard validates source, mode, revision and exact frozen intent without mutable aliases", () => {
  const input = {
    kind: "entry",
    mode: "copy",
    workoutIds: ["event:42"],
    label: "Availability",
    entryKind: "availability",
    row: row(),
    entryAttempt: attempt(),
  }
  const valid = validateCalendarEntryClipboard(input)
  valid.row.sports.push("Swim")
  assert.deepEqual(input.row.sports, ["Run"])
  for (const alter of [
    (value) => value.workoutIds.push("event:43"),
    (value) => (value.mode = "cut"),
    (value) => (value.row.revision = "b".repeat(64)),
    (value) => (value.entryAttempt.expected.description = "Other prose"),
    (value) => (value.entryAttempt.sourceId = "event:99"),
    (value) => (value.entryAttempt.body.reconcileOnly = true),
    (value) => (value.unknown = true),
  ]) {
    const corrupt = structuredClone(input)
    alter(corrupt)
    assert.throws(() => validateCalendarEntryClipboard(corrupt))
  }
})

test("Event copy clears observed Priority and Distance while Cut preserves both and exact remaining metadata", async () => {
  const event = {
    id: "event:42",
    revision: "a".repeat(64),
    editable: true,
    metadataCurrent: true,
    name: "Synthetic Road Race",
    date: "2026-10-31",
    priority: "B",
    eventType: "RunningRoad",
    raceDistance: "10000",
    atpEventType: "RunOnetoTwoHours",
    description: "Exact event prose",
    goals: {
      time: "1:00:00",
      distance: "",
      distanceUnit: "mi",
      place: "",
      finish: true,
      setPr: false,
      custom: ["Exact goal"],
    },
  }
  const copied = createCalendarEntryTransferAttempt(
    "event",
    event,
    "copy",
    "2026-11-07",
    "immutable-event-transfer"
  )
  assert.equal(copied.expected.priority, "")
  assert.equal(copied.expected.raceDistance, "")
  assert.equal(copied.expected.atpEventType, event.atpEventType)
  assert.deepEqual(copied.expected.goals, event.goals)
  const moved = createCalendarEntryTransferAttempt(
    "event",
    event,
    "move",
    "2026-11-07",
    "immutable-event-transfer"
  )
  assert.equal(moved.expected.priority, "B")
  assert.equal(moved.expected.raceDistance, "10000")
  const result = {
    sourceId: event.id,
    kind: "event",
    action: "copy",
    operationId: copied.body.operationId,
    verified: true,
    workoutId: "event:43",
    event: { ...event, ...copied.expected, id: "event:43" },
    workout: {
      id: "event:43",
      workout_date: "2026-11-07",
      sport: "Run",
      title: event.name,
      duration: "",
    },
  }
  const client = createCalendarEntryTransferClient(async () => reply(result))
  assert.equal((await client.write(copied)).event.priority, "")
  result.event.priority = "B"
  await assert.rejects(
    client.write(copied),
    (error) => error.uncertain === true
  )
})

test("Goals copy clears completion in exact expected readback while Cut retains checked rows", () => {
  const source = {
    kind: "goals",
    id: "event:42",
    date: "2026-10-31",
    endDate: "2026-10-31",
    title: "Goals",
    goals: [
      { id: "first", text: "Completed source item", completed: true },
      { id: "second", text: "Next item", completed: false },
    ],
    revision: "a".repeat(64),
    editable: true,
    metadataCurrent: true,
    nativeSportsComplete: true,
  }
  const copied = createCalendarEntryTransferAttempt(
    "goals",
    source,
    "copy",
    "2026-11-07",
    "immutable-goals-transfer"
  )
  const moved = createCalendarEntryTransferAttempt(
    "goals",
    source,
    "move",
    "2026-11-07",
    "immutable-goals-transfer"
  )
  assert.deepEqual(
    copied.expected.goals.map((goal) => goal.completed),
    [false, false]
  )
  assert.deepEqual(moved.expected.goals, source.goals)
  assert.equal(source.goals[0].completed, true)
  assert.equal(
    validateCalendarEntryClipboard({
      kind: "entry",
      mode: "copy",
      workoutIds: [source.id],
      label: source.title,
      entryKind: "goals",
      row: source,
      entryAttempt: copied,
    }).entryAttempt.expected.goals[0].completed,
    false
  )
})
