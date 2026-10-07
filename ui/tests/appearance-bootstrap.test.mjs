import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(bootstrap, "The entry document must resolve appearance before React")

function firstAppearance({ stored, dark = false, blocked = false, media = true } = {}) {
  const classes = []
  const root = { classList: { add: (value) => classes.push(value) }, style: {} }
  runInNewContext(bootstrap, {
    localStorage: {
      getItem() {
        if (blocked) throw new Error("SecurityError")
        return stored ?? null
      },
    },
    window: { matchMedia: media ? () => ({ matches: dark }) : undefined },
    document: { documentElement: root },
  })
  return { classes, colorScheme: root.style.colorScheme }
}

test("saved dark appearance is applied before authentication and first paint", () => {
  assert.deepEqual(firstAppearance({ stored: "dark" }), { classes: ["dark"], colorScheme: "dark" })
})

test("explicit light appearance overrides a dark device", () => {
  assert.deepEqual(firstAppearance({ stored: "light", dark: true }), { classes: ["light"], colorScheme: "light" })
})

test("missing and invalid preferences follow the device", () => {
  for (const stored of [undefined, "broken", "system"]) {
    assert.deepEqual(firstAppearance({ stored, dark: true }), { classes: ["dark"], colorScheme: "dark" })
  }
})

test("blocked storage cannot crash startup or prevent device appearance", () => {
  assert.deepEqual(firstAppearance({ blocked: true, dark: true }), { classes: ["dark"], colorScheme: "dark" })
})

test("a missing color scheme API falls back to light", () => {
  assert.deepEqual(firstAppearance({ media: false }), { classes: ["light"], colorScheme: "light" })
})
