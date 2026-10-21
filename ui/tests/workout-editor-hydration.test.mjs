import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const source = ts.createSourceFile(
  "workout-editor.tsx",
  readFileSync(
    new URL("../src/components/workout-editor.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const component = source.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "WorkoutEditor"
)
assert.ok(component)
const declarations = new Map()
let effect
function visit(node) {
  if (ts.isVariableDeclaration(node))
    declarations.set(node.name.getText(source), node.initializer)
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "useEffect"
  ) {
    assert.equal(
      effect,
      undefined,
      "Select the actual editor hydration effect unambiguously"
    )
    effect = node
  }
  ts.forEachChild(node, visit)
}
visit(component)
assert.ok(effect)
const javascript = (expression) =>
  ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText

function lifecycle() {
  const requests = [],
    loaded = [],
    errors = []
  let dependencies, cleanup
  const render = (workout, extra = {}) => {
    const context = {
      workout,
      date: "2026-10-23",
      initialSport: undefined,
      initialName: undefined,
      reloadKey: 0,
      initialModel: undefined,
      initialVariant: undefined,
      initialDesktopSnapshot: undefined,
      initialWarningSnapshot: undefined,
      AbortController,
      builderWorkoutModel: (model) => model,
      setLoaded: (value) => loaded.push(value),
      setLoadError: (value) => errors.push(value),
      loadWorkoutEditor: (url, signal, force) =>
        new Promise((resolve, reject) =>
          requests.push({ url, signal, force, resolve, reject })
        ),
      ...extra,
    }
    // Evaluate the production identity/URL expressions and effect, rather than a
    // parallel implementation of their request or cancellation behavior.
    for (const name of ["existingWorkout", "editorUrl"]) {
      context[name] = runInNewContext(
        javascript(declarations.get(name).getText(source)),
        { ...context, URLSearchParams }
      )
    }
    const next = Array.from(
      runInNewContext(javascript(effect.arguments[1].getText(source)), context)
    )
    if (
      !dependencies ||
      next.some((value, index) => !Object.is(value, dependencies[index]))
    ) {
      cleanup?.()
      dependencies = next
      cleanup = runInNewContext(
        javascript(effect.arguments[0].getText(source)),
        context
      )()
    }
  }
  return { render, requests, loaded, errors, close: () => cleanup?.() }
}
const response = (name) => ({
  revision: name,
  warnings: [],
  model: {
    name,
    sport: "WeightTraining",
    steps: [],
    strength: { version: 1, blocks: [] },
  },
})
const settled = () => new Promise((resolve) => setImmediate(resolve))

test("calendar object refresh cannot restart the same editor hydration or cancel its only reader", async () => {
  const state = lifecycle()
  state.render({ id: "event:42", name: "Before sync" })
  state.render({
    id: "event:42",
    name: "After sync",
    scheduled_start_at: "2026-10-23T09:00:00",
  })
  assert.equal(state.requests.length, 1)
  assert.equal(state.requests[0].signal.aborted, false)
  state.requests[0].resolve(response("original snapshot"))
  await settled()
  assert.equal(state.loaded.length, 1)
  assert.equal(state.loaded[0].model.name, "original snapshot")
  assert.deepEqual(state.errors, [""])
  state.close()
})

test("identity switch, explicit reload and close cancel old readers and ignore late success or failure", async () => {
  const state = lifecycle()
  state.render({ id: "event:42" })
  state.render({ id: "event:43" })
  assert.equal(state.requests[0].signal.aborted, true)
  assert.equal(state.requests[1].url, "/api/workouts/event%3A43/editor")
  state.requests[0].resolve(response("late wrong workout"))
  state.render({ id: "event:43" }, { reloadKey: 1 })
  assert.equal(state.requests[1].signal.aborted, true)
  assert.equal(state.requests[2].force, true)
  state.requests[1].reject(new Error("obsolete failure"))
  state.requests[2].resolve(response("fresh current workout"))
  await settled()
  assert.equal(state.loaded.length, 1)
  assert.equal(state.loaded[0].model.name, "fresh current workout")
  assert.deepEqual(state.errors, ["", "", ""])
  state.render({ id: "event:44" })
  state.close()
  assert.equal(state.requests[3].signal.aborted, true)
  state.requests[3].resolve(response("closed workout"))
  await settled()
  assert.equal(state.loaded.length, 1)
})
