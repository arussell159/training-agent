import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { randomUUID } from "node:crypto"
import { newStep, workoutTotals } from "../../app-backend/lib/workout-editor-model.mjs"

const source = ts.transpileModule(readFileSync(new URL("../src/lib/workout-commits.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function fixture() {
  const id = "event:201", model = { version: 1, name: "Retained app", sport: "Ride", date: "2026-10-21", notes: "App notes", steps: [newStep("Ride")] }
  const workout = { id, title: model.name, sport: "Bike", workout_date: model.date, details: "Prescription", editor_model: model, workout_summary: { planned: {} } }
  let disk = { sequence: 1, workouts: { [id]: { workoutId: id, workout, input: { model }, sequence: 1, revision: "app:1", state: "failed", externalConflict: { name: "External" }, providerWorkoutId: id } }, operations: [{ operationId: randomUUID(), workoutId: id, action: "edit", sequence: 1, input: { model }, backendRevision: "app:1", state: "failed", acceptedAt: Date.now() }] }
  let tail = Promise.resolve(), transactions = 0, loseReply = false, limit = false, nativeChanges = 0
  const requests = [], receipts = new Map()
  let server = { workoutId: id, revision: "app:1", syncStatus: "failed", model, workout, externalConflict: { name: "External" }, providerWorkoutId: id }
  const transact = (_scope, change) => {
    const result = tail.then(() => { const next = structuredClone(disk), value = change(next); transactions++; disk = next; return { value, ledger: next } })
    tail = result.catch(() => {})
    return result
  }
  const response = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => structuredClone(body) })
  const apiFetch = async (url, options = {}) => {
    requests.push({ url, ...options })
    if (options.method === "POST" && url.endsWith("/conflict")) {
      const body = JSON.parse(options.body)
      if (limit) return response({ error: "Limited" }, 429, { "Retry-After": "60" })
      if (!receipts.has(body.operationId)) {
        nativeChanges++
        const next = { ...model, name: body.choice === "provider" ? "Reviewed provider" : model.name }
        server = { workoutId: id, revision: "app:2", syncStatus: "synced", syncedAt: Date.now(), model: next, workout: { ...workout, title: next.name, editor_model: next }, providerWorkoutId: id, input: { model: next, personal: { privateNotes: "Preserved" }, values: { duration_seconds: 123 }, time: "07:15" } }
        receipts.set(body.operationId, server)
      }
      if (loseReply) { loseReply = false; throw TypeError("Connection lost after durable acceptance") }
      return response(receipts.get(body.operationId))
    }
    return response({ workouts: [server] })
  }
  const load = () => {
    const module = { exports: {} }
    runInNewContext(source, {
      module, exports: module.exports, Error, TypeError, Date, Map, Set, Promise, JSON, Object, Array, Number, String, Boolean, Math, Intl, structuredClone, AbortSignal,
      navigator: { onLine: true, locks: { request: async (_key, _options, use) => use({}) } },
      setTimeout: () => 1, clearTimeout: () => {},
      require: name => {
        if (name === "./api-client") return { apiFetch, apiSessionRevision: () => "session" }
        if (name === "./device-cache") return { deviceCacheScope: () => "account" }
        if (name === "./random-id") return { randomId: randomUUID }
        if (name === "./workout-commit-store") return { readWorkoutCommits: async () => structuredClone(disk), transactWorkoutCommits: transact }
        if (name.endsWith("workout-editor-model.mjs")) return { workoutTotals }
        throw Error(`Unexpected import ${name}`)
      },
    })
    return module.exports
  }
  const body = () => ({ operationId: randomUUID(), expectedRevision: "app:1", candidateRevision: "a".repeat(64), choice: "provider" })
  return { id, model, workout, load, body, requests, state: () => structuredClone(disk), change: fn => fn(disk), transactions: () => transactions, lose: () => { loseReply = true }, limit: () => { limit = true }, nativeChanges: () => nativeChanges }
}

test("a conflict choice is durable before HTTP and blocks simultaneous ordinary saves and competing choices", async () => {
  const env = fixture(), client = env.load(), body = env.body()
  await client.restoreWorkoutCommits()
  const accepted = await client.resolveWorkoutConflict(env.id, 1, body, { local: env.model, provider: { title: "External" } })
  assert.equal(accepted.durableBoundary, "local")
  assert.equal(env.requests.length, 0)
  assert.deepEqual(env.state().resolutions[body.operationId].body, body)
  await assert.rejects(client.acceptWorkoutCommit(env.id, { model: { ...env.model, name: "Uncommitted newer edit" }, revision: "app:1" }), /choice.*confirmation/)
  await assert.rejects(client.resolveWorkoutConflict(env.id, 1, env.body()), /earlier reviewed choice/)
  assert.equal(env.state().workouts[env.id].input.model.name, env.model.name)
})

test("replacing a rejected imported handoff remains an edit with its native baseline, while a never-created app identity retries creation", async () => {
  const imported=fixture();
  imported.change(state=>{state.workouts[imported.id].revision="local:1";state.operations[0].backendRevision=undefined;});
  const client=imported.load();await client.restoreWorkoutCommits();
  const baseEvent={id:201,category:"WORKOUT",start_date_local:"2026-10-21T07:00:00",name:"Original imported"};
  await client.acceptWorkoutCommit(imported.id,{model:{...imported.model,name:"Corrected imported"},revision:"local:1"},imported.workout,undefined,baseEvent);
  assert.equal(imported.state().operations.at(-1).action,"edit");
  assert.deepEqual(imported.state().operations.at(-1).baseEvent,baseEvent);
  const pending=fixture(),appId=`app:${randomUUID()}`;
  pending.change(state=>{const row=state.workouts[pending.id];delete state.workouts[pending.id];row.workoutId=appId;row.workout.id=appId;row.revision="local:1";state.workouts[appId]=row;state.operations[0].workoutId=appId;state.operations[0].backendRevision=undefined;});
  const appClient=pending.load();await appClient.restoreWorkoutCommits();
  await appClient.acceptWorkoutCommit(appId,{model:pending.model,revision:"local:1",creationId:appId.slice(4)});
  assert.equal(pending.state().operations.at(-1).action,"create");
})

test("lost conflict response survives a new client instance and automatically replays the exact UUID/body once", async () => {
  const env = fixture(), first = env.load(), body = env.body()
  await first.restoreWorkoutCommits(); await first.resolveWorkoutConflict(env.id, 1, body)
  env.lose(); await first.resumeWorkoutCommits()
  assert.equal(env.state().resolutions[body.operationId].state, "local")
  assert.equal(env.nativeChanges(), 1)
  env.change(state => { state.resolutions[body.operationId].nextAttempt = 0 })
  const reopened = env.load(); await reopened.restoreWorkoutCommits(); await reopened.resumeWorkoutCommits()
  const posts = env.requests.filter(request => request.method === "POST")
  assert.equal(posts.length, 2)
  assert.equal(posts[0].body, posts[1].body)
  assert.equal(env.nativeChanges(), 1)
  const ledger = env.state()
  assert.equal(ledger.resolutions[body.operationId].state, "confirmed")
  assert.equal(ledger.workouts[env.id].input.model.name, "Reviewed provider")
  assert.equal(ledger.workouts[env.id].input.personal.privateNotes, "Preserved")
  assert.equal(ledger.workouts[env.id].input.values.duration_seconds, 123)
  assert.equal(ledger.operations[0].state, "superseded")
})

test("persistent resolution retries respect Retry-After and leave the full choice recoverable", async () => {
  const env = fixture(), client = env.load(), body = env.body()
  await client.restoreWorkoutCommits(); await client.resolveWorkoutConflict(env.id, 1, body)
  env.limit(); await client.resumeWorkoutCommits()
  const intent = env.state().resolutions[body.operationId]
  assert.equal(intent.state, "local")
  assert.ok(intent.nextAttempt - Date.now() >= 59_000)
  assert.deepEqual(intent.localSnapshot.input.model, env.model)
  const posts = env.requests.filter(request => request.method === "POST").length
  await client.resumeWorkoutCommits()
  assert.equal(env.requests.filter(request => request.method === "POST").length, posts)
})

test("fresh visible external edits stay flagged despite older synced status, while ID-only changes and old snapshots do not", async () => {
  const env = fixture(), client = env.load(), now = Date.now()
  env.change(state => { const row = state.workouts[env.id]; row.state = "synced"; row.externalConflict = undefined; row.syncedAt = now; state.operations[0].state = "synced" })
  await client.restoreWorkoutCommits()
  const context = { cache_scope: "account", version: "new", synced_at: new Date(now + 1000).toISOString(), athlete: { time_zone: "America/Chicago" }, history: [], planned: [{ ...env.workout, editor_model: { ...env.model, steps: env.model.steps.map(step => ({ ...step, id: randomUUID() })) } }] }
  const transactions = env.transactions()
  await client.observeWorkoutCommitContext(context)
  assert.equal(env.transactions(), transactions)
  await client.observeWorkoutCommitContext({ ...context, synced_at: new Date(now - 1).toISOString(), planned: [{ ...env.workout, title: "Old snapshot" }] })
  assert.equal(env.state().workouts[env.id].state, "synced")
  await client.observeWorkoutCommitContext({ ...context, planned: [{ ...env.workout, title: "External title" }] })
  assert.equal(env.state().workouts[env.id].externalConflict.observed, true)
  await client.resumeWorkoutCommits()
  assert.equal(env.state().workouts[env.id].state, "failed")
  assert.equal(env.state().workouts[env.id].input.model.name, env.model.name)
})
