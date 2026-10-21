/** Cleanup can run inside step(); never enqueue a replacement after it stops. */
export function startAnimationLoop(
  step: () => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame
): () => void {
  let active = true
  let frame = 0
  const tick = () => {
    if (!active) return
    step()
    if (active) frame = schedule(tick)
  }
  frame = schedule(tick)
  return () => {
    active = false
    cancel(frame)
  }
}
