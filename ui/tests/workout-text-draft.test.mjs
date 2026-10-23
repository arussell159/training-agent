import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const file = ts.createSourceFile(
  "use-workout-text-draft.ts",
  readFileSync(
    new URL("../src/hooks/use-workout-text-draft.ts", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
)
let effect
let activityHydration
function visit(node) {
  if (ts.isArrowFunction(node) && node.parameters[0]?.name.getText(file) === "editor" && node.body.getText(file).includes("const nativeDescription")) {
    assert.equal(activityHydration, undefined)
    activityHydration = node
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(file) === "useEffect" &&
    node.arguments[0]?.getText(file).includes("baseline.current === original")
  ) {
    assert.equal(effect, undefined)
    effect = node
  }
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(effect)
assert.ok(activityHydration)
function draft(original, description = original) {
  const baseline = { current: original },
    state = { description, saved: original }
  let previousDependencies
  return {
    baseline,
    state,
    render(original, pending, activityText = false) {
      const context = {
        original,
        activityText,
        workout: { app_pending_operation: pending },
        baseline,
        setDescription: (change) => {
          state.description = change(state.description)
        },
        setSavedDescription: (value) => {
          state.saved = value
        },
      }
      const js = (node) =>
        ts.transpileModule(`(${node.getText(file)})`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText
      const dependencies = runInNewContext(js(effect.arguments[1]), context)
      if (
        previousDependencies &&
        dependencies.every((value, index) =>
          Object.is(value, previousDependencies[index])
        )
      )
        return
      previousDependencies = dependencies
      runInNewContext(js(effect.arguments[0]), context)()
    },
  }
}

test("the actual text baseline ignores optimistic updates and preserves a dirty description after rejected-save rollback", () => {
  for (const original of ["", "Saved human introduction"]) {
    const input = draft(original, "Unsaved human description")
    input.render(original)
    input.render("Unsaved human description", "operation-1")
    assert.equal(input.baseline.current, original)
    assert.equal(input.state.saved, original)
    input.render(original)
    assert.equal(input.state.description, "Unsaved human description")
    assert.equal(input.state.saved, original)
  }
})

test("clearing the pending flag accepts a verified identical description and later pristine provider changes", () => {
  const input = draft("Saved", "New saved description")
  input.render("Saved")
  input.render("New saved description", "operation-1")
  input.render("New saved description")
  assert.equal(input.baseline.current, "New saved description")
  assert.equal(input.state.saved, "New saved description")
  assert.equal(input.state.description, "New saved description")
  input.render("Later verified provider introduction")
  assert.equal(input.state.description, "Later verified provider introduction")
  assert.equal(input.state.saved, "Later verified provider introduction")
})

test("an independent confirmed source update refreshes the baseline without replacing other dirty typing", () => {
  const input = draft("Saved", "Different unsaved typing")
  input.render("New verified source")
  assert.equal(input.baseline.current, "New verified source")
  assert.equal(input.state.saved, "New verified source")
  assert.equal(input.state.description, "Different unsaved typing")
  input.render("Provisional unrelated source", "operation-2")
  input.render("New verified source")
  assert.equal(input.state.description, "Different unsaved typing")
  assert.equal(input.state.saved, "New verified source")
})

test("a paired activity description is not replaced by the planned event's context text",()=>{
  const input=draft("Actual activity feedback")
  input.render("Different planned prescription",undefined,true)
  assert.equal(input.state.description,"Actual activity feedback")
  assert.equal(input.state.saved,"Actual activity feedback")
})

function hydrateActivity({ description = "Planned context", recovered, aborted = false } = {}) {
  const baseline = { current: "Planned context" }
  const state = { description, saved: "Planned context" }
  let deferredDescription
  const hydrate = runInNewContext(ts.transpileModule(`(${activityHydration.getText(file)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    controller: { signal: { aborted } }, baseline, recovered, workout: { id: "event:9004" },
    // React may defer a functional updater until after this async callback returns.
    setDescription: (change) => { deferredDescription = change },
    setSavedDescription: (value) => { state.saved = value },
    setCompletedEditableFields: () => {},
  })
  hydrate({ manualDescription: "Actual activity notes", originalDescription: "Actual activity notes", comments: [] })
  if (deferredDescription) state.description = deferredDescription(state.description)
  return state
}

test("pristine paired activity hydration remains clean when React defers the text updater", () => {
  const state = hydrateActivity()
  assert.equal(state.description, "Actual activity notes")
  assert.equal(state.description, state.saved)
})

test("activity hydration preserves typing and recovered drafts while adopting the actual saved baseline", () => {
  for (const input of [{ description: "New typing" }, { description: "Recovered notes", recovered: { description: "Recovered notes" } }]) {
    const state = hydrateActivity(input)
    assert.equal(state.description, input.description)
    assert.equal(state.saved, "Actual activity notes")
  }
})

test("an aborted activity hydration cannot update the text or its saved baseline", () => {
  assert.deepEqual(hydrateActivity({ aborted: true }), { description: "Planned context", saved: "Planned context" })
})
