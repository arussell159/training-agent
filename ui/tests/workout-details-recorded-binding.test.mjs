import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"
import {
  completedValueDraft,
  changedCompletedValues,
} from "../src/lib/completed-workout-values.ts"
import { mergeLoadedPlannedDraft } from "../src/lib/planned-workout-values.ts"

const code = fs.readFileSync(
    new URL("../src/components/desktop-workout-details.tsx", import.meta.url),
    "utf8"
  ),
  file = ts.createSourceFile(
    "details.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
function find(predicate) {
  let found
  function visit(node) {
    if (predicate(node)) found = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found, "The actual Details binding must exist")
  return found
}
function expression(name) {
  return find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name
  ).initializer.getText(file)
}
function evaluate(text, scope) {
  const js = ts.transpileModule(`const value=${text}`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  return new Function(
    "require",
    "exports",
    ...Object.keys(scope),
    js + ";return value"
  )(
    createRequire(new URL("../package.json", import.meta.url)),
    {},
    ...Object.values(scope)
  )
}
const merge = (values) => evaluate(expression("completed"), values),
  networkEffect = find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("void loadActivitySummary(")
  ).arguments[0].getText(file),
  resetEffect = find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("setRecordedEpoch(")
  ).arguments[0].getText(file),
  settle = () => new Promise((resolve) => setImmediate(resolve))
function fixture() {
  const calls = [],
    snapshots = [],
    statuses = [],
    epochs = [],
    events = new EventTarget(),
    live = { session: 1, scope: "account-A" },
    state = {
      window: events,
      activityId: "i22",
      activityRevision: "R1",
      recordedTrusted: true,
      recordedSession: 1,
      recordedScope: "account-A",
      recordedEpoch: 0,
      recordedBinding: "A-R1",
      ownsAccount: () => live.session === 1 && live.scope === "account-A",
      recordedGeneration: { current: 0 },
      recordedRequest: { current: null },
      apiSessionRevision: () => live.session,
      deviceCacheScope: () => live.scope,
      setDownloaded: (value) => snapshots.push(value),
      setRecordedStatus: (value) => statuses.push(value),
      setRecordedEpoch: (value) => epochs.push(value),
      loadActivitySummary: (...args) =>
        new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
    }
  return {
    calls,
    snapshots,
    statuses,
    epochs,
    events,
    state,
    live,
    request: (extra) => evaluate(networkEffect, { ...state, ...extra })(),
    listen: () => evaluate(resetEffect, state)(),
  }
}

test("actual binding includes workout and activity identity, revision, session, device scope and reset epoch", () => {
  const values = {
      workout: { id: "event:11" },
      activityId: "i22",
      activityRevision: "R1",
      recordedSession: 1,
      recordedScope: "A",
      recordedEpoch: 0,
    },
    key = evaluate(expression("recordedBinding"), values)
  for (const changed of [
    { workout: { id: "event:12" } },
    { activityId: "i23" },
    { activityRevision: "R2" },
    { recordedSession: 2 },
    { recordedScope: "B" },
    { recordedEpoch: 1 },
  ]) {
    assert.notEqual(
      evaluate(expression("recordedBinding"), { ...values, ...changed }),
      key
    )
  }
})

test("deferred completed snapshot updates preserve typing without turning untouched derived readings into writes", () => {
  const effect = find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]
        ?.getText(file)
        .includes("completedSavedRef.current = next")
  ).arguments[0].getText(file)
  const old = completedValueDraft(
    {
      duration_seconds: 1080,
      distance_meters: 1609.344,
      average_speed: 1609.344 / 1080,
    },
    "Run"
  )
  const remote = {
    duration_seconds: 1080,
    distance_meters: 1609.344,
    average_speed: null,
  }
  for (const typed of [false, true]) {
    const reference = { current: old },
      queue = []
    let saved
    evaluate(effect, {
      completedValueDraft,
      mergeLoadedPlannedDraft,
      completedSnapshot: JSON.stringify(remote),
      sport: "Run",
      completedSavedRef: reference,
      setCompletedDraft: (updater) => queue.push(updater),
      setCompletedSaved: (next) => {
        saved = next
      },
    })()
    assert.equal(reference.current.average_speed, "")
    assert.equal(queue.length, 1)
    // WebKit/concurrent React can defer this until after the ref has advanced.
    const merged = queue[0]({
      ...old,
      ...(typed ? { distance_meters: "1.25" } : {}),
    })
    assert.equal(
      merged.average_speed,
      "",
      "Untouched old pace is replaced by the authoritative snapshot"
    )
    assert.deepEqual(
      changedCompletedValues(merged, saved, "Run"),
      typed ? { distance_meters: 2011.68 } : {}
    )
  }
})
test("production merge refuses stale R1 even when R2 is missing or explicitly null and never patches a downloaded snapshot with stale fields", () => {
  const base = {
    recordedTrusted: true,
    recordedBinding: "R2",
    workout: {
      workout_summary: {
        completed: { duration_seconds: null, tss: 0, average_hr: 90 },
      },
    },
    downloaded: {
      binding: "R1",
      values: { duration_seconds: 999, tss: 60, average_hr: 180 },
    },
  }
  assert.deepEqual(merge(base), {
    duration_seconds: null,
    tss: 0,
    average_hr: 90,
  })
  assert.deepEqual(
    merge({ ...base, workout: { workout_summary: { completed: null } } }),
    {}
  )
  assert.deepEqual(
    merge({
      ...base,
      downloaded: { binding: "R2", values: { duration_seconds: 0, tss: null } },
    }),
    { duration_seconds: 0, tss: null }
  )
  assert.deepEqual(
    merge({ ...base, recordedTrusted: false }),
    {},
    "Old account context is not an actual fallback"
  )
})
test("actual R1 effect cannot publish after a same-ID R2 read supersedes it, and a failed R2 read surfaces an error without replacing current context", async () => {
  const f = fixture(),
    cleanupR1 = f.request()
  cleanupR1()
  const cleanupR2 = f.request({
    activityRevision: "R2",
    recordedBinding: "A-R2",
  })
  f.calls[0].resolve({ duration_seconds: 999, tss: 60 })
  f.calls[1].reject(Error("Current recording unavailable"))
  await settle()
  assert.equal(f.calls[0].args[2].aborted, true)
  assert.deepEqual(f.snapshots, [])
  assert.deepEqual(f.statuses.at(-1), {
    binding: "A-R2",
    loading: false,
    error: "Current recording unavailable",
  })
  assert.deepEqual(
    merge({
      recordedTrusted: true,
      recordedBinding: "A-R2",
      downloaded: { binding: "A-R1", values: { duration_seconds: 999 } },
      workout: {
        workout_summary: { completed: { duration_seconds: 20, tss: null } },
      },
    }),
    { duration_seconds: 20, tss: null }
  )
  cleanupR2()
})
test("actual scope-reset subscription aborts old reads, same-owner reset can refresh, and late cross-account results are rejected", async () => {
  const f = fixture(),
    stop = f.listen(),
    cleanupR1 = f.request()
  f.events.dispatchEvent(new Event("device-cache-cleared"))
  assert.equal(f.calls[0].args[2].aborted, true)
  assert.deepEqual(f.epochs, [1])
  assert.deepEqual(f.snapshots, [null])
  f.calls[0].resolve({ duration_seconds: 999 })
  await settle()
  assert.deepEqual(f.snapshots, [null])
  cleanupR1()
  const cleanupFresh = f.request({
    recordedEpoch: 1,
    recordedBinding: "A-epoch1",
  })
  f.calls[1].resolve({ duration_seconds: 0, tss: 0 })
  await settle()
  assert.deepEqual(f.snapshots.at(-1), {
    binding: "A-epoch1",
    values: { duration_seconds: 0, tss: 0 },
  })
  cleanupFresh()
  const cleanupPending = f.request({
    recordedEpoch: 1,
    recordedBinding: "A-late",
  })
  f.live.session = 2
  f.live.scope = "account-B"
  f.calls[2].resolve({ duration_seconds: 888 })
  await settle()
  assert.equal(
    f.snapshots.length,
    2,
    "Changed credentials reject late success even without a reset event"
  )
  const trusted = evaluate(expression("recordedTrusted"), {
    ownsAccount: f.state.ownsAccount,
  })
  assert.equal(trusted, false)
  assert.equal(f.request({ recordedTrusted: trusted }), undefined)
  assert.equal(
    f.calls.length,
    3,
    "No old recording lookup under a different owner"
  )
  cleanupPending()
  stop()
  f.events.dispatchEvent(new Event("training-cache-reset"))
  assert.deepEqual(f.epochs, [1], "Unmount removes subscriptions")
})
test("actual refresh error rendering exposes Retry and its callback schedules one explicit retry without a save action", () => {
  const node = find(
      (node) =>
        ts.isJsxExpression(node) &&
        node.expression
          ?.getText(file)
          .startsWith("recordedStatus.binding === recordedBinding") &&
        node.expression.getText(file).includes("Retry completed values")
    ),
    rendered = evaluate(node.expression.getText(file), {
      recordedStatus: { binding: "R2", error: "Refresh denied" },
      recordedBinding: "R2",
      setRecordedRetry() {},
    }),
    html = renderToStaticMarkup(rendered)
  assert.match(html, /role="alert"/)
  assert.match(html, /Refresh denied/)
  assert.match(html, /type="button"/)
  assert.match(html, /Retry completed values/)
  assert.doesNotMatch(html, /Save|type="submit"/)
  let retries = 3
  const handler = find(
      (node) =>
        ts.isJsxAttribute(node) &&
        node.name.getText(file) === "onClick" &&
        node.initializer?.getText(file).includes("setRecordedRetry")
    ),
    retry = evaluate(handler.initializer.expression.getText(file), {
      setRecordedRetry: (update) => {
        retries = update(retries)
      },
    })
  retry()
  assert.equal(retries, 4)
  assert.equal(
    evaluate(node.expression.getText(file), {
      recordedStatus: { binding: "R1", error: "Old source failed" },
      recordedBinding: "R2",
    }),
    false
  )
})
