export type RecoveryTrendPoint = {
  date: string
  value: number
  average: number
  baselineLow: number
  baselineHigh: number
}

type Position = { x: number; y: number }
const number = (value: number) => Number(value.toFixed(2))

// Monotone cubic segments keep the small sparkline smooth without creating
// peaks or troughs between measured values. No chart runtime is needed.
function curve(points: Position[]) {
  if (!points.length) return ""
  const slopes = points
    .slice(1)
    .map(
      (point, index) =>
        (point.y - points[index].y) / (point.x - points[index].x)
    )
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0
    if (index === points.length - 1) return slopes[index - 1]
    const before = slopes[index - 1],
      after = slopes[index]
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after)
  })
  let path = `M${number(points[0].x)},${number(points[0].y)}`
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1],
      to = points[index]
    const third = (to.x - from.x) / 3
    path += `C${number(from.x + third)},${number(from.y + tangents[index - 1] * third)} ${number(to.x - third)},${number(to.y - tangents[index] * third)} ${number(to.x)},${number(to.y)}`
  }
  return path
}

export function recoveryTrendGeometry(
  input: RecoveryTrendPoint[],
  current?: number | null
) {
  const data = input.filter((point) =>
    [point.value, point.average, point.baselineLow, point.baselineHigh].every(
      Number.isFinite
    )
  )
  const values = data.flatMap((point) => [
    point.value,
    point.average,
    point.baselineLow,
    point.baselineHigh,
  ])
  if (typeof current === "number" && Number.isFinite(current))
    values.push(current)
  const low = (values.length ? Math.min(...values) : 0) - 2
  const high = (values.length ? Math.max(...values) : 1) + 2
  const y = (value: number) => 8 + ((high - value) / (high - low)) * 84
  const points = data.map((point, index) => ({
    ...point,
    x: data.length === 1 ? 160 : 8 + (index / (data.length - 1)) * 304,
    y: y(point.value),
  }))
  const baselineHigh = points.map((point) => ({
    x: point.x,
    y: y(point.baselineHigh),
  }))
  const baselineLow = points
    .map((point) => ({ x: point.x, y: y(point.baselineLow) }))
    .reverse()
  return {
    points,
    daily: curve(points),
    average: curve(
      points.map((point) => ({ x: point.x, y: y(point.average) }))
    ),
    band:
      points.length > 1
        ? `${curve(baselineHigh)}${curve(baselineLow).replace(/^M/, "L")}Z`
        : "",
  }
}
