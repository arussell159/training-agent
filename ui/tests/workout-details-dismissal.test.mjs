import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

function source(name) {
  return ts.createSourceFile(name, readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function find(file, predicate) {
  let found
  function visit(node) {
    if (predicate(node)) found = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found)
  return found
}
function evaluate(node, file, values) {
  const js = ts.transpileModule(`return (${node.getText(file)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(values), js)(...Object.values(values))
}
const details = source("desktop-workout-details.tsx")
const calendar = source("training-calendar.tsx")
const notification = find(details, node => ts.isCallExpression(node) && ["useEffect", "useLayoutEffect"].includes(node.expression.getText(details)) && node.arguments[0]?.getText(details) === "() => onDirtyChange?.(dirty)")
const decision = find(calendar, node => ts.isVariableDeclaration(node) && node.name.getText(calendar) === "confirmDetailsExit").initializer.arguments[0]
const registration = find(calendar, node => ts.isCallExpression(node) && ["useEffect", "useLayoutEffect"].includes(node.expression.getText(calendar)) && node.arguments[0]?.getText(calendar).includes("registerWorkoutNavigationGuard("))

function fixture() {
  const passive = [], confirmations = []
  let parentDirty = false, registered
  const lifecycle = { useEffect: callback => passive.push(callback), useLayoutEffect: callback => callback() }
  const guard = () => evaluate(decision, calendar, {
    detailsDirty: parentDirty,
    isAccountCurrent: () => true,
    previewSaving: false,
    previewDeleting: false,
    exitInFlight: { current: false },
    setDetailsExitError: () => {},
    discardDetails: { current: () => assert.fail("Cancel must retain the draft") },
    confirmWithFramework7: async (...args) => { confirmations.push(args); return false },
  })
  return {
    confirmations,
    input(dirty) {
      evaluate(notification, details, { ...lifecycle, dirty, onDirtyChange: value => { parentDirty = value } })
      evaluate(registration, calendar, {
        ...lifecycle,
        detailsDirty: parentDirty,
        confirmDetailsExit: guard(),
        discardDetailsChanges: () => assert.fail("Cancel must retain the draft"),
        registerWorkoutNavigationGuard: (prepare, dirty) => { registered = { prepare, dirty }; return () => {} },
      })
    },
    escape: () => guard()(),
    back: () => { assert.ok(registered, "Back guard must be registered before passive effects"); return registered.prepare() },
    dirty: () => parentDirty,
    passive,
  }
}

test("an immediate Escape after a committed detail edit asks before leaving, without waiting for passive effects", async () => {
  const view = fixture()
  view.input(true)
  assert.equal(view.dirty(), true)
  assert.equal(await view.escape(), false)
  assert.equal(view.confirmations.length, 1)
  assert.equal(view.confirmations[0][0], "Discard unsaved changes?")
})

test("an immediate browser Back sees the same committed dirty state", async () => {
  const view = fixture()
  view.input(true)
  assert.equal(await view.back(), false)
  assert.equal(view.confirmations.length, 1)
})

test("pristine and reverted details close without a phantom discard prompt", async () => {
  const view = fixture()
  view.input(false)
  assert.equal(await view.escape(), true)
  view.input(true)
  view.input(false)
  assert.equal(await view.escape(), true)
  assert.equal(await view.back(), true)
  assert.equal(view.confirmations.length, 0)
})
