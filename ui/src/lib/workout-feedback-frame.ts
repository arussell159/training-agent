/** Let the existing Saving control reach a frame before synchronous model/cache
 * work. This is feedback only; save acceptance still awaits IDB completion. */
export function yieldForWorkoutFeedback(): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") return Promise.resolve()
  return new Promise(resolve => {
    const fallback = setTimeout(resolve, 50)
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(fallback); resolve() }, 0))
  })
}
