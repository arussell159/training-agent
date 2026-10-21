export type WorkoutLocalMetadata = {
  privateNotes: string
  tags: string[]
  equipment: string
  bikeEquipment?: string
  shoeEquipment?: string
  autoCalculate: boolean
}

const empty = (): WorkoutLocalMetadata => ({
  privateNotes: "",
  tags: [],
  equipment: "",
  autoCalculate: true,
})
const key = (scope: string) =>
  `training-agent-workout-personal-v2:${JSON.stringify(scope)}`

/** Optional sport-specific equipment must migrate even without generic equipment. */
export function hasWorkoutPersonalFields(value: WorkoutLocalMetadata): boolean {
  return Boolean(
    value.privateNotes || value.tags.length || value.equipment ||
    value.bikeEquipment || value.shoeEquipment || !value.autoCalculate
  )
}

/** A late read updates untouched fields while preserving edits made in flight. */
export function mergeWorkoutPersonalRead(
  current: WorkoutLocalMetadata,
  beforeRead: WorkoutLocalMetadata,
  remote: WorkoutLocalMetadata
): WorkoutLocalMetadata {
  const fields = new Set([...Object.keys(current), ...Object.keys(remote)])
  return normalizeWorkoutLocalMetadata(Object.fromEntries([...fields].map(key => {
    const field = key as keyof WorkoutLocalMetadata
    return [field, JSON.stringify(current[field]) === JSON.stringify(beforeRead[field])
      ? remote[field] : current[field]]
  })))
}

function readAccountFields(
  scope: string
): Record<string, WorkoutLocalMetadata> {
  try {
    const value = JSON.parse(localStorage.getItem(key(scope)) || "null")
    if (!value || typeof value !== "object" || Array.isArray(value))
      return Object.create(null)
    return Object.fromEntries(
      Object.entries(value).map(([id, fields]) => [
        id,
        normalizeWorkoutLocalMetadata(fields),
      ])
    )
  } catch {
    return Object.create(null)
  }
}

export function normalizeWorkoutLocalMetadata(
  value: unknown
): WorkoutLocalMetadata {
  if (!value || typeof value !== "object") return empty()
  const record = value as Partial<WorkoutLocalMetadata>
  return {
    privateNotes:
      typeof record.privateNotes === "string"
        ? record.privateNotes.slice(0, 2000)
        : "",
    tags: Array.isArray(record.tags)
      ? record.tags
          .filter(
            (tag: unknown): tag is string =>
              typeof tag === "string" && Boolean(tag.trim())
          )
          .slice(0, 30)
      : [],
    equipment:
      typeof record.equipment === "string"
        ? record.equipment.slice(0, 100)
        : "",
    ...(typeof record.bikeEquipment === "string"
      ? { bikeEquipment: record.bikeEquipment.slice(0, 100) }
      : {}),
    ...(typeof record.shoeEquipment === "string"
      ? { shoeEquipment: record.shoeEquipment.slice(0, 100) }
      : {}),
    autoCalculate: record.autoCalculate !== false,
  }
}

export function readWorkoutLocalMetadata(
  scope: string,
  id: string
): WorkoutLocalMetadata {
  const fields = readAccountFields(scope)
  return Object.hasOwn(fields, id) ? fields[id] : empty()
}

export function saveWorkoutLocalMetadata(
  scope: string,
  id: string,
  value: WorkoutLocalMetadata
) {
  const fields = readAccountFields(scope)
  Object.defineProperty(fields, id, {
    value: normalizeWorkoutLocalMetadata(value),
    enumerable: true,
    configurable: true,
    writable: true,
  })
  try {
    localStorage.setItem(key(scope), JSON.stringify(fields))
  } catch {
    throw new Error(
      "Personal workout fields could not be saved on this device. Your changes are still in the form."
    )
  }
}

/** A single write replaces the draft; quota failures leave the original intact. */
export function moveWorkoutLocalMetadata(
  scope: string,
  fromId: string,
  toId: string,
  value: WorkoutLocalMetadata
) {
  const fields = readAccountFields(scope)
  const next = normalizeWorkoutLocalMetadata(value)
  if (
    !Object.hasOwn(fields, fromId) &&
    !Object.hasOwn(fields, toId) &&
    JSON.stringify(next) === JSON.stringify(empty())
  )
    return
  Object.defineProperty(fields, toId, {
    value: next,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  if (fromId !== toId) delete fields[fromId]
  try {
    localStorage.setItem(key(scope), JSON.stringify(fields))
  } catch {
    throw new Error(
      "The workout was saved, but personal fields could not move from its draft. The original personal draft is retained on this device."
    )
  }
}

export function removeWorkoutLocalMetadata(scope: string, id: string) {
  const fields = readAccountFields(scope)
  if (!Object.hasOwn(fields, id)) return
  delete fields[id]
  try {
    if (Object.keys(fields).length)
      localStorage.setItem(key(scope), JSON.stringify(fields))
    else localStorage.removeItem(key(scope))
  } catch {
    /* The old draft remains available if cleanup fails. */
  }
}

export function savedWorkoutEquipment(scope: string) {
  return [
    ...new Set(
      Object.values(readAccountFields(scope))
        .flatMap((value) => [
          value.equipment,
          value.bikeEquipment,
          value.shoeEquipment,
        ])
        .filter((value): value is string => Boolean(value))
    ),
  ].sort()
}
