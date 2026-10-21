import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import ts from "../node_modules/typescript/lib/typescript.js"
const source = fs.readFileSync(
    new URL("../src/components/workout-editor.tsx", import.meta.url),
    "utf8"
  ),
  file = ts.createSourceFile(
    "workout-editor.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
let initializer
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "canSave")
    initializer = node.initializer?.getText(file)
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(initializer, "Actual editor save gate must be found")
const keys = [
    "saving",
    "recovered",
    "strengthLocalDirty",
    "inputValidity",
    "mobile",
    "personal",
    "dirty",
    "isNew",
    "model",
    "creationAttempted",
    "loaded",
    "validation",
  ],
  gate = new Function(...keys, `return (${initializer})`)
const canSave = (extra) => {
  const state = {
    saving: false,
    recovered: null,
    strengthLocalDirty: false,
    inputValidity: { hasInvalid: false },
    mobile: false,
    personal: { busy: false },
    dirty: false,
    isNew: true,
    model: { strength: { version: 1, blocks: [] } },
    creationAttempted: false,
    loaded: { issues: [] },
    validation: [],
    ...extra,
  }
  return gate(...keys.map((key) => state[key]))
}
test("actual empty Strength save gate disables a pristine draft but permits explicit title/manual edits and immutable pending rechecks", () => {
  assert.equal(canSave({}), false)
  assert.equal(
    canSave({ dirty: true }),
    true,
    "A title-only edit is a real explicit save"
  )
  assert.equal(
    canSave({
      dirty: true,
      model: { strength: { version: 1, blocks: [] }, manualPlanned: true },
    }),
    true,
    "Manual planned values do not require an imaginary exercise"
  )
  assert.equal(
    canSave({ creationAttempted: true }),
    true,
    "A held original empty Strength save must remain recheckable"
  )
  assert.equal(canSave({ saving: true, dirty: true }), false)
  assert.equal(
    canSave({ dirty: true, validation: ["Invalid exercise title"] }),
    false
  )
  assert.equal(canSave({ dirty: true, strengthLocalDirty: true }), false)
  assert.equal(canSave({ dirty: true, personal: { busy: true } }), false)
  assert.equal(canSave({ isNew: false }), false)
  assert.equal(canSave({ isNew: false, dirty: true }), true)
  assert.equal(
    canSave({ model: { strength: { version: 1, blocks: [{}] } } }),
    true,
    "Nonempty generated drafts remain reviewable and saveable"
  )
  assert.equal(
    canSave({ model: { steps: [] } }),
    true,
    "Other workout create flows retain their existing gate"
  )
})

const builderSource = fs.readFileSync(
    new URL("../src/components/desktop-strength-builder.tsx", import.meta.url),
    "utf8"
  ),
  builderFile = ts.createSourceFile(
    "desktop-strength-builder.tsx",
    builderSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
let deleteInitializer
function visitBuilder(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(builderFile) === "deleteWorkout"
  )
    deleteInitializer = node.initializer?.getText(builderFile)
  ts.forEachChild(node, visitBuilder)
}
visitBuilder(builderFile)
assert.ok(deleteInitializer)
let mutateBlocksInitializer
function findBlockMutation(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(builderFile) === "mutateBlocks"
  )
    mutateBlocksInitializer = node.initializer?.getText(builderFile)
  ts.forEachChild(node, findBlockMutation)
}
findBlockMutation(builderFile)
assert.ok(mutateBlocksInitializer, "Actual common block mutation must be found")
test("actual Strength block mutation preserves subtype and time assignment without changing prior snapshots", () => {
  const expression = ts.transpileModule(
    `const update = ${mutateBlocksInitializer}`,
    { compilerOptions: { target: ts.ScriptTarget.ESNext } }
  ).outputText
  for (const subtype of [undefined, "Yoga", "Functional Fitness"]) {
    for (const assigned of [undefined, false, true]) {
      const strength = Object.freeze({
        version: 1,
        blocks: Object.freeze([]),
        ...(subtype ? { subtype } : {}),
        ...(assigned === undefined ? {} : { startTimeAssigned: assigned }),
      })
      const model = Object.freeze({
        name: "Retain header",
        strength,
        steps: Object.freeze([]),
      })
      let result
      const update = new Function(
        "model",
        "onChange",
        `${expression}; return update`
      )(model, (next) => {
        result = next
      })
      const blocks = [{ id: "new-block" }]
      update(blocks)
      assert.equal(result.strength.blocks, blocks)
      assert.equal(result.strength.subtype, subtype)
      assert.equal(result.strength.startTimeAssigned, assigned)
      assert.deepEqual(strength.blocks, [])
      assert.equal(result.steps, model.steps)
    }
  }
})
const deletion = (onDelete) => {
  const state = { busy: false, error: "", open: true },
    inFlight = { current: false }
  const callback = new Function(
    "props",
    "deleteInFlight",
    "setDeleting",
    "setDeleteError",
    "setDeleteOpen",
    `return (${deleteInitializer})`
  )(
    { onDelete },
    inFlight,
    (value) => (state.busy = value),
    (value) => (state.error = value),
    (value) => (state.open = value)
  )
  return { callback, state, inFlight }
}
test("actual Strength deletion awaits the real callback, prevents duplicate writes and only dismisses after successful persistence", async () => {
  let release,
    writes = 0
  const gate = new Promise((resolve) => (release = resolve)),
    run = deletion(async () => {
      writes++
      await gate
    })
  const first = run.callback()
  assert.equal(run.state.busy, true)
  assert.equal(run.state.open, true)
  await run.callback()
  assert.equal(writes, 1)
  release()
  await first
  assert.equal(run.state.open, false)
  assert.equal(run.state.busy, false)
  assert.equal(run.inFlight.current, false)
})
test("actual failed Strength deletion is caught, preserves the open confirmation with an actionable error and permits explicit retry", async () => {
  let writes = 0
  const run = deletion(async () => {
    writes++
    if (writes === 1) throw Error("Provider rejected deletion")
  })
  await run.callback()
  assert.equal(writes, 1)
  assert.equal(run.state.open, true)
  assert.match(run.state.error, /Provider rejected/)
  assert.equal(run.state.busy, false)
  await run.callback()
  assert.equal(writes, 2)
  assert.equal(run.state.open, false)
  assert.equal(run.state.error, "")
})

let strengthDeleteBinding
function findStrengthBinding(node) {
  if (
    (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
    node.tagName.getText(file) === "DesktopStrengthBuilder"
  ) {
    const attribute = node.attributes.properties.find(
      (value) =>
        ts.isJsxAttribute(value) && value.name.getText(file) === "onDelete"
    )
    strengthDeleteBinding = attribute?.initializer?.expression?.getText(file)
  }
  ts.forEachChild(node, findStrengthBinding)
}
findStrengthBinding(file)
assert.ok(
  strengthDeleteBinding,
  "Actual editor-to-Strength deletion binding must be found"
)

test("actual editor-to-Strength callback preserves the pending promise and rejected delete through the common confirmation", async () => {
  let reject,
    writes = 0
  const pending = new Promise((_resolve, fail) => (reject = fail)),
    onDelete = () => {
      writes++
      return pending
    },
    forwarded = workspaceDeleteBinding(onDelete),
    run = deletion(forwarded),
    operation = run.callback()
  assert.equal(writes, 1)
  assert.equal(run.state.busy, true)
  assert.equal(run.state.open, true)
  await run.callback()
  assert.equal(writes, 1)
  reject(Error("Native deletion was rejected"))
  await operation
  assert.equal(run.state.open, true)
  assert.equal(run.state.busy, false)
  assert.match(run.state.error, /Native deletion was rejected/)
})

function workspaceDeleteBinding(onDelete) {
  let initializer
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === "deleteWorkout"
    ) {
      assert.equal(initializer, undefined)
      initializer = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer)
  const javascript = ts.transpileModule(
    `const deleteWorkout=${initializer.getText(file)}; return (${strengthDeleteBinding})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
  return new Function(
    "onDelete",
    "deleteInFlight",
    "saveInFlight",
    "saving",
    "personal",
    "files",
    "editorAccount",
    "setStatus",
    "assertEditorOwner",
    javascript
  )(
    onDelete,
    { current: false },
    { current: false },
    false,
    { busy: false },
    { busy: false },
    { isCurrent: () => true },
    () => {},
    () => {}
  )
}
