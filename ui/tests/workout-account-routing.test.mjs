import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

function component(path, name, context) {
  const file = ts.createSourceFile(
    path,
    readFileSync(
      new URL(`../src/components/${path}.tsx`, import.meta.url),
      "utf8"
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const node = file.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
  )
  assert.ok(node)
  const declarations = node.getText(file).replace(/^export\s+/, "")
  const javascript = ts.transpileModule(`(${declarations})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  return runInNewContext(javascript, {
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children,
      }),
    },
    ...context,
  })
}

test("both actual workout entry routes place every child under an identity-keyed account boundary", () => {
  for (const [file, name, child] of [
    ["training-calendar", "WorkoutDialog", "TrustedWorkoutDialog"],
    ["workout-detail-page", "WorkoutDetailPage", "TrustedWorkoutDetailPage"],
  ]) {
    const close = () => {},
      workout = { id: "activity:i11", title: "Private workout" },
      guard = () => true
    const render = component(file, name, {
      WorkoutAccountBoundary: "boundary",
      [child]: child,
    })
    const output = render({ workout, onBack: close, onOpenChange: close })
    assert.equal(output.type, "boundary")
    assert.equal(output.props.key, workout.id)
    assert.equal(output.children.length, 1)
    const protectedChild = output.children[0](guard)
    assert.equal(protectedChild.type, child)
    assert.equal(protectedChild.props.isAccountCurrent, guard)
    assert.equal(protectedChild.props.workout, workout)
  }
})

test("the actual revoked boundary never evaluates or retains protected workout children", () => {
  let opened = 0,
    closed = 0
  const render = component(
    "workout-account-boundary",
    "WorkoutAccountBoundary",
    {
      useWorkoutAccountBoundary: () => ({ trusted: false }),
      Dialog: "dialog",
      DialogContent: "content",
      DialogTitle: "title",
      DialogDescription: "description",
      Button: "button",
    }
  )
  const output = render({
    children: () => {
      opened++
      throw Error("Old workout must unmount")
    },
    onClose: () => closed++,
  })
  assert.equal(opened, 0)
  assert.equal(output.type, "dialog")
  const content = output.children[0],
    button = content.children.find((node) => node?.type === "button")
  button.props.onClick()
  assert.equal(closed, 1)
  assert.ok(!JSON.stringify(output).includes("Private workout"))
})

test("the actual Calendar boundary removes all mounted old records before presenting reload", () => {
  const revoked = component("training-calendar", "TrainingCalendar", {
    useWorkoutAccountBoundary: () => ({ trusted: false }),
    Button: "button",
    TrustedTrainingCalendar: "calendar",
  })
  const output = revoked({
    onWorkoutOpen: () => {
      throw Error("Old records must not open")
    },
  })
  assert.equal(output.type, "section")
  assert.equal(output.props["aria-label"], "Reopen calendar")
  assert.ok(!JSON.stringify(output).includes('"type":"calendar"'))
  const trusted = component("training-calendar", "TrainingCalendar", {
    useWorkoutAccountBoundary: () => ({ trusted: true }),
    TrustedTrainingCalendar: "calendar",
  })
  assert.equal(trusted({}).type, "calendar")
})
