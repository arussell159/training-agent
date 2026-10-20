import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

// Execute the component's real save callback with in-memory dependencies. This
// exercises its promise contract without mounting dialogs or contacting a provider.
const source = ts.createSourceFile(
  "desktop-workout-create.tsx",
  readFileSync(new URL("../src/components/desktop-workout-create.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let saveNode
function findSave(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "save") saveNode = node.initializer
  ts.forEachChild(node, findSave)
}
findSave(source)
assert.ok(saveNode, "the creation component exposes its save callback")
const callback = ts.transpileModule(`const save = ${saveNode.getText(source)}; save`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture({ personalFailure, providerFailure } = {}) {
  const observed = { busy: [], errors: [], uncertain: [], providerCalls: 0, saved: 0, closed: 0 }
  const model = { version: 1, name: "Swim", sport: "Swim", date: "2026-10-21", notes: "", steps: [] }
  const saving = { current: false }
  const personal = {
    value: {},
    refresh: async () => { if (personalFailure) throw personalFailure },
    save: async () => { if (personalFailure) throw personalFailure },
  }
  const save = runInNewContext(callback, {
    saving, personal, structure: null, metadata: { name: "Swim", date: model.date, time: "" },
    initialName: "Swim", sport: "Swim", description: "", comment: "", recurrence: null,
    draft: {}, blank: {}, scope: "test", creationId: "creation", uncertain: false,
    submitted: { current: null }, localStorage: {}, console,
    setBusy: (value) => observed.busy.push(value),
    setError: (value) => observed.errors.push(value),
    setUncertain: (value) => observed.uncertain.push(value),
    setRecurrence: () => {},
    changedPlannedValues: () => ({}),
    simpleWorkoutModel: () => model,
    rememberPendingWorkoutCreation: () => {},
    clearPendingWorkoutCreation: () => {},
    retainWorkoutSaveDraft: () => {},
    clearWorkoutSaveDraft: () => {},
    createPlannedWorkout: async () => {
      observed.providerCalls++
      if (providerFailure) throw providerFailure
      return { workout: { id: "event:123" } }
    },
    onClose: () => observed.closed++,
    onSaved: () => observed.saved++,
    toast: { add: () => {} },
  })
  return { save, observed, saving, built: { model, values: {}, personal: {}, comment: "", time: "" } }
}

test("builder creation rejects a personal-field failure before starting a provider write", async () => {
  const failure = new DOMException("Personal fields timed out", "TimeoutError")
  const { save, observed, saving, built } = fixture({ personalFailure: failure })
  await assert.rejects(save(false, built), (error) => error === failure)
  assert.equal(observed.providerCalls, 0)
  assert.equal(observed.saved, 0)
  assert.equal(observed.errors.at(-1), failure.message)
  assert.deepEqual(observed.busy, [true, false])
  assert.equal(saving.current, false)
})

test("builder creation propagates an unconfirmed provider failure and retains recovery status", async () => {
  const failure = Object.assign(new Error("The existing write is pending"), { status: 409, code: "CREATE_UNCONFIRMED" })
  const { save, observed, saving, built } = fixture({ providerFailure: failure })
  await assert.rejects(save(false, built), (error) => error === failure)
  assert.equal(observed.providerCalls, 1)
  assert.deepEqual(observed.uncertain, [true])
  assert.equal(observed.saved, 0)
  assert.equal(observed.closed, 0)
  assert.equal(saving.current, false)
})

test("summary creation handles a failure locally without an unhandled rejection", async () => {
  const failure = new Error("Personal fields unavailable")
  const { save, observed } = fixture({ personalFailure: failure })
  await save(false)
  assert.equal(observed.errors.at(-1), failure.message)
  assert.equal(observed.providerCalls, 0)
  assert.equal(observed.saved, 0)
})

test("successful builder creation resolves and reports the saved workout once", async () => {
  const { save, observed, built } = fixture()
  await save(false, built)
  assert.equal(observed.providerCalls, 1)
  assert.equal(observed.saved, 1)
  assert.equal(observed.errors.at(-1), "")
  assert.deepEqual(observed.busy, [true, false])
})
