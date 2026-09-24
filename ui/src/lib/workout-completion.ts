export type CompletionGrade = "good" | "medium" | "failed" | "planned" | "unknown"

type Goals = { duration_minutes?: number }

export function gradeWorkoutCompletion(status: string, planned: Goals, actual: Goals): CompletionGrade {
  if (status !== "completed") return "planned"
  const checks = [
    { target: planned.duration_minutes, actual: actual.duration_minutes, green: 0.1, orange: 0.25 },
  ].filter(check => Number.isFinite(check.target) && Number(check.target) > 0 && Number.isFinite(check.actual) && Number(check.actual) > 0)
  if (!checks.length) return "unknown"
  const deviation = (check: typeof checks[number]) => Math.abs(Number(check.actual) / Number(check.target) - 1)
  if (checks.some(check => deviation(check) > check.orange + 1e-9)) return "failed"
  if (checks.some(check => deviation(check) > check.green + 1e-9)) return "medium"
  return "good"
}
