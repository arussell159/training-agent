import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { format, isValid, parse } from "date-fns"
import ts from "typescript"

const source = ts.createSourceFile(
  "desktop-strength-date-time.tsx",
  readFileSync(
    new URL(
      "../src/components/desktop-strength-date-time.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const declarations = new Map(),
  pickers = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node))
    declarations.set(node.name.getText(source), node.initializer)
  if (
    ts.isJsxSelfClosingElement(node) &&
    ["DesktopDatePicker", "DesktopTimePicker"].includes(
      node.tagName.getText(source)
    )
  ) {
    pickers.set(
      node.tagName.getText(source),
      new Map(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => [
            attribute.name.getText(source),
            attribute.initializer?.expression,
          ])
      )
    )
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(declarations.get("reportValidity"))
const evaluate = (node, context) =>
  runInNewContext(
    ts.transpileModule(`(${node.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context
  )
function fields({ timeOpen = false } = {}) {
  const guards = [],
    dates = [],
    times = [],
    state = {}
  const context = {
    validity: { current: { date: false, time: false } },
    onValidity: (invalid) => guards.push(invalid),
    setDateDraft: (value) => {
      state.dateDraft = value
    },
    setDateError: (value) => {
      state.dateError = value
    },
    setTimeDraft: (value) => {
      state.timeDraft = value
    },
    setTimeError: (value) => {
      state.timeError = value
    },
    setTimeOpen: (value) => {
      state.timeOpen = value
    },
    onDate: (value) => dates.push(value),
    onTime: (value) => times.push(value),
    format,
    isValid,
    parse,
    reference: new Date(2000, 0, 1, 12),
    time: "09:35",
    timeOpen,
    // Deliberately retain an older valid dateDraft. Error callbacks must use
    // their actual current value, not this previous-render closure.
    dateDraft: new Date(2026, 9, 23),
  }
  context.timeValue = evaluate(declarations.get("timeValue"), context)
  context.reportValidity = evaluate(declarations.get("reportValidity"), context)
  const handlers = (name) =>
    Object.fromEntries(
      Array.from(pickers.get(name))
        .filter(([key]) => key.startsWith("on"))
        .map(([key, expression]) => [key, evaluate(expression, context)])
    )
  return {
    date: handlers("DesktopDatePicker"),
    time: handlers("DesktopTimePicker"),
    guards,
    dates,
    times,
    state,
  }
}

test("an incomplete required date blocks saving synchronously and time cancellation cannot clear its guard", () => {
  const input = fields()
  input.date.onChange(null, { validationError: null })
  assert.equal(
    input.guards.at(-1),
    true,
    "The actual input callback must guard before returning, without a passive effect"
  )
  assert.equal(input.state.dateError, true)
  assert.deepEqual(
    input.dates,
    [],
    "Incomplete typing cannot replace the last committed date"
  )
  input.date.onError(null, null)
  assert.equal(
    input.guards.at(-1),
    true,
    "A previous valid render value cannot clear current required emptiness"
  )
  input.time.onClose()
  assert.equal(input.guards.at(-1), true)
  input.date.onChange(new Date(2026, 9, 23), { validationError: null })
  assert.equal(input.guards.at(-1), false)
  assert.deepEqual(input.dates, ["2026-10-23"])
})

test("invalid time cannot be cleared by correcting another field, while blank and accepted midnight retain their distinct meanings", () => {
  const input = fields()
  input.time.onChange(new Date(NaN), { validationError: null })
  assert.equal(input.guards.at(-1), true)
  assert.deepEqual(input.times, [])
  input.date.onChange(new Date(2026, 9, 23), { validationError: null })
  assert.equal(input.guards.at(-1), true)
  input.time.onError(null, new Date(NaN))
  assert.equal(input.guards.at(-1), true)
  input.time.onChange(null, { validationError: null })
  assert.equal(input.guards.at(-1), false)
  assert.deepEqual(input.times, [""])
  input.time.onAccept(new Date(2000, 0, 1, 0, 0), { validationError: null })
  assert.deepEqual(input.times, ["", "00:00"])
  const popup = fields({ timeOpen: true })
  popup.time.onChange(new Date(2000, 0, 1, 14, 5), { validationError: null })
  popup.time.onClose()
  assert.deepEqual(popup.times, [], "Cancel must not publish the popup draft")
  assert.equal(format(popup.state.timeDraft, "HH:mm"), "09:35")
})
