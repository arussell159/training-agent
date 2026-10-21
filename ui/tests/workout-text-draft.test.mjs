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
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(file) === "useEffect" &&
    node.arguments[0]?.getText(file).includes("baseline.current")
  ) {
    assert.equal(effect, undefined)
    effect = node
  }
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(effect)
function draft(original, description = original) {
  const baseline = { current: original },
    state = { description, saved: original }
  let previousDependencies
  return {
    baseline,
    state,
    render(original, pending) {
      const context = {
        original,
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
