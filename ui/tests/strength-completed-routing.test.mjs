import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

function source(name) {
  const text = readFileSync(
    new URL(`../src/components/${name}.tsx`, import.meta.url),
    "utf8"
  )
  return ts.createSourceFile(
    `${name}.tsx`,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
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
function evaluate(file, node, context) {
  return runInNewContext(
    ts.transpileModule(`(${node.getText(file)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context
  )
}
function exit(
  name,
  {
    dirty = true,
    busy = false,
    confirm = async () => false,
    discard = () => {},
  } = {}
) {
  const file = source(name),
    node = find(
      file,
      (node) =>
        ts.isVariableDeclaration(node) &&
        node.name.getText(file) === "requestStrengthExit"
    )
  const events = [],
    lock = { current: false },
    context = {
      previewSaving: busy,
      previewDeleting: false,
      detailsBusy: busy,
      exitInFlight: lock,
      completedStrength: true,
      detailsDirty: dirty,
      isAccountCurrent: () => true,
      discardDetails: { current: discard },
      confirmWithFramework7: confirm,
      setDetailsExitError: (value) => events.push(["error", value]),
      onOpenChange: (value) => events.push(["close", !value]),
      onBack: () => events.push(["close", true]),
      setAnalysisOpen: (value) => events.push(["analysis", value]),
      setAnalysis360Open: (value) => events.push(["analysis360", value]),
      setStrengthDetailsOpen: (value) => events.push(["details", value]),
      setStrengthView: (value) => events.push(["view", value]),
      setDetailsDirty: (value) => events.push(["dirty", value]),
      bypassWorkoutNavigationGuard: (action) => action(),
      Error,
    }
  const confirmNode = find(
    file,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === "confirmDetailsExit"
  )
  context.confirmDetailsExit = evaluate(
    file,
    confirmNode.initializer.arguments[0],
    context
  )
  const discardNode = find(
    file,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === "discardDetailsChanges"
  )
  context.discardDetailsChanges = evaluate(
    file,
    discardNode.initializer.arguments[0],
    context
  )
  return {
    invoke: evaluate(file, node.initializer, context),
    events,
    lock,
    context,
  }
}

test("both actual completed Strength exit adapters retain dirty details on Cancel and reject overlapping exits", async () => {
  for (const name of ["training-calendar", "workout-detail-page"]) {
    let resolve,
      confirmations = 0,
      discarded = 0
    const input = exit(name, {
      confirm: () => {
        confirmations++
        return new Promise((done) => {
          resolve = done
        })
      },
      discard: () => discarded++,
    })
    const pending = input.invoke("summary")
    await input.invoke("close")
    assert.equal(confirmations, 1)
    assert.equal(discarded, 0)
    resolve(false)
    await pending
    assert.deepEqual(input.events, [["error", ""]])
    assert.equal(input.lock.current, false)
    const busy = exit(name, {
      busy: true,
      confirm: () => {
        throw Error("Busy must not prompt")
      },
    })
    await busy.invoke("close")
    assert.deepEqual(busy.events, [])
  }
})

test("confirmed exit clears the actual retained draft before navigating, while failed discard keeps details open", async () => {
  for (const name of ["training-calendar", "workout-detail-page"]) {
    let discarded = 0
    const confirmed = exit(name, {
      confirm: async () => true,
      discard: () => discarded++,
    })
    await confirmed.invoke("summary")
    assert.equal(discarded, 1)
    assert.ok(
      confirmed.events.some(
        ([key, value]) => key === "dirty" && value === false
      )
    )
    const failed = exit(name, {
      confirm: async () => true,
      discard: () => {
        throw Error("Keep retained recovery")
      },
    })
    await failed.invoke("close")
    assert.deepEqual(failed.events, [
      ["error", ""],
      ["error", "Keep retained recovery"],
    ])
    assert.equal(failed.lock.current, false)
    const clean = exit(name, {
      dirty: false,
      confirm: () => {
        throw Error("Clean must not prompt")
      },
    })
    await clean.invoke("close")
    assert.deepEqual(clean.events, [
      ["error", ""],
      ["close", true],
    ])
  }
})

test("the real details form exposes discard only while mounted and clears totals, text and personal recovery without saving", () => {
  const file = source("desktop-workout-details")
  const effect = find(
    file,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("onDiscardReady?.")
  )
  let discard
  const cleared = []
  const mount = evaluate(file, effect.arguments[0], {
    onDiscardReady: (value) => {
      discard = value
    },
    scope: "owner-A",
    workout: { id: "event:11" },
    clearWorkoutSaveDraft: (...args) => cleared.push(args),
    discardTextDraft: () => cleared.push(["text"]),
    discardPersonalDraft: () => cleared.push(["personal"]),
  })
  const unmount = mount()
  assert.equal(typeof discard, "function")
  assert.deepEqual(cleared, [])
  discard()
  assert.deepEqual(cleared, [
    ["owner-A", "event:11", "totals"],
    ["text"],
    ["personal"],
  ])
  unmount()
  assert.equal(discard, null)
})

test("both actual route guards reject an account change while the discard prompt is open", async () => {
  for (const name of ["training-calendar", "workout-detail-page"]) {
    let resolve
    const input = exit(name, {
      confirm: () =>
        new Promise((done) => {
          resolve = done
        }),
      discard: () => {
        throw Error("Must not discard another account")
      },
    })
    const pending = input.invoke("close")
    input.context.isAccountCurrent = () => false
    resolve(true)
    await pending
    assert.deepEqual(input.events, [["error", ""]])
  }
})

test("actual Details preparation leaves every draft untouched until the shared navigation commit", async () => {
  for (const name of ["training-calendar", "workout-detail-page"]) {
    let discarded = 0
    const input = exit(name, {
      confirm: async () => true,
      discard: () => discarded++,
    })
    assert.equal(await input.context.confirmDetailsExit(), true)
    assert.equal(discarded, 0)
    assert.deepEqual(input.events, [["error", ""]])
    input.context.discardDetailsChanges()
    assert.equal(discarded, 1)
    assert.deepEqual(input.events, [
      ["error", ""],
      ["dirty", false],
    ])
  }
})
