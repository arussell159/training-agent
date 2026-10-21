import test from "node:test"
import assert from "node:assert/strict"
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem() {
      throw new Error("blocked")
    },
    setItem() {
      throw new Error("blocked")
    },
    removeItem() {
      throw new Error("blocked")
    },
    get length() {
      throw new Error("blocked")
    },
  },
})
import {
  newAnnotation,
  annotationProblem,
  annotationEntry,
  createAnnotationAttempt,
  deleteAnnotationAttempt,
  createAnnotationClient,
  annotationRecoveryKey,
  rememberAnnotationRecovery,
  readAnnotationRecovery,
  clearAnnotationRecovery,
  findAnnotationCreationRecovery,
} from "../src/lib/calendar-annotations.ts"
const day = "2026-10-21",
  uuid = "62efea2a-b703-4ef2-a9a0-a879bdc34a62",
  revision = "a".repeat(64)
const goals = () => ({
  ...newAnnotation("goals", day),
  goals: [
    { id: "first", text: "First goal", completed: true },
    { id: "second", text: "Second goal", completed: false },
  ],
})
const availability = () => ({
  ...newAnnotation("availability", day),
  endDate: "2026-10-23",
  mode: "limited",
  sports: ["Run", "Bike"],
  reason: "Work",
  description: "Travel\nEasy running only",
})
const rawRow = (entry) => ({
  ...createAnnotationAttempt(entry, null, uuid).body.entry,
  id: "event:123",
  revision,
  title: entry.title,
  editable: true,
  metadataCurrent: true,
  nativeSportsComplete: true,
  creationId: uuid,
})
const row = (entry) => ({ ...rawRow(entry), ...annotationEntry(rawRow(entry)) })
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })

test("goals preserve identity, order and completion, discard empty rows and reject an empty list", () => {
  const draft = goals()
  draft.goals.splice(1, 0, { id: "blank", text: " \n", completed: true })
  const attempt = createAnnotationAttempt(draft, null, uuid)
  assert.deepEqual(attempt.body.entry.goals, [
    { id: "first", text: "First goal", completed: true },
    { id: "second", text: "Second goal", completed: false },
  ])
  assert.deepEqual(Object.keys(attempt.body.entry).sort(), [
    "date",
    "endDate",
    "goals",
    "kind",
    "title",
  ])
  assert.equal(
    draft.goals.length,
    3,
    "normalization cannot mutate the editor draft"
  )
  assert.match(annotationProblem({ ...draft, goals: [] }), /at least one goal/)
  assert.throws(
    () => createAnnotationAttempt({ ...draft, title: "a".repeat(151) }, null),
    /150/
  )
  assert.throws(
    () => createAnnotationAttempt({ ...draft, endDate: "2026-10-22" }, null),
    /one calendar date/
  )
})

test("availability uses inclusive valid range and exact available labels; switching unavailable removes hidden sports", () => {
  const draft = availability()
  assert.equal(annotationProblem(draft), null)
  assert.match(annotationProblem({ ...draft, sports: [] }), /at least one/)
  assert.match(
    annotationProblem({ ...draft, sports: ["Day Off"] }),
    /valid available sports/
  )
  assert.match(
    annotationProblem({ ...draft, endDate: "2026-10-20" }),
    /end date/
  )
  assert.match(
    annotationProblem({ ...draft, date: "2026-02-30" }),
    /valid calendar date/
  )
  const attempt = createAnnotationAttempt(
    { ...draft, mode: "unavailable" },
    null,
    uuid
  )
  assert.deepEqual(attempt.body.entry.sports, [])
  assert.deepEqual(draft.sports, ["Run", "Bike"])
  assert.equal(attempt.body.entry.endDate, "2026-10-23")
  assert.deepEqual(Object.keys(attempt.body.entry).sort(), [
    "date",
    "description",
    "endDate",
    "kind",
    "mode",
    "reason",
    "sports",
  ])
})

test("read validates exact native identity and never sends a write", async () => {
  const calls = [],
    client = createAnnotationClient(async (...args) => {
      calls.push(args)
      return response(rawRow(goals()))
    })
  const saved = await client.read("event:123")
  assert.equal(saved.goals[0].completed, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].method, undefined)
  assert.equal(calls[0][1].cache, "no-store")
  await assert.rejects(client.read("activity:123"), /saved calendar entry/)
  await assert.rejects(
    createAnnotationClient(async () =>
      response({ ...rawRow(goals()), id: "event:456" })
    ).read("event:123"),
    /another record/
  )
  await assert.rejects(
    createAnnotationClient(async () =>
      response({ ...rawRow(goals()), goals: "not a checklist" })
    ).read("event:123"),
    /incomplete/
  )
})

test("verified create/update accept full matching readback and send one normalized request", async () => {
  const draft = availability(),
    calls = []
  const attempt = createAnnotationAttempt(draft, row(draft), uuid)
  const client = createAnnotationClient(async (url, options) => {
    calls.push({ url, options })
    return response({
      verified: true,
      workoutId: "event:123",
      annotation: rawRow(draft),
    })
  })
  const result = await client.write(attempt)
  assert.equal(result.annotation.description, draft.description)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "/api/calendar/annotations/event%3A123")
  assert.equal(calls[0].options.method, "PUT")
  assert.deepEqual(JSON.parse(calls[0].options.body), attempt.body)
  assert.equal(attempt.body.revision, revision)
})

test("wrong server goal text, title, order or completion never close a different draft as verified", async () => {
  const draft = goals(),
    attempt = createAnnotationAttempt(draft, row(draft), uuid)
  for (const annotation of [
    { ...rawRow(draft), title: "Wrong list" },
    {
      ...rawRow(draft),
      goals: [{ ...draft.goals[0], text: "Another goal" }, draft.goals[1]],
    },
    {
      ...rawRow(draft),
      goals: [{ ...draft.goals[0], completed: false }, draft.goals[1]],
    },
    { ...rawRow(draft), goals: [...draft.goals].reverse() },
  ]) {
    const client = createAnnotationClient(async () =>
      response({ verified: true, workoutId: "event:123", annotation })
    )
    await assert.rejects(
      client.write(attempt),
      (error) => error.uncertain === true && /differs/.test(error.message)
    )
  }
})

test("wrong server availability mode, sport, reason or description is uncertain even with matching id/date", async () => {
  const draft = availability(),
    attempt = createAnnotationAttempt(draft, row(draft), uuid)
  for (const annotation of [
    { ...rawRow(draft), mode: "unavailable", sports: [] },
    { ...rawRow(draft), sports: ["Swim"] },
    { ...rawRow(draft), reason: "Injury" },
    { ...rawRow(draft), description: "Stale response" },
  ])
    await assert.rejects(
      createAnnotationClient(async () =>
        response({ verified: true, workoutId: "event:123", annotation })
      ).write(attempt),
      (error) => error.uncertain === true
    )
})

test("delete can only confirm its exact route identity, never another returned workout", async () => {
  const attempt = deleteAnnotationAttempt(row(goals()), uuid)
  const correct = {
    id: "event:123",
    workoutId: "event:123",
    deleted: true,
    verified: true,
  }
  assert.equal(
    (await createAnnotationClient(async () => response(correct)).write(attempt))
      .deleted,
    true
  )
  for (const value of [
    { ...correct, workoutId: "event:456" },
    { ...correct, id: "event:456" },
    { ...correct, deleted: false },
    { ...correct, verified: false },
  ])
    await assert.rejects(
      createAnnotationClient(async () => response(value)).write(attempt),
      (error) => error.uncertain === true
    )
})

test("HTTP conflict/validation retain editable draft; lost reply is uncertain; client never retries automatically", async () => {
  const attempt = createAnnotationAttempt(goals(), null, uuid)
  for (const [status, uncertain] of [
    [400, false],
    [409, false],
    [502, true],
  ]) {
    let calls = 0
    const client = createAnnotationClient(async () => {
      calls++
      return response(
        {
          error: "Synthetic failure",
          code: status === 409 ? "ANNOTATION_CONFLICT" : "FIXTURE",
        },
        status
      )
    })
    await assert.rejects(
      client.write(attempt),
      (error) => error.status === status && error.uncertain === uncertain
    )
    assert.equal(calls, 1)
  }
  await assert.rejects(
    createAnnotationClient(async () => {
      throw new TypeError("Reply lost")
    }).write(attempt),
    (error) => error.uncertain === true
  )
  await assert.rejects(
    createAnnotationClient(async () => response({ verified: true })).write(
      attempt
    ),
    (error) => error.uncertain === true
  )
})

test("delete preflight requires durable recovery before a request can begin",()=>{
  const entry=goals(),row={...entry,id:"event:445",revision};
  const key=annotationRecoveryKey("delete-storage-guard",entry.kind,row.id);
  const attempt=deleteAnnotationAttempt(row,uuid);
  assert.throws(()=>rememberAnnotationRecovery(key,{attempt,draft:entry},{requireStorage:true}),/No delete request was sent/);
  assert.equal(readAnnotationRecovery(key),null,"A rejected preflight must not manufacture an uncertain pending deletion");
});

test("blocked-storage recovery retains immutable operation and follows creation UUID rather than date/content heuristics", () => {
  const draft = goals(),
    attempt = createAnnotationAttempt(draft, null, uuid)
  const key = annotationRecoveryKey("scope-a", "goals", day)
  rememberAnnotationRecovery(key, { attempt, draft })
  attempt.body.entry.goals[0].text = "Changed after storing"
  assert.equal(
    readAnnotationRecovery(key).attempt.body.entry.goals[0].text,
    "First goal"
  )
  assert.equal(
    findAnnotationCreationRecovery("scope-a", "goals", uuid).key,
    key
  )
  assert.equal(findAnnotationCreationRecovery("scope-b", "goals", uuid), null)
  assert.equal(
    findAnnotationCreationRecovery("scope-a", "availability", uuid),
    null
  )
  assert.equal(
    findAnnotationCreationRecovery("scope-a", "goals", "different-creation"),
    null
  )
  clearAnnotationRecovery(key)
  assert.equal(readAnnotationRecovery(key), null)
})
