type Registration = {
  guard: () => Promise<boolean>
  dirty?: () => boolean
  priority: number
  commit?: () => void
}
type Marker = { version: 1; session: string; index: number }
type Entry = {
  url: string
  state: unknown
  marker: Marker
  native: number | null
}
type NativeNavigation = EventTarget & { currentEntry?: { index: number } }
const KEY = "__workoutNavigation"
const registrations: Registration[] = []
let bypass = 0
let pending: object | null = null
let controller: {
  pushed: () => void
  replaced: () => void
  permit: (delta: number) => void
  settle: (action: () => void) => void
} | null = null

const capture = () =>
  registrations
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value.priority - a.value.priority || b.index - a.index)
    .map(({ value }) => value)
const currentParticipants = (captured: Registration[]) =>
  captured.length === registrations.length &&
  captured.every((value) => registrations.includes(value))

/** Prepare every active layer without deleting recovery; commit only after all approve. */
export function registerWorkoutNavigationGuard(
  prepare: () => Promise<boolean>,
  isDirty?: () => boolean,
  priority = 0,
  commit?: () => void
): () => void {
  const registration = { guard: prepare, dirty: isDirty, priority, commit }
  registrations.push(registration)
  return () => {
    const index = registrations.indexOf(registration)
    if (index !== -1) registrations.splice(index, 1)
  }
}

async function prepare(captured: Registration[]) {
  try {
    for (const registration of captured) {
      if (
        !currentParticipants(captured) ||
        (await registration.guard()) !== true ||
        !currentParticipants(captured)
      )
        return false
    }
    return currentParticipants(captured)
  } catch {
    return false
  }
}
function commit(captured: Registration[]) {
  if (!currentParticipants(captured)) return false
  try {
    for (const registration of captured) registration.commit?.()
    return true
  } catch {
    // A caller's cleanup must surface its failure and retain the in-memory
    // draft. Cleanup callbacks are synchronous; this is not a storage transaction.
    return false
  }
}

/** Only use after the calling view has already confirmed this exact exit. */
export function bypassWorkoutNavigationGuard(action: () => void): void {
  bypass++
  try {
    action()
  } finally {
    bypass--
  }
}

/** No Promise/microtask on the ordinary path: mobile tap focus stays synchronous. */
export function runWithWorkoutNavigationGuard(action: () => void): void {
  if (bypass) {
    action()
    return
  }
  if (pending) return
  const captured = capture()
  if (!captured.length) {
    action()
    return
  }
  const attempt = {}
  pending = attempt
  void prepare(captured).then((allowed) => {
    const finish = () => {
      if (pending !== attempt) return
      const committed = allowed && commit(captured)
      pending = null
      if (committed) bypassWorkoutNavigationGuard(action)
    }
    if (controller) controller.settle(finish)
    else finish()
  })
}

function marker(state: unknown): Marker | null {
  const value =
    state && typeof state === "object"
      ? (state as Record<string, unknown>)[KEY]
      : null
  if (!value || typeof value !== "object") return null
  const checked = value as Marker
  return checked.version === 1 &&
    typeof checked.session === "string" &&
    checked.session.length > 0 &&
    Number.isSafeInteger(checked.index)
    ? checked
    : null
}
function stateWith(state: unknown, value: Marker) {
  return {
    ...(state && typeof state === "object" && !Array.isArray(state)
      ? state
      : {}),
    [KEY]: value,
  }
}
function currentMarker(): Marker {
  return (
    marker(window.history.state) ?? {
      version: 1,
      session: crypto.randomUUID(),
      index: 0,
    }
  )
}
function nativeNavigation() {
  return (window as Window & { navigation?: NativeNavigation }).navigation
}
function nativeIndex() {
  const index = nativeNavigation()?.currentEntry?.index
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0
    ? index
    : null
}
function entry(): Entry {
  return {
    url: window.location.href,
    state: window.history.state,
    marker: currentMarker(),
    native: nativeIndex(),
  }
}
function distance(from: Entry, to: Entry): number | null {
  if (from.native !== null && to.native !== null) return to.native - from.native
  const target = marker(to.state)
  return target?.session === from.marker.session
    ? target.index - from.marker.index
    : null
}

export function pushWorkoutNavigationState(state: unknown, url: string): void {
  const previous = currentMarker()
  window.history.pushState(
    stateWith(state, { ...previous, index: previous.index + 1 }),
    "",
    url
  )
  controller?.pushed()
}
export function replaceWorkoutNavigationState(
  state: unknown,
  url: string
): void {
  window.history.replaceState(stateWith(state, currentMarker()), "", url)
  controller?.replaced()
}
export function traverseWorkoutNavigation(delta: number): void {
  if (!Number.isSafeInteger(delta) || !delta) return
  runWithWorkoutNavigationGuard(() => {
    controller?.permit(delta)
    window.history.go(delta)
  })
}

/** App owns this subscription; no global History method monkeypatch. */
export function installWorkoutNavigationBarrier(onPop: () => void): () => void {
  const initial = currentMarker()
  window.history.replaceState(
    stateWith(window.history.state, initial),
    "",
    window.location.href
  )
  let accepted = entry()
  let traversal: {
    attempt: object
    source: Entry
    target: Entry
    registrations: Registration[]
    stage: "restoring" | "confirming" | "leaving"
    deciding: boolean
    approved: boolean | null
  } | null = null
  let permitted: number | null = null
  let restoringAction: Entry | null = null
  let afterRestore: (() => void) | null = null
  let live = true
  const local = {
    pushed: () => {
      accepted = entry()
    },
    replaced: () => {
      accepted = entry()
    },
    permit: (delta: number) => {
      permitted = nativeIndex() ?? currentMarker().index
      permitted += delta
    },
    settle: (action: () => void) => {
      if (restoringAction) afterRestore = action
      else action()
    },
  }
  controller = local
  const accept = () => {
    accepted = entry()
    onPop()
  }
  const restore = () => {
    if (!traversal) return
    const delta = distance(entry(), traversal.source)
    if (delta !== null && delta !== 0) window.history.go(delta)
  }
  const confirm = () => {
    const current = traversal
    if (!current || current.deciding) return
    current.deciding = true
    current.stage = "confirming"
    void prepare(current.registrations).then((allowed) => {
      if (!live || traversal !== current || pending !== current.attempt) return
      current.approved = allowed
      finishTraversal()
    })
  }
  const finishTraversal = () => {
    const current = traversal
    if (!current || current.approved === null) return
    if (distance(entry(), current.source) !== 0) {
      restore()
      return
    }
    const delta = distance(entry(), current.target)
    if (
      !current.approved ||
      delta === null ||
      !delta ||
      !commit(current.registrations)
    ) {
      traversal = null
      pending = null
      return
    }
    current.stage = "leaving"
    window.history.go(delta)
  }
  const pop = (event: Event) => {
    const arrived = entry()
    if (bypass) {
      accept()
      return
    }
    const coordinate = arrived.native ?? marker(arrived.state)?.index
    if (permitted !== null && coordinate === permitted) {
      permitted = null
      accept()
      return
    }
    if (traversal) {
      const current = traversal
      if (
        current.stage === "leaving" &&
        distance(arrived, current.target) === 0
      ) {
        traversal = null
        pending = null
        accept()
        return
      }
      event.stopImmediatePropagation()
      if (distance(arrived, current.source) === 0) {
        if (current.stage === "restoring") confirm()
        else if (current.stage === "confirming") finishTraversal()
      } else restore()
      return
    }
    if (restoringAction && distance(arrived, restoringAction) === 0) {
      event.stopImmediatePropagation()
      restoringAction = null
      const ready = afterRestore
      afterRestore = null
      ready?.()
      return
    }
    const captured = capture()
    if (!captured.length && !pending) {
      accept()
      return
    }
    event.stopImmediatePropagation()
    const delta = distance(accepted, arrived)
    if (!captured.length || pending) {
      if (delta !== null && delta) {
        restoringAction = accepted
        window.history.go(-delta)
      }
      return
    }
    if (delta === null || !delta) {
      // Unknown pre-upgrade same-document entries have no dependable direction.
      // Never overwrite/push a fabricated replacement or guess a history.go.
      window.dispatchEvent(new Event("workout-navigation-history-unavailable"))
      return
    }
    const attempt = {}
    pending = attempt
    traversal = {
      attempt,
      source: accepted,
      target: arrived,
      registrations: captured,
      stage: "restoring",
      deciding: false,
      approved: null,
    }
    restore()
  }
  const unload = (event: BeforeUnloadEvent) => {
    const dirty = registrations.some((value) => {
      try {
        return value.dirty?.() === true
      } catch {
        return false
      }
    })
    if (dirty) {
      event.preventDefault()
      event.returnValue = ""
    }
  }
  const changed = (event: Event) => {
    // Observe unmanaged same-URL sheets on browsers with Navigation API support.
    const type = (event as Event & { navigationType?: string }).navigationType
    if (!traversal && (type === "push" || type === "replace"))
      accepted = entry()
  }
  window.addEventListener("popstate", pop, true)
  window.addEventListener("beforeunload", unload)
  const navigation = nativeNavigation()
  navigation?.addEventListener("currententrychange", changed)
  return () => {
    live = false
    pending = null
    traversal = null
    window.removeEventListener("popstate", pop, true)
    window.removeEventListener("beforeunload", unload)
    navigation?.removeEventListener("currententrychange", changed)
    if (controller === local) controller = null
  }
}
