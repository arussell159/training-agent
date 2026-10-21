import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import ts from "typescript"

const file = ts.createSourceFile(
  "personal.tsx",
  readFileSync(
    new URL(
      "../src/components/desktop-workout-personal-fields.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const component = file.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "WorkoutAttachments"
)
assert.ok(component)
const js = ts.transpileModule(
  component.getText(file).replace(/^export\s+/, ""),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
    },
  }
).outputText
function fixture(options = {}) {
  const calls = [],
    attachment = { id: "file-1", name: "original.txt", size: 1024 },
    input = { current: { click: () => calls.push("picker") } },
    icon = () => null
  const render = new Function(
    "require",
    "exports",
    "useRef",
    "Loader2",
    "Paperclip",
    "Download",
    "Trash2",
    js + ";return WorkoutAttachments"
  )(
    createRequire(new URL("../package.json", import.meta.url)),
    {},
    () => input,
    icon,
    icon,
    icon,
    icon
  )
  const personal = {
    busy: false,
    loading: false,
    error: "An earlier upload failed",
    attachments: [attachment],
    attach: async (file) => calls.push(["attach", file]),
    downloadAttachment: async (file) => calls.push(["download", file]),
    removeAttachment: async (file) => calls.push(["remove", file]),
    reload: () => calls.push("reload"),
    ...options.personal,
  }
  const tree = render({ ...options, personal }),
    nodes = []
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (node && typeof node === "object" && node.props) {
      nodes.push(node)
      visit(node.props.children)
    }
  }
  visit(tree)
  return { calls, attachment, nodes, personal }
}

test("every actual attachment input/action is disabled by pending, busy or loading state", () => {
  for (const options of [
    { disabled: true },
    { personal: { busy: true } },
    { personal: { loading: true } },
  ]) {
    const f = fixture(options),
      controls = f.nodes.filter(
        (node) => node.type === "button" || node.type === "input"
      )
    assert.equal(controls.length, 5)
    for (const control of controls)
      assert.equal(
        control.props.disabled,
        true,
        `${control.type} ${control.props["aria-label"] || control.props.title || "file"}`
      )
    const hidden = controls.find((node) => node.type === "input")
    assert.equal(hidden.props.type, "file")
    assert.equal(hidden.props.hidden, true)
  }
})

test("actual locked handlers reject a delayed picker result and cannot invoke attachment operations", () => {
  const f = fixture({ disabled: true })
  for (const button of f.nodes.filter((node) => node.type === "button"))
    button.props.onClick()
  const input = f.nodes.find((node) => node.type === "input"),
    event = { target: { files: [{ name: "late.txt" }], value: "chosen" } }
  input.props.onChange(event)
  assert.deepEqual(f.calls, [])
  assert.equal(
    event.target.value,
    "",
    "The same file may be selected after the lock clears"
  )
})

test("actual unlocked attachment controls retain their file identities and operation behavior", () => {
  const f = fixture(),
    file = { name: "new.txt" }
  for (const button of f.nodes.filter((node) => node.type === "button")) {
    assert.equal(button.props.disabled, false)
    button.props.onClick()
  }
  f.nodes
    .find((node) => node.type === "input")
    .props.onChange({ target: { files: [file], value: "chosen" } })
  assert.deepEqual(f.calls, [
    "picker",
    ["download", f.attachment],
    ["remove", f.attachment],
    "reload",
    ["attach", file],
  ])
})
