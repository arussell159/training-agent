import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clearPageSnapshots,
  pageSnapshotFresh,
  pageSnapshotRevision,
  readPageSnapshot,
  writePageSnapshot,
} from "../src/lib/page-snapshots.ts"

test("returning to a page can paint saved data while it refreshes", () => {
  clearPageSnapshots()
  const value = { reports: [{ title: "Week report" }] }
  writePageSnapshot("coach", value, pageSnapshotRevision())
  assert.equal(readPageSnapshot("coach"), value)
  assert.equal(pageSnapshotFresh("coach"), true)
  assert.equal(readPageSnapshot("library"), null)
})

test("logout clears snapshots and an old response cannot repopulate them", () => {
  clearPageSnapshots()
  const beforeLogout = pageSnapshotRevision()
  writePageSnapshot("coach", { reports: [1] }, beforeLogout)
  clearPageSnapshots()
  writePageSnapshot("coach", { reports: [2] }, beforeLogout)
  assert.equal(readPageSnapshot("coach"), null)
  assert.equal(pageSnapshotFresh("coach"), false)
  writePageSnapshot("coach", { reports: [] }, pageSnapshotRevision())
  assert.deepEqual(readPageSnapshot("coach"), { reports: [] })
})

test("stale display data is retained while the freshness window expires", () => {
  clearPageSnapshots()
  const clock = Date.now
  let time = 100000
  Date.now = () => time
  try {
    writePageSnapshot("library", ["Swim"], pageSnapshotRevision())
    time += 31000
    assert.equal(pageSnapshotFresh("library"), false)
    assert.deepEqual(readPageSnapshot("library"), ["Swim"])
  } finally {
    Date.now = clock
  }
})
