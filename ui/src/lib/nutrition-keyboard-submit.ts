/** iPhone's numeric keyboard Done dismisses the input without an Enter key event.
 * Only that keyboard dismissal submits: taps, focus changes and leaving the app do not. */
export function bindFoodKeyboardSubmit(
  input: HTMLInputElement,
  { valid, submit }: { valid: () => boolean; submit: () => void }
) {
  const document = input.ownerDocument
  const window = document.defaultView!
  const ios =
    /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" &&
      window.navigator.maxTouchPoints > 1)
  let focused = false,
    blocked = false,
    submitted = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    blocked = true
    clearTimeout(timer)
  }
  const commit = () => {
    if (
      blocked ||
      submitted ||
      document.visibilityState !== "visible" ||
      !valid()
    )
      return
    submitted = true
    submit()
  }
  const focus = () => {
    clearTimeout(timer)
    focused = true
    blocked = false
    submitted = false
  }
  const pointer = (event: Event) => {
    if (focused && event.target !== input) cancel()
  }
  const focusElsewhere = (event: Event) => {
    if (event.target !== input) cancel()
  }
  const blur = (event: FocusEvent) => {
    const keyboardDone = ios && focused && !blocked && !event.relatedTarget
    focused = false
    if (!keyboardDone) return
    // Let focusin, page visibility and window blur settle before interpreting Done.
    timer = setTimeout(() => {
      const active = document.activeElement
      if (
        active &&
        active !== input &&
        active !== document.body &&
        active !== document.documentElement
      )
        return
      commit()
    }, 0)
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Escape") cancel()
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    commit()
  }
  const visibility = () => {
    if (document.visibilityState !== "visible") cancel()
  }
  input.addEventListener("focus", focus)
  input.addEventListener("blur", blur)
  input.addEventListener("keydown", key)
  document.addEventListener("pointerdown", pointer, true)
  document.addEventListener("focusin", focusElsewhere, true)
  document.addEventListener("visibilitychange", visibility)
  window.addEventListener("blur", cancel)
  window.addEventListener("pagehide", cancel)
  return () => {
    cancel()
    input.removeEventListener("focus", focus)
    input.removeEventListener("blur", blur)
    input.removeEventListener("keydown", key)
    document.removeEventListener("pointerdown", pointer, true)
    document.removeEventListener("focusin", focusElsewhere, true)
    document.removeEventListener("visibilitychange", visibility)
    window.removeEventListener("blur", cancel)
    window.removeEventListener("pagehide", cancel)
  }
}
