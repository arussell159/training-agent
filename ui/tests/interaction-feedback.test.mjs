import test from "node:test"
import assert from "node:assert/strict"
import { installInteractionFeedback } from "../src/lib/interaction-feedback.ts"

function setup(t) {
  class Control {
    attributes = new Map()
    disabled = false
    inert = false
    closest(selector) {
      return selector === "[inert]" ? (this.inert ? this : null) : this
    }
    matches() {
      return this.disabled
    }
    setAttribute(key, value) {
      this.attributes.set(key, value)
    }
    removeAttribute(key) {
      this.attributes.delete(key)
    }
    get pressed() {
      return this.attributes.has("data-app-pressed")
    }
  }
  const previous = globalThis.Element
  globalThis.Element = Control
  const document = new EventTarget(),
    browser = new EventTarget()
  document.visibilityState = "visible"
  browser.matchMedia = () => ({ matches: true })
  const remove = installInteractionFeedback(document, browser)
  t.after(() => {
    remove()
    if (previous === undefined) delete globalThis.Element
    else globalThis.Element = previous
  })
  const control = new Control()
  const emit = (name, values = {}) => {
    const event = new Event(name, { cancelable: true })
    for (const [key, value] of Object.entries({
      target: control,
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
      ...values,
    }))
      Object.defineProperty(event, key, { value })
    document.dispatchEvent(event)
    assert.equal(
      event.defaultPrevented,
      false,
      "feedback must not prevent the underlying gesture/action"
    )
  }
  return { control, document, browser, emit, remove }
}

test("contact begins immediately and pointer release clears it synchronously", (t) => {
  const view = setup(t)
  view.emit("pointerdown")
  assert.equal(view.control.pressed, true)
  view.emit("pointerup")
  assert.equal(view.control.pressed, false)
})

test("only the original pointer may move or release contact; scrolling cancels feedback", (t) => {
  const view = setup(t)
  view.emit("pointerdown")
  view.emit("pointermove", { pointerId: 2, clientX: 90 })
  view.emit("pointerup", { pointerId: 2 })
  assert.equal(view.control.pressed, true)
  view.emit("pointermove", { clientY: 40 })
  assert.equal(view.control.pressed, false)
  view.emit("pointerdown")
  view.emit("pointercancel")
  assert.equal(view.control.pressed, false)
})

test("keyboard release matches the activation key and background/cleanup never leave stale feedback", (t) => {
  const view = setup(t)
  view.emit("keydown", { key: "Enter" })
  view.emit("keyup", { key: "Shift" })
  assert.equal(view.control.pressed, true)
  view.emit("keyup", { key: "Enter" })
  assert.equal(view.control.pressed, false)
  view.emit("keydown", { key: " " })
  view.document.visibilityState = "hidden"
  view.emit("visibilitychange")
  assert.equal(view.control.pressed, false)
  view.document.visibilityState = "visible"
  view.emit("pointerdown")
  view.remove()
  assert.equal(view.control.pressed, false)
})

test("disabled and inert controls never look active", (t) => {
  const view = setup(t)
  view.control.disabled = true
  view.emit("pointerdown")
  assert.equal(view.control.pressed, false)
  view.control.disabled = false
  view.control.inert = true
  view.emit("keydown", { key: "Enter" })
  assert.equal(view.control.pressed, false)
})
