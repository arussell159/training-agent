export type FoodGesture = {
  x: number
  y: number
  started: number
  cancelled: boolean
}
export function beginFoodGesture(
  x: number,
  y: number,
  now: number
): FoodGesture {
  return { x, y, started: now, cancelled: false }
}
export function moveFoodGesture(gesture: FoodGesture, x: number, y: number) {
  if (Math.hypot(x - gesture.x, y - gesture.y) > 8) gesture.cancelled = true
}
export function finishFoodGesture(gesture: FoodGesture | null, now: number) {
  return !gesture || gesture.cancelled
    ? "cancel"
    : now - gesture.started >= 500
      ? "hold"
      : "tap"
}
