import test from "node:test"
import assert from "node:assert/strict"
import {
  pendingNutritionWrite,
  rememberNutritionWrite,
  submitNutritionWrite,
  recoverPendingNutritionWrite,
} from "../src/lib/pending-nutrition-write.ts"

function storage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}
const input = {
  date: "2026-10-21",
  action: "add",
  operationId: "nutrition-operation-123",
  revision: 4,
  entries: [
    {
      id: "nutrition-food-123",
      name: "Rice",
      meal: "lunch",
      quantity: 1.25,
      unit: "cup",
      calories: 100,
      protein: 2,
      carbs: 20,
      fat: 1,
      fiber: null,
    },
  ],
}

test("lost server response retains exact intent across reload and replays original ID/revision", async () => {
  const device = storage()
  let commits = 0
  const ids = new Set()
  await assert.rejects(
    submitNutritionWrite(device, "account-a", input, async (row) => {
      ids.add(row.operationId)
      commits++
      throw Error("Connection interrupted after commit")
    })
  )
  const retained = pendingNutritionWrite(device, "account-a")
  assert.deepEqual(retained, input)
  await submitNutritionWrite(device, "account-a", retained, async (row) => {
    if (!ids.has(row.operationId)) commits++
    assert.equal(row.revision, 4)
    return { committed: true, revision: 5, day: null }
  })
  assert.equal(commits, 1)
  assert.equal(pendingNutritionWrite(device, "account-a"), null)
})

test("double submit shares transport and blocks a different uncertain write", async () => {
  const device = storage()
  let finish,
    requests = 0
  const send = () => {
    requests++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = submitNutritionWrite(device, "account-a", input, send)
  const second = submitNutritionWrite(device, "account-a", input, send)
  assert.equal(first, second)
  assert.throws(
    () =>
      rememberNutritionWrite(device, "account-a", {
        ...input,
        operationId: "different-operation",
      }),
    /earlier food save/
  )
  await Promise.resolve()
  assert.equal(requests, 1)
  finish({
    committed: true,
    revision: 5,
    day: { revision: 5, entries: input.entries },
  })
  await first
})

test("private recovery scopes stay isolated and unavailable storage sends nothing", () => {
  const device = storage()
  rememberNutritionWrite(device, "account-a", input)
  assert.equal(pendingNutritionWrite(device, "account-b"), null)
  assert.throws(
    () => rememberNutritionWrite(device, "initial", input),
    /account food log/
  )
  const broken = {
    ...device,
    setItem() {
      throw Error("Quota")
    },
  }
  assert.throws(
    () =>
      submitNutritionWrite(broken, "account-b", input, () =>
        assert.fail("must not send")
      ),
    /no request was sent/
  )
})

test("unconfirmed payload never becomes success; a definitive conflict permits corrected retry", async () => {
  const device = storage()
  await assert.rejects(
    submitNutritionWrite(device, "account-a", input, async () => ({})),
    /not been confirmed/
  )
  assert.deepEqual(pendingNutritionWrite(device, "account-a"), input)
  await assert.rejects(
    submitNutritionWrite(device, "account-a", input, async () => {
      throw Object.assign(Error("Conflict"), { status: 409 })
    }),
    /Conflict/
  )
  assert.equal(pendingNutritionWrite(device, "account-a"), null)
})

test("malformed legacy day never clears retained intent or reports success", async () => {
  const device = storage()
  for (const body of [
    { day: { revision: 5 } },
    { day: { revision: 5, entries: [{}] } },
    { committed: true, revision: 4, day: null },
    { committed: true, day: { revision: 5 } },
  ]) {
    await assert.rejects(
      submitNutritionWrite(device, "account-a", input, async () => body),
      /not been confirmed/
    )
    assert.deepEqual(pendingNutritionWrite(device, "account-a"), input)
  }
  const legacy = { day: { revision: 5, entries: input.entries } }
  assert.deepEqual(
    await submitNutritionWrite(device, "account-a", input, async () => legacy),
    legacy
  )
  assert.equal(pendingNutritionWrite(device, "account-a"), null)
})

test("reload recovery waits for readiness and cannot send private intent after account switch", async () => {
  const device = storage()
  rememberNutritionWrite(device, "account-a", input)
  let current = true,
    ready
  const recovery = recoverPendingNutritionWrite(
    device,
    "account-a",
    () => current,
    () =>
      new Promise((resolve) => {
        ready = resolve
      })
  )
  current = false
  ready(() => assert.fail("old account must not send"))
  assert.equal(await recovery, null)
  assert.deepEqual(pendingNutritionWrite(device, "account-a"), input)
})

test("navigation during recovery keeps commit durable but suppresses stale UI result", async () => {
  const device = storage()
  rememberNutritionWrite(device, "account-a", input)
  let current = true,
    finish
  const recovery = recoverPendingNutritionWrite(
    device,
    "account-a",
    () => current,
    async () => () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await Promise.resolve()
  await Promise.resolve()
  current = false
  finish({ committed: true, revision: 5, day: null })
  assert.equal(await recovery, null)
  assert.equal(pendingNutritionWrite(device, "account-a"), null)
})

test("offline failure survives then reconnect recovery uses the original intent once", async () => {
  const device = storage()
  await assert.rejects(
    submitNutritionWrite(device, "account-a", input, async () => {
      throw Error("Offline")
    })
  )
  const seen = []
  const recovered = await recoverPendingNutritionWrite(
    device,
    "account-a",
    () => true,
    async () => async (payload) => {
      seen.push(payload)
      return { committed: true, revision: 5, day: null }
    }
  )
  assert.deepEqual(recovered, input)
  assert.deepEqual(seen, [input])
  assert.equal(pendingNutritionWrite(device, "account-a"), null)
})
