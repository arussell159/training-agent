import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import {
  apiSessionRevision,
  setApiAuthenticated,
} from "../src/lib/api-client.ts"
import { deviceCacheScope } from "../src/lib/device-cache.ts"

const javascript = ts.transpileModule(
  readFileSync(
    new URL("../src/hooks/use-workout-account-boundary.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText

// Execute the complete production hook and its effects. This small hook runner
// provides lifecycle slots only; native EventTarget dispatches the real events.
function fixture(
  t,
  { authenticated = true, beforeEffects, initialScope = "account-A" } = {}
) {
  const oldWindow = globalThis.window,
    oldStorage = globalThis.localStorage
  const window = new EventTarget(),
    storage = new Map()
  globalThis.window = window
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null }
  const scope = (value) =>
    storage.set(
      "training-agent-startup-v2",
      JSON.stringify({ cache_scope: value })
    )
  scope(initialScope)
  setApiAuthenticated(authenticated, true)
  const slots = [],
    effects = []
  let cursor = 0,
    pending = false,
    active = false,
    output,
    renders = 0
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useRef(initial) {
      const index = cursor++
      return (slots[index] ??= { current: initial })
    },
    useState(initial) {
      const index = cursor++
      slots[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      }
      return [
        slots[index].value,
        (update) => {
          slots[index].value =
            typeof update === "function" ? update(slots[index].value) : update
          pending = true
        },
      ]
    },
    useCallback(callback, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps))
        slots[index] = { value: callback, deps }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index]
        slots[index] = { deps, effect }
        effects.push(() => {
          previous?.cleanup?.()
          slots[index].cleanup = effect()
        })
      }
    },
  }
  const exports = {}
  new Function("require", "exports", javascript)((name) => {
    if (name === "react") return hooks
    if (name === "../lib/api-client") return { apiSessionRevision }
    if (name === "../lib/device-cache") return { deviceCacheScope }
    throw Error(`Unexpected dependency ${name}`)
  }, exports)
  const render = (value = active) => {
    active = value
    pending = false
    cursor = 0
    renders++
    output = exports.useWorkoutAccountBoundary(active)
    return output
  }
  const commit = () => {
    while (effects.length) effects.shift()()
    while (pending) {
      render()
      while (effects.length) effects.shift()()
    }
    return output
  }
  const update = (value) => {
    render(value)
    return commit()
  }
  const event = (type, key) => {
    const event = new Event(type)
    if (type === "storage") Object.defineProperty(event, "key", { value: key })
    window.dispatchEvent(event)
  }
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    for (const slot of slots) slot?.cleanup?.()
  }
  t.after(() => {
    close()
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
    if (oldStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = oldStorage
    setApiAuthenticated(false)
  })
  render(true)
  beforeEffects?.({ scope })
  commit()
  return {
    update,
    render,
    commit,
    event,
    scope,
    close,
    get output() {
      return output
    },
    get pending() {
      return pending
    },
    get renders() {
      return renders
    },
  }
}

test("initial selection captures actual API session/device and unrelated subview renders do not rearm it", (t) => {
  const f = fixture(t),
    initial = f.output.isCurrent
  assert.equal(f.output.trusted, true)
  assert.equal(f.update(true).isCurrent, initial)
  setApiAuthenticated(true, true)
  assert.equal(
    initial(),
    false,
    "Synchronous callback guard sees changed session before an event or render"
  )
  assert.equal(f.update(true).trusted, false)
})

test("account reset revokes synchronously and switching the device scope back cannot restore an active same-ID selection", (t) => {
  const f = fixture(t),
    check = f.output.isCurrent
  f.scope("account-B")
  f.event("training-cache-reset")
  assert.equal(check(), false)
  assert.equal(
    f.pending,
    true,
    "Actual subscribed event schedules render for every subview"
  )
  assert.equal(f.commit().trusted, false)
  f.scope("account-A")
  f.event("training-cache-reset")
  assert.equal(f.commit().trusted, false)
})

test("native storage membership change and storage clear revoke, while unrelated keys do not rerender", (t) => {
  const f = fixture(t)
  f.event("storage", "unrelated-key")
  assert.equal(f.pending, false)
  f.scope("account-B")
  f.event("storage", "training-agent-startup-v2")
  assert.equal(f.output.isCurrent(), false)
  assert.equal(f.commit().trusted, false)
  f.update(false)
  f.update(true)
  assert.equal(f.output.trusted, true)
  f.scope("initial")
  f.event("storage", null)
  assert.equal(f.commit().trusted, false)
})

test("same-scope cache resets and device cache clearing preserve current selection trust", (t) => {
  const f = fixture(t),
    check = f.output.isCurrent
  for (const name of [
    "training-cache-reset",
    "device-cache-cleared",
    "training-context-updated",
  ]) {
    f.event(name)
    assert.equal(f.commit().trusted, true)
    assert.equal(check(), true)
  }
})

test("auth-expiry and cross-tab signout revoke even before auth state subscribers run", (t) => {
  const f = fixture(t)
  f.event("app-auth-required")
  assert.equal(f.output.isCurrent(), false)
  assert.equal(f.commit().trusted, false)
  f.update(false)
  f.update(true)
  assert.equal(f.output.trusted, true)
  f.event("storage", "training-app-signed-out")
  assert.equal(f.commit().trusted, false)
})

test("opening without an authenticated session never adopts a later login while still active", (t) => {
  const f = fixture(t, { authenticated: false })
  assert.equal(f.output.trusted, false)
  setApiAuthenticated(true, true)
  f.event("training-cache-reset")
  assert.equal(f.commit().trusted, false)
  assert.equal(f.update(false).trusted, false)
  assert.equal(f.update(true).trusted, true)
})

test("a callback retained across close and reopen cannot persist a late result under the new selection", async (t) => {
  const f = fixture(t),
    previous = f.output.isCurrent
  let resolve,
    persisted = 0
  const response = new Promise((done) => {
    resolve = done
  })
  const late = (async () => {
    await response
    if (previous()) persisted++
  })()
  assert.equal(f.update(false).trusted, false)
  assert.equal(f.update(true).trusted, true)
  assert.equal(
    previous(),
    false,
    "A new open is distinct even with exactly the same IDs/account"
  )
  resolve()
  await late
  assert.equal(persisted, 0)
  assert.equal(f.output.isCurrent(), true)
})

test("scope changes between render and effect subscription are caught at installation", (t) => {
  const f = fixture(t, { beforeEffects: ({ scope }) => scope("account-B") })
  assert.equal(f.output.trusted, false)
  f.scope("account-A")
  f.event("training-cache-reset")
  assert.equal(f.commit().trusted, false)
})

test("unmount removes real listeners and rejects late callbacks", (t) => {
  const f = fixture(t),
    check = f.output.isCurrent
  f.close()
  f.event("training-cache-reset")
  assert.equal(f.pending, false)
  assert.equal(check(), false)
})

test("normal unmount permits an already-started background save only for its captured account", (t) => {
  const f = fixture(t),
    owner = f.output.ownsAccount,
    visible = f.output.isCurrent
  f.close()
  assert.equal(visible(), false)
  assert.equal(owner(), true)
  f.scope("account-B")
  assert.equal(owner(), false)
  f.scope("account-A")
  assert.equal(
    owner(),
    false,
    "A detected account change permanently revokes even a background continuation"
  )
})

test("background owner callbacks cannot adopt a replacement open token", (t) => {
  const f = fixture(t),
    owner = f.output.ownsAccount
  f.update(false)
  f.update(true)
  assert.equal(owner(), false)
  assert.equal(f.output.ownsAccount(), true)
})

test("an empty-cache bootstrap seals its first provider scope within the same authenticated session", (t) => {
  const f = fixture(t, { initialScope: "initial" })
  assert.equal(f.output.trusted, true)
  f.scope("account-A")
  f.event("training-context-updated")
  assert.equal(
    f.commit().trusted,
    true,
    "A cold Calendar load must not look like an account switch"
  )
  f.scope("initial")
  f.event("training-cache-reset")
  assert.equal(
    f.commit().trusted,
    false,
    "An established owner cannot rearm through an empty cache"
  )
  f.scope("account-A")
  assert.equal(f.output.ownsAccount(), false)
})

test("bootstrap cannot adopt a provider scope after authentication changes", (t) => {
  const f = fixture(t, { initialScope: "initial" })
  setApiAuthenticated(true, true)
  f.scope("account-B")
  assert.equal(f.output.ownsAccount(), false)
})
