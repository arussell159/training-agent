type Point = { id: number; x: number; y: number }

/** Suppress only the click belonging to a swipe, never the next intentional tap. */
export function createDaySwipeGesture() {
  let start: Point | null = null
  let swiped = false
  return {
    begin(point: Point) {
      start = point
      swiped = false
    },
    end(point: Point): -1 | 0 | 1 {
      const origin = start
      start = null
      if (!origin || origin.id !== point.id) return 0
      const x = point.x - origin.x,
        y = point.y - origin.y
      if (Math.abs(x) < 48 || Math.abs(x) < Math.abs(y) * 1.25) return 0
      swiped = true
      return x < 0 ? 1 : -1
    },
    consumeClick() {
      const value = swiped
      swiped = false
      return value
    },
    cancel() {
      start = null
      swiped = false
    },
  }
}
