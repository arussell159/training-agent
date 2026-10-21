import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const file = ts.createSourceFile(
  "strength-exercise-library.tsx",
  readFileSync(
    new URL("../src/components/strength-exercise-library.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
function find(predicate) {
  let found
  const visit = (node) => {
    if (predicate(node)) found = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found)
  return found
}
const evaluate = (node, context) =>
  runInNewContext(
    ts.transpileModule(`(${node.getText(file)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { Error, ...context }
  )
function fixture(extra = {}) {
  const events = [],
    context = {
      definitionAccount: { isCurrent: () => true },
      mounted: { current: true },
      saving: { current: false },
      busy: false,
      attempt: null,
      dirty: true,
      navigationDiscard: { current: null },
      setDiscard: (value) => events.push(["dialog", value]),
      setError: (value) => events.push(["error", value]),
      onClose: () => events.push(["close"]),
      ...extra,
    }
  const callback = (name) =>
    evaluate(
      find(
        (node) =>
          ts.isVariableDeclaration(node) && node.name.getText(file) === name
      ).initializer,
      context
    )
  context.onDiscardOpenChange = callback("onDiscardOpenChange")
  return {
    context,
    events,
    request: callback("requestDefinitionNavigation"),
    confirm: callback("confirmDefinitionDiscard"),
    cancel: context.onDiscardOpenChange,
  }
}

test("actual definition guard blocks pending/busy/revoked layers and preserves uncertain identity", async () => {
  for (const extra of [
    { busy: true },
    { saving: { current: true } },
    { definitionAccount: { isCurrent: () => false } },
    { mounted: { current: false } },
  ]) {
    const f = fixture(extra)
    assert.equal(await f.request(), false)
    assert.deepEqual(f.events, [])
  }
  const pending = { creationId: "immutable-operation" },
    f = fixture({ attempt: pending })
  assert.equal(await f.request(), false)
  assert.equal(f.context.attempt, pending)
  assert.match(f.events[0][1], /Recheck its retained save/)
})

test("actual definition Cancel preserves inputs and dirty approval cannot close or discard before parent decisions", async () => {
  const f = fixture(),
    first = f.request()
  assert.equal(
    await f.request(),
    false,
    "Only the first pending decision owns its resolver"
  )
  f.cancel(false)
  assert.equal(await first, false)
  assert.equal(f.context.dirty, true)
  const second = f.request()
  f.confirm()
  assert.equal(await second, true)
  assert.equal(
    f.context.dirty,
    true,
    "Approval has no data-clearing side effect"
  )
  assert.ok(!f.events.some(([type]) => type === "close"))
})

test("actual local definition discard closes only its dialog, and changed account rejects pending consent", async () => {
  const local = fixture()
  local.confirm()
  assert.deepEqual(local.events, [["dialog", false], ["close"]])
  const changed = fixture(),
    pending = changed.request()
  changed.context.definitionAccount.isCurrent = () => false
  changed.confirm()
  assert.equal(await pending, false)
  assert.ok(!changed.events.some(([type]) => type === "close"))
  assert.equal(await fixture({ dirty: false }).request(), true)
})

test("actual definition registration uses its own layer and unmount cancels its pending decision", async () => {
  const f = fixture(),
    pending = f.request(),
    calls = []
  const effect = find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]
        ?.getText(file)
        .includes("registerWorkoutNavigationGuard")
  )
  const cleanup = evaluate(effect.arguments[0], {
    ...f.context,
    definitionNavigation: { current: { dirty: true, decide: f.request } },
    registerWorkoutNavigationGuard: (guard, dirty, priority) => {
      calls.push({ guard, dirty, priority })
      return () => calls.push("unregister")
    },
  })()
  assert.equal(calls[0].priority, 20)
  assert.equal(calls[0].dirty(), true)
  cleanup()
  assert.equal(await pending, false)
  assert.equal(calls[1], "unregister")
})
