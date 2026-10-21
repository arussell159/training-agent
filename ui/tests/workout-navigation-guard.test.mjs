import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import {
  registerWorkoutNavigationGuard,
  runWithWorkoutNavigationGuard,
  bypassWorkoutNavigationGuard,
  pushWorkoutNavigationState,
  replaceWorkoutNavigationState,
  traverseWorkoutNavigation,
  installWorkoutNavigationBarrier,
} from "../src/lib/workout-navigation-guard.ts"

const flush = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function browser(t, { native = true, initial = "/calendar" } = {}) {
  const previous = globalThis.window,
    window = new EventTarget(),
    navigation = new EventTarget()
  const entries = [
    {
      url: new URL(initial, "https://app.test").href,
      state: { original: "initial" },
    },
  ]
  let position = 0,
    pushes = 0,
    replaces = 0,
    popCalls = 0
  const emit = (type) => {
    if (!native) return
    const event = new Event("currententrychange")
    Object.defineProperty(event, "navigationType", { value: type })
    navigation.dispatchEvent(event)
  }
  Object.defineProperty(navigation, "currentEntry", {
    get: () => ({ index: position }),
  })
  Object.defineProperty(window, "location", {
    get: () => new URL(entries[position].url),
  })
  window.history = {
    get state() {
      return entries[position].state
    },
    get length() {
      return entries.length
    },
    pushState(state, _, url) {
      entries.splice(position + 1)
      entries.push({
        url: url
          ? new URL(url, entries[position].url).href
          : entries[position].url,
        state: structuredClone(state),
      })
      position++
      pushes++
      emit("push")
    },
    replaceState(state, _, url) {
      entries[position] = {
        url: url
          ? new URL(url, entries[position].url).href
          : entries[position].url,
        state: structuredClone(state),
      }
      replaces++
      emit("replace")
    },
    go(delta) {
      const target = position + delta
      if (target < 0 || target >= entries.length) return
      queueMicrotask(() => {
        position = target
        emit("traverse")
        const event = new Event("popstate")
        Object.defineProperty(event, "state", {
          value: entries[position].state,
        })
        window.dispatchEvent(event)
      })
    },
    back() {
      this.go(-1)
    },
    forward() {
      this.go(1)
    },
  }
  window.matchMedia = () => ({ matches: false })
  if (native) window.navigation = navigation
  globalThis.window = window
  const remove = installWorkoutNavigationBarrier(() => popCalls++)
  const unsubscribers = []
  const guard = (...args) => {
    const stop = registerWorkoutNavigationGuard(...args)
    unsubscribers.push(stop)
    return stop
  }
  t.after(() => {
    for (const stop of unsubscribers) stop()
    remove()
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  })
  return {
    window,
    entries,
    guard,
    remove,
    push: (url, state = {}) => pushWorkoutNavigationState(state, url),
    replace: (url, state = {}) => replaceWorkoutNavigationState(state, url),
    get position() {
      return position
    },
    get pushes() {
      return pushes
    },
    get replaces() {
      return replaces
    },
    get popCalls() {
      return popCalls
    },
  }
}

test("ordinary navigation and mobile quick-add actions execute synchronously", async (t) => {
  const f = browser(t),
    seen = []
  runWithWorkoutNavigationGuard(() => seen.push("same tap"))
  assert.deepEqual(seen, ["same tap"])
  const app = ts.createSourceFile(
    "App.tsx",
    readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let callback
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(app) === "selectItem"
    )
      callback = node.initializer.arguments[0].getText(app)
    ts.forEachChild(node, visit)
  }
  visit(app)
  assert.ok(callback)
  const values = {
    runWithWorkoutNavigationGuard,
    pushWorkoutNavigationState,
    window: f.window,
    pageImports: { Nutrition: {} },
    routeItem: () => "Home",
    activeItem: "Home",
    selectedReport: null,
    selectedWorkout: null,
    pendingWorkoutId: null,
    workoutRouteId: () => null,
    nutritionReturnRoute: { current: "Home" },
    routeScrollTarget: { current: 50 },
    workoutReturnRoute: { current: null },
    nutritionQuickAddSequence: { current: 0 },
    preloadPage() {},
    setNavigationItem() {},
    setSelectedReport() {},
    setSelectedWorkout() {},
    setPendingWorkoutId() {},
    setCalendarReturnScroll() {},
    setActiveItem() {},
    setCalendarNavigationVersion() {},
    setNutritionQuickAddRequest: (value) => seen.push(value),
    flushSync: (action) => {
      seen.push("flush")
      action()
    },
    startTransition: (action) => action(),
    itemPath: () => "/nutrition",
  }
  const js = ts.transpileModule(`const callback=${callback}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const select = new Function(...Object.keys(values), js + ";return callback")(
    ...Object.values(values)
  )
  select("Nutrition", true)
  assert.deepEqual(
    seen,
    ["same tap", "flush", 1],
    "The real App callback preserves the original tap/flushSync path"
  )
  assert.equal(f.window.location.pathname, "/nutrition")
  const pushes = f.pushes
  f.guard(async () => false)
  select("Nutrition", true)
  await flush()
  assert.equal(
    f.pushes,
    pushes,
    "A canceled real App callback must not change history"
  )
  assert.deepEqual(
    seen,
    ["same tap", "flush", 1],
    "A canceled callback must not commit quick-add state"
  )
})

test("canceled/failed decisions never run actions; rapid and reentrant attempts do not prompt or navigate twice", async (t) => {
  const f = browser(t),
    answer = deferred(),
    actions = []
  let calls = 0
  const stop = f.guard(async () => {
    calls++
    runWithWorkoutNavigationGuard(() => actions.push("reentrant"))
    return answer.promise
  })
  runWithWorkoutNavigationGuard(() => actions.push("first"))
  runWithWorkoutNavigationGuard(() => actions.push("rapid second"))
  assert.equal(calls, 1)
  assert.deepEqual(actions, [])
  answer.resolve(false)
  await flush()
  assert.deepEqual(actions, [])
  stop()
  const fail = f.guard(async () => {
    throw Error("Discard failed")
  })
  runWithWorkoutNavigationGuard(() => actions.push("failed"))
  await flush()
  assert.deepEqual(actions, [])
  fail()
  f.guard(async () => true)
  runWithWorkoutNavigationGuard(() => actions.push("retry"))
  await flush()
  assert.deepEqual(actions, ["retry"])
})

test("every active layer prepares in priority order and beforeunload warns only actual dirty", async (t) => {
  const f = browser(t),
    calls = []
  let dirty = false
  f.guard(
    async () => {
      calls.push("parent")
      return false
    },
    () => dirty
  )
  f.guard(
    async () => {
      calls.push("editor")
      return true
    },
    () => dirty,
    10
  )
  f.guard(
    async () => {
      calls.push("parent rerender")
      return false
    },
    () => false
  )
  runWithWorkoutNavigationGuard(() => calls.push("navigate"))
  await flush()
  assert.deepEqual(
    calls,
    ["editor", "parent rerender"],
    "A parent veto cannot be skipped by its editor"
  )
  const clean = new Event("beforeunload", { cancelable: true })
  f.window.dispatchEvent(clean)
  assert.equal(clean.defaultPrevented, false)
  dirty = true
  const changed = new Event("beforeunload", { cancelable: true })
  f.window.dispatchEvent(changed)
  assert.equal(changed.defaultPrevented, true)
})

test("child approval followed by parent Cancel leaves every recovery record untouched", async (t) => {
  const f = browser(t),
    calls = [],
    recovery = new Map([
      ["custom", "unsaved definition"],
      ["editor", "unsaved model"],
      ["details", "unsaved notes"],
    ])
  for (const [name, priority] of [
    ["details", 0],
    ["editor", 10],
    ["custom", 20],
  ])
    f.guard(
      async () => {
        calls.push(`prepare:${name}`)
        return name !== "details"
      },
      () => true,
      priority,
      () => {
        calls.push(`commit:${name}`)
        recovery.delete(name)
      }
    )
  runWithWorkoutNavigationGuard(() => calls.push("navigate"))
  await flush()
  assert.deepEqual(calls, [
    "prepare:custom",
    "prepare:editor",
    "prepare:details",
  ])
  assert.equal(recovery.size, 3)
})

test("all layers approve before any cleanup, then commit once before the navigation action", async (t) => {
  const f = browser(t),
    calls = [],
    answer = deferred()
  f.guard(
    async () => {
      calls.push("prepare:details")
      return answer.promise
    },
    () => true,
    0,
    () => calls.push("commit:details")
  )
  f.guard(
    async () => {
      calls.push("prepare:editor")
      return true
    },
    () => true,
    10,
    () => calls.push("commit:editor")
  )
  runWithWorkoutNavigationGuard(() => calls.push("navigate"))
  await flush()
  assert.deepEqual(calls, ["prepare:editor", "prepare:details"])
  runWithWorkoutNavigationGuard(() => calls.push("second action"))
  answer.resolve(true)
  await flush()
  assert.deepEqual(calls, [
    "prepare:editor",
    "prepare:details",
    "commit:editor",
    "commit:details",
    "navigate",
  ])
})

for (const change of ["new", "removed", "replaced"])
  test(`a ${change} participant during confirmation cancels every cleanup`, async (t) => {
    const f = browser(t),
      answer = deferred(),
      calls = []
    const stop = f.guard(
      async () => answer.promise,
      () => true,
      10,
      () => calls.push("editor cleanup")
    )
    f.guard(
      async () => true,
      () => true,
      0,
      () => calls.push("parent cleanup")
    )
    runWithWorkoutNavigationGuard(() => calls.push("navigate"))
    if (change !== "new") stop()
    if (change !== "removed")
      f.guard(
        async () => true,
        () => true,
        10,
        () => calls.push("new cleanup")
      )
    answer.resolve(true)
    await flush()
    assert.deepEqual(calls, [])
  })

test("throwing or busy preparation never commits already-approved child cleanup", async (t) => {
  const f = browser(t),
    calls = []
  const stop = f.guard(
    async () => {
      throw Error("Details busy")
    },
    () => false,
    0,
    () => calls.push("parent cleanup")
  )
  f.guard(
    async () => true,
    () => true,
    10,
    () => calls.push("child cleanup")
  )
  runWithWorkoutNavigationGuard(() => calls.push("navigate"))
  await flush()
  assert.deepEqual(calls, [])
  stop()
  f.guard(
    async () => false,
    () => false,
    20
  )
  runWithWorkoutNavigationGuard(() => calls.push("navigate"))
  await flush()
  assert.deepEqual(calls, [])
})

test("cleanup failure blocks navigation without claiming storage rollback", async (t) => {
  const f = browser(t),
    calls = []
  f.guard(
    async () => true,
    () => true,
    10,
    () => {
      calls.push("failed cleanup")
      throw Error("Recovery storage blocked")
    }
  )
  f.guard(
    async () => true,
    () => true,
    0,
    () => calls.push("parent cleanup")
  )
  runWithWorkoutNavigationGuard(() => calls.push("navigate"))
  await flush()
  assert.deepEqual(calls, ["failed cleanup"])
})

test("browser Back parent veto restores original history and keeps approved child recovery", async (t) => {
  const f = browser(t),
    calls = []
  f.push("/calendar?workout=event:10", { keep: "state" })
  const snapshot = structuredClone(f.entries)
  f.guard(
    async () => true,
    () => true,
    10,
    () => calls.push("child cleanup")
  )
  f.guard(
    async () => false,
    () => true,
    0,
    () => calls.push("parent cleanup")
  )
  f.window.history.back()
  await flush()
  assert.equal(f.position, 1)
  assert.deepEqual(f.entries, snapshot)
  assert.equal(f.popCalls, 0)
  assert.deepEqual(calls, [])
})

for (const native of [true, false])
  test(`Back cancellation restores exact URL/state without duplicate entries (native indices ${native})`, async (t) => {
    const f = browser(t, { native })
    f.push("/calendar?workout=event%3A10", { custom: { keep: 1 } })
    const source = structuredClone(f.entries[1]),
      count = f.pushes,
      length = f.entries.length
    const answer = deferred()
    let calls = 0
    f.guard(async () => {
      calls++
      return answer.promise
    })
    f.window.history.back()
    await flush()
    assert.equal(f.position, 1)
    assert.equal(calls, 1)
    assert.deepEqual(f.entries[1], source)
    answer.resolve(false)
    await flush()
    assert.equal(f.position, 1)
    assert.equal(f.popCalls, 0)
    assert.equal(f.entries.length, length)
    assert.equal(f.pushes, count)
    assert.deepEqual(f.entries[1], source)
  })

test("confirmed Back traverses original entries once and already-confirmed inner close does not prompt twice", async (t) => {
  const f = browser(t)
  f.push("/workout-reports", { compare: "A" })
  f.push("/workout-reports?workout=event:10")
  let calls = 0
  f.guard(async () => {
    calls++
    return true
  })
  traverseWorkoutNavigation(-1)
  await flush()
  assert.equal(calls, 1)
  assert.equal(f.position, 1)
  assert.equal(f.popCalls, 1)
  bypassWorkoutNavigationGuard(() =>
    runWithWorkoutNavigationGuard(() => traverseWorkoutNavigation(-1))
  )
  await flush()
  assert.equal(calls, 1)
  assert.equal(f.position, 0)
  assert.equal(f.popCalls, 2)
  assert.equal(f.entries.length, 3)
})

test("Forward cancellation and later confirmation preserve the original forward entry and state", async (t) => {
  const f = browser(t)
  f.push("/calendar?workout=event:10", { selected: "original" })
  f.window.history.back()
  await flush()
  const target = structuredClone(f.entries[1]),
    answer = deferred()
  const stop = f.guard(async () => answer.promise)
  f.window.history.forward()
  await flush()
  assert.equal(f.position, 0)
  answer.resolve(false)
  await flush()
  assert.equal(f.position, 0)
  assert.deepEqual(f.entries[1], target)
  stop()
  f.guard(async () => true)
  f.window.history.forward()
  await flush()
  assert.equal(f.position, 1)
  assert.deepEqual(f.entries[1], target)
  assert.equal(f.entries.length, 2)
  assert.equal(f.pushes, 1)
})

test("multi-entry traversal and native unmanaged sheet history restore the actual starting index", async (t) => {
  const f = browser(t)
  f.push("/calendar?workout=event:10")
  f.window.history.pushState({ sheet: "first" }, "")
  f.window.history.pushState({ sheet: "second" }, "")
  const original = structuredClone(f.entries),
    count = f.pushes
  f.guard(async () => false)
  f.window.history.go(-3)
  await flush()
  assert.equal(f.position, 3)
  assert.deepEqual(f.entries, original)
  assert.equal(f.pushes, count)
  assert.equal(f.popCalls, 0)
})

test("a browser traversal during a pending sidebar decision is restored before the approved action pushes", async (t) => {
  const f = browser(t),
    answer = deferred()
  f.push("/calendar?workout=event:10")
  f.guard(async () => answer.promise)
  runWithWorkoutNavigationGuard(() => f.push("/settings"))
  f.window.history.back()
  answer.resolve(true)
  await flush()
  assert.equal(f.window.location.pathname, "/settings")
  assert.equal(
    f.entries.length,
    3,
    "Approved navigation starts from the restored workout entry"
  )
  assert.equal(
    new URL(f.entries[1].url).searchParams.get("workout"),
    "event:10"
  )
})

test("barrier cleanup cancels pending navigation and unregister is idempotent", async (t) => {
  const f = browser(t),
    answer = deferred()
  const stop = f.guard(async () => answer.promise)
  let actions = 0
  runWithWorkoutNavigationGuard(() => actions++)
  f.remove()
  stop()
  stop()
  answer.resolve(true)
  await flush()
  assert.equal(actions, 0)
  runWithWorkoutNavigationGuard(() => actions++)
  assert.equal(actions, 1)
})

for (const allowed of [false, true])
  test(`rapid browser attempts retain one immutable first target (allowed ${allowed})`, async (t) => {
    const f = browser(t),
      answer = deferred()
    f.push("/library")
    f.push("/calendar?workout=event:10")
    let calls = 0
    f.guard(async () => {
      calls++
      return answer.promise
    })
    f.window.history.back()
    await flush()
    assert.equal(f.position, 2)
    f.window.history.go(-2)
    await flush()
    assert.equal(f.position, 2)
    answer.resolve(allowed)
    await flush()
    assert.equal(calls, 1)
    assert.equal(f.position, allowed ? 1 : 2)
    assert.equal(f.entries.length, 3)
  })

test("a new higher-priority editor cannot be bypassed by an earlier parent's delayed approval", async (t) => {
  const f = browser(t),
    answer = deferred()
  f.guard(async () => answer.promise)
  let actions = 0
  runWithWorkoutNavigationGuard(() => actions++)
  f.guard(
    async () => false,
    () => true,
    10
  )
  answer.resolve(true)
  await flush()
  assert.equal(actions, 0)
})

test("actual App header projection redacts selected titles after account revocation", () => {
  const app = ts.createSourceFile(
    "App.tsx",
    readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let initializer
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(app) === "workoutTitle"
    )
      initializer = node.initializer.getText(app)
    ts.forEachChild(node, visit)
  }
  visit(app)
  assert.ok(initializer)
  const title = new Function(
    "selectedWorkout",
    "workoutAccountTrusted",
    `return (${initializer})`
  )
  assert.equal(
    title({ title: "Account A private workout" }, true),
    "Account A private workout"
  )
  assert.equal(title({ title: "Account A private workout" }, false), "Workout")
  assert.equal(title(null, false), null)
})

test("unknown unindexed legacy traversal reports the limitation without inventing or overwriting history", async (t) => {
  const f = browser(t, { native: false })
  f.entries[0].state = { unknownLegacy: true }
  f.push("/calendar?workout=event:10")
  // This intentionally removes the old entry's marker: the direction cannot be
  // inferred safely without the native Navigation API.
  f.entries[0].state = { unknownLegacy: true }
  let unavailable = 0
  const app = ts.createSourceFile(
    "App.tsx",
    readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let listenerEffect
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(app) === "useEffect" &&
      node.arguments[0]
        ?.getText(app)
        .includes('"workout-navigation-history-unavailable"')
    )
      listenerEffect = node.arguments[0].getText(app)
    ts.forEachChild(node, visit)
  }
  visit(app)
  assert.ok(listenerEffect)
  const toasts = [],
    js = ts.transpileModule(`const effect=${listenerEffect}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
  const stopToast = new Function(
    "window",
    "toastManager",
    js + ";return effect"
  )(f.window, { add: (value) => toasts.push(value) })()
  t.after(stopToast)
  f.window.addEventListener(
    "workout-navigation-history-unavailable",
    () => unavailable++
  )
  f.guard(async () => false)
  const before = structuredClone(f.entries),
    count = f.pushes,
    replacements = f.replaces
  f.window.history.back()
  await flush()
  assert.equal(unavailable, 1)
  assert.equal(f.popCalls, 0)
  assert.deepEqual(f.entries, before)
  assert.equal(f.pushes, count)
  assert.equal(f.replaces, replacements)
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].title, "Navigation paused")
  assert.match(
    toasts[0].description,
    /current edits are still open.*Save them before reloading/
  )
})
