import test from "node:test"
import assert from "node:assert/strict"
import {
  readNutritionComposerDraft,
  writeNutritionComposerDraft,
  clearNutritionComposerDraft,
  getNutritionComposerStorage,
} from "../src/lib/nutrition-composer-draft.ts"
import { readFile } from "node:fs/promises"
const storage = () => {
  const rows = new Map()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: (key) => rows.delete(key),
  }
}
const draft = {
  date: "2026-10-21",
  meal: "lunch",
  savedAt: 100,
  query: "rice",
  text: "",
  draft: [],
  pane: "browse",
  product: null,
  customId: null,
  customName: "",
  ingredients: null,
  operationId: "operation-stable",
}
test("unfinished input and its original operation restore only for the intended account, date and meal", () => {
  const store = storage()
  writeNutritionComposerDraft(store, "account-a", draft)
  assert.deepEqual(
    readNutritionComposerDraft(store, "account-a", draft.date, "lunch", 200),
    draft
  )
  assert.equal(
    readNutritionComposerDraft(store, "account-b", draft.date, "lunch", 200),
    null
  )
  assert.equal(
    readNutritionComposerDraft(store, "account-a", "2026-10-22", "lunch", 200),
    null
  )
  assert.equal(
    readNutritionComposerDraft(store, "account-a", draft.date, "dinner", 200),
    null
  )
  clearNutritionComposerDraft(store, "account-a", draft.date, "lunch")
  assert.equal(
    readNutritionComposerDraft(store, "account-a", draft.date, "lunch", 200),
    null
  )
})
test("expired or malformed drafts do not reopen a broken editor and empty input clears recovery", () => {
  const store = storage()
  writeNutritionComposerDraft(store, "a", draft)
  assert.equal(
    readNutritionComposerDraft(
      store,
      "a",
      draft.date,
      "lunch",
      25 * 60 * 60_000
    ),
    null
  )
  writeNutritionComposerDraft(store, "a", { ...draft, draft: [null] })
  assert.equal(
    readNutritionComposerDraft(store, "a", draft.date, "lunch", 200),
    null
  )
  writeNutritionComposerDraft(store, "a", draft)
  writeNutritionComposerDraft(store, "a", { ...draft, query: "" })
  assert.equal(
    readNutritionComposerDraft(store, "a", draft.date, "lunch", 200),
    null
  )
  writeNutritionComposerDraft(store, "initial", draft)
  assert.equal(
    readNutritionComposerDraft(store, "initial", draft.date, "lunch", 200),
    null
  )
})

test("disabled browser storage yields actionable save guidance instead of an uncaught getter error", () => {
  assert.throws(
    () =>
      getNutritionComposerStorage(() => {
        throw new DOMException("Disabled", "SecurityError")
      }),
    /Allow site storage.*No food save was sent/
  )
  assert.throws(
    () =>
      getNutritionComposerStorage(() => ({
        getItem() {
          throw new DOMException("Disabled", "SecurityError")
        },
      })),
    /Food save storage is unavailable/
  )
})
test("food intent reaches durable save before any animation-frame or timer yield", async () => {
  const source = await readFile(
    new URL("../src/components/nutrition-composer.tsx", import.meta.url),
    "utf8"
  )
  for (const name of ["save", "quickAdd"]) {
    const section = source.slice(source.indexOf(`async function ${name}(`))
    const beforeAcceptance = section.slice(0, section.indexOf("await onSave("))
    assert.ok(beforeAcceptance.length > 0)
    assert.doesNotMatch(
      beforeAcceptance,
      /requestAnimationFrame|setTimeout|await /
    )
  }
})
