import assert from "node:assert/strict"
import test from "node:test"
import { restoreReportReader } from "../src/lib/report-navigation.ts"

const query = (value) => {
  globalThis.window = { location: { search: `?report=${encodeURIComponent(JSON.stringify(value))}` } }
}

test("valid weekly and annual-plan reader links restore only their supported fields", () => {
  query({ kind: "weekly", startDate: "2024-02-29", extra: "ignored" })
  assert.deepEqual(restoreReportReader(), { kind: "weekly", startDate: "2024-02-29" })
  query({ kind: "block", startDate: "2026-10-06", planId: "fixture-plan" })
  assert.deepEqual(restoreReportReader(), { kind: "block", startDate: "2026-10-06", planId: "fixture-plan" })
})

test("impossible and normalized-overflow dates cannot open a report", () => {
  for (const startDate of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-10-6", "2026-10-06T00:00:00Z", null, {}, 20261006]) {
    query({ kind: "weekly", startDate })
    assert.equal(restoreReportReader(), null, JSON.stringify(startDate))
  }
})

test("malformed reader metadata and missing links safely fall back to the routed page", () => {
  for (const value of [null, [], {}, { kind: "unknown", startDate: "2026-10-06" }, { kind: "block", startDate: "2026-10-06" }, { kind: "block", startDate: "2026-10-06", planId: {} }]) {
    query(value)
    assert.equal(restoreReportReader(), null)
  }
  for (const search of ["", "?report={broken", "?report=null"]) {
    globalThis.window = { location: { search } }
    assert.equal(restoreReportReader(), null)
  }
})
