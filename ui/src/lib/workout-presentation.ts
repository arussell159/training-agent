export const workoutVariantLabels = {
  brick: "Brick",
  "day-off": "Day off",
  custom: "Custom",
} as const
export type WorkoutVariant = keyof typeof workoutVariantLabels
type PresentationSource = {
  sport?: string
  provider_type?: string | null
  variant?: string
  display_variant?: string
  editor_model?: { sport: string; variant?: string } | null
}

function selectedVariant(
  value: PresentationSource
): WorkoutVariant | undefined {
  const sport = value.editor_model?.sport || value.provider_type || value.sport
  const variant =
    value.editor_model?.variant || value.variant || value.display_variant
  return sport === "Other" &&
    variant &&
    Object.hasOwn(workoutVariantLabels, variant)
    ? (variant as WorkoutVariant)
    : undefined
}

// A presentation variant is explicit private metadata. Workout titles never
// select a sport, and unsupported provider sport names are never introduced.
export function workoutPresentationSport(value: PresentationSource): string {
  const variant = selectedVariant(value)
  return variant
    ? workoutVariantLabels[variant]
    : value.editor_model?.sport || value.provider_type || value.sport || "Other"
}

export function workoutSelectionKey(value: PresentationSource): string {
  const variant = selectedVariant(value)
  return variant
    ? `variant:${variant}`
    : value.editor_model?.sport || value.provider_type || value.sport || "Other"
}

export function workoutSelection(key: string): {
  sport: string
  variant?: WorkoutVariant
} {
  const variant = key.startsWith("variant:") ? key.slice(8) : ""
  if (Object.hasOwn(workoutVariantLabels, variant))
    return { sport: "Other", variant: variant as WorkoutVariant }
  if (key.startsWith("variant:")) throw Error("Choose a valid workout type.")
  return { sport: key }
}
