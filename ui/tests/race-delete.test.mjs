import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

const parse = (name) =>
  ts.createSourceFile(
    name,
    readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
const file = parse("race-events.tsx"),
  declarations = new Map()
let dismiss, actionClick, actionDisabled, cancelDisabled
function attributes(node, name) {
  return node.attributes.properties
    .find(
      (value) => ts.isJsxAttribute(value) && value.name.getText(file) === name
    )
    ?.initializer?.expression?.getText(file)
}
function visit(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "RaceCalendarCard"
  ) {
    const walk = (child) => {
      if (ts.isVariableDeclaration(child))
        declarations.set(
          child.name.getText(file),
          child.initializer?.getText(file)
        )
      if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
        if (child.tagName.getText(file) === "AlertDialog")
          dismiss = attributes(child, "onOpenChange")
        if (child.tagName.getText(file) === "AlertDialogAction") {
          actionClick = attributes(child, "onClick")
          actionDisabled = attributes(child, "disabled")
        }
        if (child.tagName.getText(file) === "AlertDialogCancel")
          cancelDisabled = attributes(child, "disabled")
      }
      ts.forEachChild(child, walk)
    }
    walk(node)
  } else ts.forEachChild(node, visit)
}
visit(file)
assert.ok(declarations.get("deleteRace"))
assert.ok(declarations.get("requestDelete"))
assert.ok(dismiss)
assert.ok(actionClick)
function harness(onDelete) {
  const state = { busy: false, error: "", open: true },
    inFlight = { current: false }
  const setDeleting = (value) => {
      state.busy = value
    },
    setDeleteError = (value) => {
      state.error = value
    },
    setDeleteOpen = (value) => {
      state.open = value
    }
  const remove = new Function(
    "onDelete",
    "deleteInFlight",
    "setDeleting",
    "setDeleteError",
    "setDeleteOpen",
    `return (${declarations.get("deleteRace")})`
  )(onDelete, inFlight, setDeleting, setDeleteError, setDeleteOpen)
  return {
    state,
    inFlight,
    remove,
    dismiss: new Function(
      "deleteInFlight",
      "setDeleteOpen",
      `return (${dismiss})`
    )(inFlight, setDeleteOpen),
    request: new Function(
      "disabled",
      "deleteInFlight",
      "setDeleteError",
      "setDeleteOpen",
      `return (${declarations.get("requestDelete")})`
    )(false, inFlight, setDeleteError, setDeleteOpen),
    click: new Function("deleteRace", `return (${actionClick})`)(remove),
  }
}
test("actual race deletion waits for persistence, prevents duplicate writes and blocks dismissal while pending", async () => {
  let release,
    writes = 0
  const gate = new Promise((resolve) => {
      release = resolve
    }),
    run = harness(async () => {
      writes++
      await gate
    })
  const first = run.remove()
  assert.equal(run.state.busy, true)
  assert.equal(run.state.open, true)
  run.dismiss(false)
  run.request()
  await run.remove()
  assert.equal(run.state.open, true)
  assert.equal(writes, 1)
  release()
  await first
  assert.equal(run.state.open, false)
  assert.equal(run.state.busy, false)
  assert.equal(run.inFlight.current, false)
})
test("actual rejected race deletion retains confirmation and error, then permits one explicit successful retry", async () => {
  let writes = 0
  const run = harness(async () => {
    if (++writes === 1) throw Error("Native Event deletion rejected")
  })
  await run.remove()
  assert.equal(run.state.open, true)
  assert.equal(run.state.busy, false)
  assert.equal(run.inFlight.current, false)
  assert.match(run.state.error, /Native Event deletion rejected/)
  await run.remove()
  assert.equal(writes, 2)
  assert.equal(run.state.open, false)
  assert.equal(run.state.error, "")
})
test("actual synchronous non-Error deletion failure is caught without dismissing or leaving busy state stuck", async () => {
  const run = harness(() => {
    throw "denied"
  })
  await run.remove()
  assert.equal(run.state.open, true)
  assert.equal(run.state.busy, false)
  assert.equal(run.inFlight.current, false)
  assert.match(run.state.error, /could not be deleted/)
})
test("actual Delete click prevents automatic close and both confirmation controls disable during the submitted request", async () => {
  let release,
    prevented = false
  const gate = new Promise((resolve) => {
      release = resolve
    }),
    run = harness(() => gate)
  run.click({
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(run.state.open, true)
  assert.equal(run.state.busy, true)
  assert.equal(
    new Function("disabled", "deleting", `return (${actionDisabled})`)(
      false,
      true
    ),
    true
  )
  assert.equal(
    new Function("deleting", `return (${cancelDisabled})`)(true),
    true
  )
  release()
  await gate
  await Promise.resolve()
  assert.equal(run.state.open, false)
})
const calendar = parse("training-calendar.tsx")
let deleteBinding
function findBinding(node) {
  if (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    node.tagName.getText(calendar) === "RaceCalendarCard"
  )
    deleteBinding = node.attributes.properties
      .find(
        (value) =>
          ts.isJsxAttribute(value) &&
          value.name.getText(calendar) === "onDelete"
      )
      ?.initializer?.expression?.getText(calendar)
  ts.forEachChild(node, findBinding)
}
findBinding(calendar)
assert.ok(deleteBinding)
test("actual Calendar-to-Race JSX binding forwards the parent promise so its rejection reaches retained confirmation", async () => {
  let reject, action
  const parent = new Promise((_resolve, no) => {
    reject = no
  })
  const binding = new Function("onAction", `return (${deleteBinding})`)(
    (value) => {
      action = value
      return parent
    }
  )
  assert.equal(binding(), parent)
  assert.equal(action, "delete")
  const run = harness(binding),
    pending = run.remove()
  assert.equal(run.state.open, true)
  assert.equal(run.state.busy, true)
  reject(Error("Calendar Event provider write rejected"))
  await pending
  assert.equal(run.state.open, true)
  assert.match(run.state.error, /provider write rejected/)
  assert.equal(run.state.busy, false)
})
