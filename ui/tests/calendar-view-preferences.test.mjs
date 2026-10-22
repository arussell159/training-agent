import test from "node:test"
import assert from "node:assert/strict"
import {
  readCalendarViewPreferences,
  saveCalendarViewPreferences,
} from "../src/lib/calendar-view-preferences.ts"

test("calendar display preferences stay isolated by account and never need a network request", () => {
  const previous = globalThis.localStorage,
    values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  try {
    const defaults = {
      summaryOpen: true,
      showProfiles: true,
      showMetrics: true,
    }
    assert.deepEqual(readCalendarViewPreferences("account-a"), defaults)
    const saved = { summaryOpen: false, showProfiles: false, showMetrics: true }
    saveCalendarViewPreferences("account-a", saved)
    assert.deepEqual(readCalendarViewPreferences("account-a"), saved)
    assert.deepEqual(readCalendarViewPreferences("account-b"), defaults)
    values.set(
      "calendar-view:v1:account-b",
      JSON.stringify({ summaryOpen: "false", showMetrics: false })
    )
    assert.deepEqual(readCalendarViewPreferences("account-b"), {
      ...defaults,
      showMetrics: false,
    })
  } finally {
    globalThis.localStorage = previous
  }
})

test("blocked or malformed preference storage cannot break the Calendar", () => {
  const previous = globalThis.localStorage
  try {
    globalThis.localStorage = {
      getItem: () => "{",
      setItem: () => {
        throw Error("Storage blocked")
      },
    }
    assert.deepEqual(readCalendarViewPreferences("a"), {
      summaryOpen: true,
      showProfiles: true,
      showMetrics: true,
    })
    assert.doesNotThrow(() =>
      saveCalendarViewPreferences("a", {
        summaryOpen: false,
        showProfiles: true,
        showMetrics: true,
      })
    )
    globalThis.localStorage = {
      getItem: () => {
        throw Error("Storage blocked")
      },
    }
    assert.equal(readCalendarViewPreferences("a").summaryOpen, true)
  } finally {
    globalThis.localStorage = previous
  }
})
