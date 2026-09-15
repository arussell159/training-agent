export function hasWorkoutStructure(value?: string | null): boolean {
  if (!value) return false
  try {
    const parsed = JSON.parse(value)
    const steps = Array.isArray(parsed) ? parsed : parsed?.structure
    return Array.isArray(steps) && steps.length > 0
  } catch {
    return false
  }
}
