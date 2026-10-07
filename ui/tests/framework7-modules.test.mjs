import assert from "node:assert/strict"
import test from "node:test"
import Framework7 from "framework7/lite"
import Calendar from "framework7/components/calendar"
import Picker from "framework7/components/picker"
import Sheet from "framework7/components/sheet"
import Searchbar from "framework7/components/searchbar"
import Actions from "framework7/components/actions"
import Range from "framework7/components/range"
import { registerFramework7Modules } from "../src/lib/framework7-modules.ts"

test("lazy controls install before app creation and preserve picker settings", () => {
  registerFramework7Modules(Calendar)
  const app = new Framework7({
    init: false,
    theme: "ios",
    calendar: { firstDay: 0 },
  })
  assert.equal(typeof app.calendar.create, "function")
  assert.equal(app.params.calendar.firstDay, 0)
})

test("late route controls are usable immediately on the existing app", () => {
  const app = new Framework7({ init: false, theme: "ios" })
  registerFramework7Modules(Picker, Sheet, Searchbar, Actions, Range)
  for (const name of ["picker", "sheet", "searchbar", "actions", "range"])
    assert.equal(typeof app[name].create, "function", name)
  assert.equal(app.params.picker.toolbar, true)
})

test("reimporting a feature does not install duplicate handlers", () => {
  const app = new Framework7({ init: false, theme: "ios" })
  let installs = 0
  const module = {
    name: "training-lazy-controls-test",
    create() { installs++ },
  }
  registerFramework7Modules(module)
  registerFramework7Modules(module)
  assert.equal(installs, 1)
  assert.equal(app.modules[module.name], module)
})
