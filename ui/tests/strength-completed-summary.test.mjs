import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import React from "../node_modules/react/index.js"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"
import {
  newStrengthExercise,
  newStrengthBlock,
  addStrengthParameter,
  strengthParameterFields,
} from "../../app-backend/lib/workout-strength-model.mjs"
import {
  projectStrengthCompletedSummary,
  strengthRecordedIdentity,
  strengthSummaryDuration,
  isCompletedStrengthWorkout,
} from "../src/lib/strength-completed-summary.ts"

const provenance = {
  sessionRevision: 1,
  deviceScope: "account-A",
  resetVersion: 0,
}

function workout() {
  let exercise = addStrengthParameter(
    newStrengthExercise("Squat"),
    "weight",
    "lb"
  )
  exercise.sets.forEach((set, index) => {
    set.values[exercise.parameters[0].id] = [8, 10, 12][index]
    set.values[exercise.parameters[1].id] = 50
  })
  return {
    id: "event:11",
    activity_id: "i22",
    activity_revision: "first",
    status: "completed",
    sport: "Strength",
    title: "Recorded Strength",
    date: "OCT 20",
    workout_date: "2026-10-20",
    device_name: "Device",
    workout_summary: {
      planned: { duration_seconds: 3600, tss: 60, intensity_factor: 0.9 },
      completed: { duration_seconds: 2816, tss: 30, intensity_factor: 0.59 },
    },
    editor_model: {
      sport: "WeightTraining",
      steps: [],
      strength: { version: 1, blocks: [newStrengthBlock("single", exercise)] },
    },
  }
}
const row = (result, key) => result.rows.find((item) => item.key === key)

test("distinct measured and prescribed totals never turn prescribed sets into performed sets", () => {
  const w = workout(),
    before = structuredClone(w),
    result = projectStrengthCompletedSummary(w)
  assert.deepEqual(row(result, "exercises"), {
    key: "exercises",
    label: "Exercises",
    planned: "1",
    completed: "--",
  })
  assert.equal(row(result, "sets").planned, "3")
  assert.equal(row(result, "reps").planned, "30")
  assert.equal(row(result, "volume").planned, "1,500 lb")
  for (const key of ["sets", "reps", "volume"])
    assert.equal(row(result, key).completed, "--")
  assert.deepEqual(row(result, "duration_seconds"), {
    key: "duration_seconds",
    label: "Duration",
    planned: "01:00:00",
    completed: "00:46:56",
  })
  assert.equal(row(result, "tss").completed, "30")
  assert.equal(row(result, "intensity_factor").completed, "0.59")
  assert.equal(result.actualSetResultsAvailable, false)
  assert.deepEqual(w, before)
})
test("modern null or missing measurements are authoritative over stale legacy and planned values", () => {
  const w = {
    ...workout(),
    actualDurationMinutes: 99,
    plannedDurationMinutes: 88,
    completed_data: { duration_minutes: 77, tss: 100 },
    planned: { tss: 90 },
  }
  for (const summary of [
    { planned: null, completed: null },
    {
      planned: {},
      completed: { duration_seconds: null, tss: null, intensity_factor: null },
    },
  ]) {
    w.workout_summary = summary
    const result = projectStrengthCompletedSummary(w)
    for (const key of ["duration_seconds", "tss", "intensity_factor"]) {
      assert.equal(row(result, key).planned, "--")
      assert.equal(row(result, key).completed, "--")
    }
  }
})
test("zero is a known measurement and empty or invalid prescriptions cannot produce imaginary completed totals", () => {
  const w = workout()
  w.workout_summary = {
    planned: { duration_seconds: 0, tss: 0, intensity_factor: 0 },
    completed: { duration_seconds: 0, tss: 0, intensity_factor: 0 },
  }
  w.editor_model.strength.blocks = []
  const result = projectStrengthCompletedSummary(w)
  assert.equal(row(result, "exercises").planned, "0")
  assert.equal(row(result, "reps").planned, "--")
  assert.equal(row(result, "volume").planned, "--")
  assert.equal(row(result, "duration_seconds").completed, "00:00:00")
  assert.equal(row(result, "tss").completed, "0")
  assert.equal(row(result, "intensity_factor").completed, "0.00")
  w.editor_model.strength.blocks = [{}]
  const invalid = projectStrengthCompletedSummary(w)
  assert.equal(invalid.prescriptionUnavailable, true)
  assert.equal(row(invalid, "sets").planned, "--")
  assert.equal(row(invalid, "sets").completed, "--")
})
test("separate lb/kg subtotals remain separate and ambiguous per-side prescriptions have unknown volume", () => {
  const w = workout(),
    extra = newStrengthExercise("Press")
  const metric = addStrengthParameter(extra, "weight", "kg")
  metric.sets.forEach((set) => {
    set.values[metric.parameters[0].id] = 5
    set.values[metric.parameters[1].id] = 20
  })
  w.editor_model.strength.blocks.push(newStrengthBlock("single", metric))
  assert.equal(
    row(projectStrengthCompletedSummary(w), "volume").planned,
    "1,500 lb / 300 kg"
  )
  metric.parameters[1].kind = "weightPerSide"
  w.editor_model.strength.blocks[1] = newStrengthBlock("single", metric)
  assert.equal(row(projectStrengthCompletedSummary(w), "volume").planned, "--")
})
test("recording snapshots bind all identities and their nulls replace stale context; provider-only legacy rows have no planned session", () => {
  const w = workout(),
    snapshot = {
      ...provenance,
      workoutId: w.id,
      activityId: w.activity_id,
      activityRevision: "first",
      values: { duration_seconds: 10, tss: null, intensity_factor: null },
    }
  assert.equal(
    row(
      projectStrengthCompletedSummary(w, snapshot, provenance),
      "duration_seconds"
    ).completed,
    "00:00:10"
  )
  assert.equal(
    row(projectStrengthCompletedSummary(w, snapshot, provenance), "tss")
      .completed,
    "--"
  )
  for (const mismatch of [
    { workoutId: "event:12" },
    { activityId: "i23" },
    { activityRevision: "second" },
  ]) {
    assert.equal(
      row(
        projectStrengthCompletedSummary(
          w,
          { ...snapshot, ...mismatch },
          provenance
        ),
        "duration_seconds"
      ).completed,
      "00:46:56"
    )
  }
  const provider = {
    ...w,
    id: "activity:i22",
    workout_summary: undefined,
    editor_model: undefined,
    actualDurationMinutes: 2.5,
    completed_data: { tss: 0 },
    plannedDurationMinutes: 0,
    kg_lifted: 5000,
  }
  const result = projectStrengthCompletedSummary(provider)
  assert.equal(row(result, "duration_seconds").completed, "00:02:30")
  assert.equal(row(result, "duration_seconds").planned, "--")
  assert.equal(row(result, "tss").completed, "0")
  for (const key of ["sets", "reps", "volume", "exercises"])
    assert.equal(row(result, key).completed, "--")
  assert.equal(strengthRecordedIdentity(provider).activityId, "i22")
})
test("negative nonfinite and nonnumeric inputs stay unknown; planned rows never become actual and clocks retain long durations", () => {
  for (const value of [-1, NaN, Infinity, "30", null, undefined])
    assert.equal(strengthSummaryDuration(value), "--")
  assert.equal(strengthSummaryDuration(90061), "25:01:01")
  const w = workout()
  w.status = "upcoming"
  for (const key of ["duration_seconds", "tss", "intensity_factor"])
    assert.equal(row(projectStrengthCompletedSummary(w), key).completed, "--")
})

test("completed Strength routing uses authoritative sport identity rather than a title or a broad display hint", () => {
  const cases = [
    [
      {
        ...workout(),
        editor_model: undefined,
        sport: "Run",
        title: "Strength",
      },
      false,
    ],
    [{ ...workout(), status: "upcoming" }, false],
    [
      {
        ...workout(),
        editor_model: undefined,
        sport: "WeightTraining",
        id: "activity:i22",
      },
      true,
    ],
    [{ ...workout(), editor_model: undefined, sport: "weights" }, true],
    [{ ...workout(), editor_model: undefined, sport: "strength" }, true],
    [
      {
        ...workout(),
        editor_model: undefined,
        sport: "Strength",
        provider_type: "Run",
      },
      false,
    ],
    [
      {
        ...workout(),
        editor_model: { sport: "Run" },
        provider_type: "WeightTraining",
      },
      false,
    ],
    [workout(), true],
    [
      { ...workout(), editor_model: undefined, sport: "Hybrid Strength" },
      false,
    ],
  ]
  for (const [input, expected] of cases)
    assert.equal(isCompletedStrengthWorkout(input), expected)
})

test("same recording IDs cannot reuse snapshots from a different session, device scope or reset generation", () => {
  const w = workout(),
    snapshot = {
      ...provenance,
      workoutId: w.id,
      activityId: w.activity_id,
      activityRevision: "first",
      values: { duration_seconds: 5, tss: 7 },
    }
  for (const changed of [
    { sessionRevision: 2 },
    { deviceScope: "account-B" },
    { resetVersion: 1 },
    { sessionRevision: null },
  ]) {
    const result = projectStrengthCompletedSummary(
      w,
      snapshot,
      { ...provenance, ...changed },
      false
    )
    assert.equal(
      row(result, "duration_seconds").completed,
      "--",
      "Old snapshot and old context are both withheld after reset"
    )
    assert.equal(row(result, "tss").completed, "--")
  }
  assert.equal(
    row(
      projectStrengthCompletedSummary(w, snapshot, provenance, false),
      "duration_seconds"
    ).completed,
    "00:00:05"
  )
  assert.equal(
    row(
      projectStrengthCompletedSummary(w, snapshot, undefined, false),
      "duration_seconds"
    ).completed,
    "--",
    "An unbound snapshot has no provenance proof"
  )
})

const source = fs.readFileSync(
    new URL(
      "../src/components/desktop-strength-completed.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  file = ts.createSourceFile(
    "completed.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
function compiled(name, scope, callback = false) {
  let code
  function visit(node) {
    if (!callback && ts.isFunctionDeclaration(node) && node.name?.text === name)
      code = node.getText(file)
    if (
      callback &&
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === name
    )
      code = `const ${name}=${node.initializer.getText(file)}`
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(code, `${name} must be the actual component implementation`)
  const js = ts.transpileModule(code, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return new Function(
    "require",
    "exports",
    ...Object.keys(scope),
    js + `;return ${name}`
  )(
    createRequire(new URL("../package.json", import.meta.url)),
    {},
    ...Object.values(scope)
  )
}
test("actual read-only content labels prescriptions and unknown results without result-entry or fabricated save controls", () => {
  const Component = compiled("StrengthCompletedSummaryContent", {
      projectStrengthCompletedSummary,
      strengthParameterFields,
    }),
    html = renderToStaticMarkup(
      React.createElement(Component, { workout: workout() })
    )
  assert.match(html, /Planned and completed Strength values/)
  assert.match(html, /Completed exercise results are unavailable/)
  assert.match(html, /Prescribed sets: Squat/)
  assert.match(html, /00:46:56/)
  assert.match(html, /Weight \(lb\)/)
  assert.doesNotMatch(
    html,
    /<input|<select|<button[^>]*>Save\b|Edit Workout|Last Completed|Compliance|1RM/
  )
})
test("actual summary request aborts stale source response and preserves existing data on a failure", async () => {
  let code
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect"
    )
      code = node.arguments[0].getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  const calls = [],
    snapshots = [],
    states = [],
    identity = {
      binding: "binding-A",
      workoutId: "event:1",
      activityId: "i1",
      activityRevision: "one",
      workout: { status: "completed" },
    },
    loader = (...args) =>
      new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
    make = (values) =>
      new Function(...Object.keys(values), `return (${code})`)(
        ...Object.values(values)
      ),
    dependencies = {
      ...identity,
      ...provenance,
      contextTrusted: true,
      resetGeneration: { current: 0 },
      activeRequest: { current: null },
      apiSessionRevision: () => 1,
      deviceCacheScope: () => "account-A",
      loadActivitySummary: loader,
      setSnapshot: (v) => snapshots.push(v),
      setRequest: (v) => states.push(v),
    }
  const cleanup = make(dependencies)()
  cleanup()
  calls[0].resolve({ duration_seconds: 999 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls[0].args[2].aborted, true)
  assert.deepEqual(snapshots, [])
  const cleanupB = make({
    ...dependencies,
    binding: "binding-B",
    workoutId: "event:2",
    activityId: "i2",
  })()
  calls[1].reject(Error("Actual read rejected"))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    snapshots,
    [],
    "A failed refresh must not clear or fabricate recorded values"
  )
  assert.equal(states.at(-1).binding, "binding-B")
  assert.equal(states.at(-1).error, "Actual read rejected")
  cleanupB()
})

test("actual reset subscription cancels an old-scope read and refuses same-ID new-account lookup until a fresh parent remount", async () => {
  const effects = []
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect"
    )
      effects.push(node.arguments[0].getText(file))
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(effects.length, 2)
  const make = (code, values) => {
      const js = ts.transpileModule(`const effect=${code}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText
      return new Function(...Object.keys(values), js + ";return effect")(
        ...Object.values(values)
      )
    },
    calls = [],
    snapshots = [],
    versions = [],
    states = [],
    events = new EventTarget(),
    resetGeneration = { current: 0 },
    activeRequest = { current: null },
    contextRevoked = { current: false }
  let session = 1,
    scope = "account-A"
  const dependencies = {
    window: events,
    resetGeneration,
    activeRequest,
    contextRevoked,
    initialScope: { current: { sessionRevision: 1, deviceScope: "account-A" } },
    setSnapshot: (value) => snapshots.push(value),
    setResetVersion: (value) => versions.push(value),
    binding: "A",
    workoutId: "event:11",
    activityId: "i22",
    activityRevision: "first",
    workout: { status: "completed" },
    sessionRevision: 1,
    contextTrusted: true,
    deviceScope: "account-A",
    resetVersion: 0,
    apiSessionRevision: () => session,
    deviceCacheScope: () => scope,
    ownsAccount: () => session === 1 && scope === "account-A",
    setRequest: (value) => states.push(value),
    loadActivitySummary: (...args) =>
      new Promise((resolve) => calls.push({ args, resolve })),
  }
  const stopListening = make(effects[0], dependencies)(),
    stopA = make(effects[1], dependencies)()
  const unrelated = new Event("storage")
  Object.defineProperty(unrelated, "key", { value: "unrelated-key" })
  events.dispatchEvent(unrelated)
  assert.equal(versions.length, 0)
  session = 2
  scope = "account-B"
  events.dispatchEvent(new Event("training-cache-reset"))
  assert.equal(calls[0].args[2].aborted, true)
  assert.deepEqual(versions, [1])
  assert.equal(
    contextRevoked.current,
    true,
    "Account changes require a new parent mount, even if that account is switched back later"
  )
  assert.deepEqual(snapshots, [null])
  calls[0].resolve({ duration_seconds: 999 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    snapshots,
    [null],
    "Late successful transport cannot resurrect the old account's values"
  )
  stopA()
  const untrustedB = make(effects[1], {
    ...dependencies,
    binding: "B",
    sessionRevision: 2,
    deviceScope: "account-B",
    resetVersion: 1,
    contextTrusted: false,
  })()
  assert.equal(untrustedB, undefined)
  assert.equal(
    calls.length,
    1,
    "No new account lookup may use the previous parent's recording ID"
  )
  const stopB = make(effects[1], {
    ...dependencies,
    binding: "B-remount",
    sessionRevision: 2,
    deviceScope: "account-B",
    resetVersion: 0,
    resetGeneration: { current: 0 },
    contextTrusted: true,
  })()
  calls[1].resolve({ duration_seconds: 20, tss: 0 })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(snapshots.at(-1), {
    workoutId: "event:11",
    activityId: "i22",
    activityRevision: "first",
    sessionRevision: 2,
    deviceScope: "account-B",
    resetVersion: 0,
    values: { duration_seconds: 20, tss: 0 },
  })
  assert.equal(
    row(
      projectStrengthCompletedSummary(
        workout(),
        snapshots.at(-1),
        { sessionRevision: 2, deviceScope: "account-B", resetVersion: 0 },
        false
      ),
      "duration_seconds"
    ).completed,
    "00:00:20"
  )
  stopB()
  stopListening()
  events.dispatchEvent(new Event("device-cache-cleared"))
  assert.deepEqual(versions, [1], "Unmount removes reset listeners")
})

test("actual DialogContent keyboard boundary blocks parent/browser Save and leaves Escape's default action available", () => {
  let handler
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "onKeyDown")
      handler = node.initializer.expression.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(handler)
  const js = ts.transpileModule(`const handler=${handler}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    boundary = new Function(js + ";return handler")()
  for (const event of [
    { key: "s", ctrlKey: true },
    { key: "S", metaKey: true },
    { key: "Escape" },
    { key: "Enter" },
  ]) {
    let stopped = 0,
      prevented = 0
    boundary({
      ...event,
      stopPropagation() {
        stopped++
      },
      preventDefault() {
        prevented++
      },
    })
    assert.equal(stopped, 1)
    assert.equal(prevented, event.ctrlKey || event.metaKey ? 1 : 0)
  }
})
test("actual Files callback blocks duplicate requests, awaits success and retains an actionable rejection", async () => {
  let reject,
    count = 0
  const statuses = [],
    errors = [],
    actionBusy = { current: false },
    files = compiled(
      "files",
      {
        onFiles: () => {
          count++
          return new Promise((_, no) => {
            reject = no
          })
        },
        actionBusy,
        setFilesBusy: (v) => statuses.push(v),
        setActionError: (v) => errors.push(v),
      },
      true
    )
  const first = files()
  await files()
  assert.equal(count, 1)
  assert.equal(actionBusy.current, true)
  reject(Error("Files unavailable"))
  await first
  assert.deepEqual(statuses, [true, false])
  assert.equal(errors.at(-1), "Files unavailable")
  assert.equal(actionBusy.current, false)
})

test("actual modal exposes only supplied actions and composes real detail dialogs inside its content", () => {
  const Content = compiled("StrengthCompletedSummaryContent", {
      projectStrengthCompletedSummary,
      strengthParameterFields,
    }),
    wrapper = ({ children }) => React.createElement("div", null, children),
    icon = () => React.createElement("svg"),
    Component = compiled("DesktopStrengthCompleted", {
      useState: React.useState,
      useEffect: React.useEffect,
      useRef: React.useRef,
      useWorkoutAccountBoundary: () => ({
        trusted: true,
        ownsAccount: () => true,
      }),
      strengthRecordedIdentity,
      apiSessionRevision: () => 1,
      deviceCacheScope: () => "account-A",
      cachedActivitySummary: () => null,
      loadActivitySummary: () => {
        throw Error("SSR must not fetch")
      },
      Dialog: wrapper,
      DialogContent: ({ children }) =>
        React.createElement("div", { "data-content": "true" }, children),
      DialogTitle: wrapper,
      DialogDescription: wrapper,
      StrengthCompletedSummaryContent: Content,
      Dumbbell: icon,
      Paperclip: icon,
      X: icon,
      History: icon,
    })
  const basic = renderToStaticMarkup(
    React.createElement(Component, { workout: workout(), onClose() {} })
  )
  assert.match(basic, /Close completed Strength workout/)
  assert.doesNotMatch(
    basic,
    /Analyze Recording|Notes and Details|>Files<|>Exercise History</
  )
  const composed = renderToStaticMarkup(
    React.createElement(Component, {
      workout: workout(),
      onClose() {},
      onFiles() {},
      onAnalyze() {},
      onDetails() {},
      onHistory() {},
      details: React.createElement("p", null, "Real personal fields"),
      fileDialogs: React.createElement("section", null, "Actual file dialog"),
    })
  )
  assert.match(composed, /Analyze Recording/)
  assert.match(composed, /Notes and Details/)
  assert.match(composed, /Files/)
  assert.match(composed, /Exercise History/)
  assert.match(composed, /aria-label="Workout details"><p>Real personal fields/)
  assert.match(composed, /Actual file dialog/)
  assert.doesNotMatch(composed, /Edit Workout|>Save<|Last Completed/)
})

test("actual changed-account modal reveals no old workout context and offers only Close", () => {
  const wrapper = ({ children }) => React.createElement("div", null, children),
    icon = () => React.createElement("svg")
  for (const current of [
    { sessionRevision: 2, deviceScope: "account-A" },
    { sessionRevision: 1, deviceScope: "account-B" },
    { sessionRevision: null, deviceScope: "account-A" },
  ]) {
    const Component = compiled("DesktopStrengthCompleted", {
        useWorkoutAccountBoundary: () => ({
          trusted:
            current.sessionRevision === 1 &&
            current.deviceScope === "account-A",
          ownsAccount: () =>
            current.sessionRevision === 1 &&
            current.deviceScope === "account-A",
        }),
        useState: React.useState,
        useEffect: React.useEffect,
        useRef: (value) =>
          React.useRef(
            value &&
              typeof value === "object" &&
              Object.hasOwn(value, "sessionRevision")
              ? { sessionRevision: 1, deviceScope: "account-A" }
              : value
          ),
        strengthRecordedIdentity,
        apiSessionRevision: () => current.sessionRevision,
        deviceCacheScope: () => current.deviceScope,
        cachedActivitySummary: () => {
          throw Error(
            "An old recording ID cannot be looked up under a changed account"
          )
        },
        loadActivitySummary: () => {
          throw Error("An old recording cannot be fetched")
        },
        Dialog: wrapper,
        DialogContent: wrapper,
        DialogTitle: wrapper,
        DialogDescription: wrapper,
        StrengthCompletedSummaryContent: () => {
          throw Error("Old private prescription must not render")
        },
        Dumbbell: icon,
        Paperclip: icon,
        X: icon,
        History: icon,
      }),
      html = renderToStaticMarkup(
        React.createElement(Component, {
          workout: workout(),
          onClose() {},
          onAnalyze() {},
          onDetails() {},
          onHistory() {},
          onFiles() {},
          details: React.createElement("p", null, "PRIVATE NOTES"),
          fileDialogs: React.createElement("p", null, "PRIVATE FILES"),
        })
      )
    assert.match(html, /connected account changed/)
    assert.match(html, /Close completed Strength workout/)
    assert.equal((html.match(/<button/g) || []).length, 1)
    assert.doesNotMatch(
      html,
      /Recorded Strength|2026-10-20|Squat|PRIVATE NOTES|PRIVATE FILES|00:46:56|Analyze Recording|Notes and Details|Exercise History/
    )
  }
})
