import test from "node:test"
import assert from "node:assert/strict"
import { installRouteScrollRestoration } from "../src/lib/route-scroll-restoration.ts"

function browser() {
  const window = new EventTarget()
  const state = (index) => ({
    __workoutNavigation: { version: 1, session: "test-session", index },
    preserved: "guard and overlay metadata",
  })
  window.history = { state: state(0), scrollRestoration: "auto" }
  window.scrollY = 0
  const frames = new Map()
  let sequence = 0
  window.requestAnimationFrame = (callback) => {
    frames.set(++sequence, callback)
    return sequence
  }
  window.cancelAnimationFrame = (id) => frames.delete(id)
  const tracker = installRouteScrollRestoration(window)
  return {
    window,
    tracker,
    frames,
    scroll(top) {
      window.scrollY = top
      window.dispatchEvent(new Event("scroll"))
    },
    push(index) {
      window.dispatchEvent(new Event("workout-navigation-before-push"))
      window.history.state = state(index)
      window.dispatchEvent(new Event("workout-navigation-pushed"))
    },
    pop(index) {
      window.history.state = state(index)
      return tracker.restore()
    },
  }
}

test("Back and Forward restore each history entry, while fresh visits start at zero", () => {
  const view = browser()
  view.scroll(640)
  view.push(1)
  view.window.scrollY = 0
  view.scroll(1100)
  assert.equal(view.pop(0), 640)
  view.window.scrollY = 640
  assert.equal(view.pop(1), 1100)
  view.window.scrollY = 1100
  view.push(2)
  view.window.scrollY = 0
  assert.equal(view.pop(2), 0)
  assert.equal(
    view.window.history.state.preserved,
    "guard and overlay metadata"
  )
  view.tracker.dispose()
})

test("new navigation after Back cannot inherit a discarded forward entry's scroll", () => {
  const view = browser()
  view.scroll(100)
  view.push(1)
  view.window.scrollY = 900
  assert.equal(view.pop(0), 100)
  view.window.scrollY = 100
  view.push(1)
  view.window.scrollY = 0
  assert.equal(view.pop(1), 0)
  view.tracker.dispose()
})

test("scroll capture coalesces into one frame and navigation flushes its latest position", () => {
  const view = browser()
  assert.equal(view.window.history.scrollRestoration, "manual")
  for (let position = 1; position <= 40; position++) view.scroll(position)
  assert.equal(view.frames.size, 1)
  view.push(1)
  assert.equal(view.frames.size, 0)
  view.window.scrollY = 0
  assert.equal(view.pop(0), 40)
  view.tracker.dispose()
  assert.equal(view.window.history.scrollRestoration, "auto")
  view.scroll(90)
  assert.equal(view.frames.size, 0)
})
