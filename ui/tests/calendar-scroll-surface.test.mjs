import test from "node:test"
import assert from "node:assert/strict"
import {
  calendarScrollSurface,
  calendarScrollTop,
  calendarScrollTarget,
  scrollCalendarTo,
} from "../src/lib/calendar-scroll-surface.ts"

test("desktop navigation and anchors use the calendar pane rather than the document", () => {
  const previous = globalThis.window,
    documentWrites = [],
    paneWrites = []
  globalThis.window = {
    matchMedia: () => ({ matches: true }),
    scrollY: 0,
    scrollTo: (options) => documentWrites.push(options),
  }
  try {
    const pane = {
      scrollTop: 2400,
      scrollTo: (options) => paneWrites.push(options),
    }
    assert.equal(calendarScrollSurface(pane), pane)
    assert.equal(calendarScrollTarget(pane), pane)
    assert.equal(calendarScrollTop(pane), 2400)
    scrollCalendarTo(pane, { top: 2650, behavior: "instant" })
    assert.deepEqual(paneWrites, [{ top: 2650, behavior: "instant" }])
    assert.deepEqual(documentWrites, [])
  } finally {
    globalThis.window = previous
  }
})

test("mobile keeps document navigation and scroll restoration", () => {
  const previous = globalThis.window,
    writes = []
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    scrollY: 1800,
    scrollTo: (options) => writes.push(options),
  }
  try {
    const pane = {
      scrollTop: 500,
      scrollTo: () => {
        throw Error("Must not scroll an unscrollable mobile pane")
      },
    }
    assert.equal(calendarScrollSurface(pane), null)
    assert.equal(calendarScrollTarget(pane), window)
    assert.equal(calendarScrollTop(pane), 1800)
    scrollCalendarTo(pane, { top: 1200, behavior: "instant" })
    assert.deepEqual(writes, [{ top: 1200, behavior: "instant" }])
  } finally {
    globalThis.window = previous
  }
})

test("a calendar not mounted yet safely falls back to document ownership", () => {
  const previous = globalThis.window
  globalThis.window = { matchMedia: () => ({ matches: true }), scrollY: 30 }
  try {
    assert.equal(calendarScrollSurface(null), null)
    assert.equal(calendarScrollTarget(null), window)
    assert.equal(calendarScrollTop(null), 30)
  } finally {
    globalThis.window = previous
  }
})
