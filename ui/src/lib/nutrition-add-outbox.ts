import type { FoodEntry, NutritionView } from "./nutrition"
import {
  pendingNutritionWrite,
  submitNutritionWrite,
  type NutritionWrite,
  type NutritionWriteResult,
} from "./pending-nutrition-write.ts"

type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>
export type QueuedFoodAdd = {
  version: 1
  operationId: string
  date: string
  entries: FoodEntry[]
  createdAt: number
  prepared?: NutritionWrite
  failed?: string
}
const prefix = (scope: string) => `nutrition-add-outbox-v1:${scope}:`
export function queuedFoodAdds(
  storage: StorageLike,
  scope: string
): QueuedFoodAdd[] {
  const rows: QueuedFoodAdd[] = []
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index)
    if (!name?.startsWith(prefix(scope))) continue
    const row = JSON.parse(storage.getItem(name) || "null") as QueuedFoodAdd
    if (
      !row ||
      row.version !== 1 ||
      name !== prefix(scope) + row.operationId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Array.isArray(row.entries) ||
      !row.entries.length ||
      row.entries.length > 30 ||
      !Number.isFinite(row.createdAt)
    )
      throw Error(
        "A retained food entry could not be read. Keep this app's data and retry."
      )
    rows.push(row)
  }
  return rows.sort(
    (a, b) =>
      Number(Boolean(b.prepared)) - Number(Boolean(a.prepared)) ||
      a.createdAt - b.createdAt ||
      a.operationId.localeCompare(b.operationId)
  )
}
export function hasQueuedFoodAdds(storage: StorageLike, scope: string) {
  for (let index = 0; index < storage.length; index++)
    if (storage.key(index)?.startsWith(prefix(scope))) return true
  return false
}

/** Each intent has its own durable key. Only the head receives a server revision;
 * followers never guess a revision or reuse a completed food's identity. */
export function createNutritionAddOutbox({
  storage,
  scope,
  current,
  readView,
  resolveEntries,
  send,
  project,
  publish,
  changed,
  confirmed,
  now = Date.now,
}: {
  storage: StorageLike
  scope: string
  current: () => boolean
  readView: (date: string, fresh?: boolean) => Promise<NutritionView>
  resolveEntries: (entries: FoodEntry[]) => Promise<FoodEntry[]>
  send: (input: NutritionWrite) => Promise<NutritionWriteResult>
  project: (view: NutritionView, entries: FoodEntry[]) => NutritionView
  publish: (view: NutritionView, pending: boolean) => void
  changed: (state: { pending: number; failed: number; error?: string }) => void
  now?: () => number
  confirmed?: (input: NutritionWrite, result: NutritionWriteResult) => void
}) {
  const bases = new Map<string, NutritionView>()
  let running: Promise<void> | null = null,
    sequence = 0
  const rows = () => queuedFoodAdds(storage, scope),
    save = (row: QueuedFoodAdd) =>
      storage.setItem(prefix(scope) + row.operationId, JSON.stringify(row))
  const state = (error?: string) => {
    if (!current()) return
    const all = rows()
    changed({
      pending: all.filter((row) => !row.failed).length,
      failed: all.filter((row) => row.failed).length,
      ...(error ? { error } : {}),
    })
  }
  const baseFrom = (view: NutritionView) => {
    const pendingIds = new Set(
      rows()
        .filter((row) => row.date === view.date)
        .flatMap((row) => row.entries.map((entry) => entry.id))
    )
    return {
      ...view,
      day: {
        ...view.day,
        entries: view.day.entries.filter((entry) => !pendingIds.has(entry.id)),
      },
    }
  }
  const paint = (date: string) => {
    if (!current()) return
    const base = bases.get(date)
    if (!base) return
    const pending = rows().filter((row) => row.date === date && !row.failed)
    publish(
      project(
        base,
        pending.flatMap((row) => row.entries)
      ),
      Boolean(pending.length)
    )
  }
  const enqueue = (
    view: NutritionView | string,
    entries: FoodEntry[],
    operationId: string
  ) => {
    const date = typeof view === "string" ? view : view.date
    if (!current() || !scope || scope === "initial")
      throw Error("Wait for your account food log to load.")
    if (
      !/^[a-zA-Z0-9_-]{8,80}$/.test(operationId) ||
      !entries.length ||
      entries.length > 30 ||
      new Set(entries.map((entry) => entry.id)).size !== entries.length
    )
      throw Error("Check the foods before adding them.")
    const all = rows(),
      existing = all.find((row) => row.operationId === operationId)
    if (existing) {
      if (
        JSON.stringify(existing.entries) !== JSON.stringify(entries) ||
        existing.date !== date
      )
        throw Error("This food save ID belongs to a different entry.")
      paint(date)
      return
    }
    if (all.length >= 60)
      throw Error(
        "Your food saves are still catching up. Retry the retained entries before adding more."
      )
    const base = typeof view === "string" ? undefined : baseFrom(view)
    if (
      base &&
      base.day.entries.length +
        all
          .filter((row) => row.date === date && !row.failed)
          .reduce((sum, row) => sum + row.entries.length, 0) +
        entries.length >
        150
    )
      throw Error("This day has reached its limit of 150 foods.")
    const row: QueuedFoodAdd = {
      version: 1,
      operationId,
      date,
      entries: JSON.parse(JSON.stringify(entries)),
      createdAt: now() + sequence++ / 1000,
    }
    try {
      save(row)
    } catch {
      throw Error(
        "This food could not be retained on your device. Keep the editor open and retry; nothing was sent."
      )
    }
    const previous = bases.get(date)
    if (base && (!previous || base.day.revision >= previous.day.revision))
      bases.set(date, base)
    paint(date)
    state()
  }
  const drain = () => {
    if (running) return running
    running = (async () => {
      let conflicts = 0
      while (current()) {
        const all = rows(),
          pending = pendingNutritionWrite(storage, scope)
        const row =
          (pending
            ? all.find((item) => item.operationId === pending.operationId)
            : undefined) || all.find((item) => !item.failed)
        if (!row) return
        if (pending && pending.operationId !== row.operationId) {
          bases.clear()
          throw Error("An earlier food save needs confirmation first.")
        }
        try {
          let base = bases.get(row.date)
          if (!base) {
            base = baseFrom(await readView(row.date))
            if (!current()) return
            bases.set(row.date, base)
          }
          if (!row.prepared) {
            row.entries = await resolveEntries(row.entries)
            if (!current()) return
            row.prepared = {
              date: row.date,
              action: "add",
              entries: row.entries,
              operationId: row.operationId,
              revision: base.day.revision,
            }
            save(row)
            paint(row.date)
          }
          const input = pending || row.prepared
          const result = await submitNutritionWrite(
            storage,
            scope,
            input,
            async (payload) => {
              if (!current())
                throw Error(
                  "Your account changed. Reopen the original account to confirm the food."
                )
              return send(payload)
            }
          )
          if (!current()) return
          confirmed?.(input, result)
          const revision = result.day?.revision ?? result.revision
          if (result.day) base = { ...base, day: result.day }
          else if (revision === input.revision + 1)
            base = {
              ...project(base, result.changedEntries || input.entries || []),
              day: {
                ...project(base, result.changedEntries || input.entries || [])
                  .day,
                revision: revision!,
              },
            }
          else base = await readView(row.date, true)
          if (!current()) return
          storage.removeItem(prefix(scope) + row.operationId)
          bases.set(row.date, base)
          paint(row.date)
          state()
          conflicts = 0
        } catch (problem) {
          if (!current()) return
          const error = problem as Error & { status?: number }
          if (error.status === 409 && conflicts++ < 2) {
            row.prepared = undefined
            save(row)
            const fresh = await readView(row.date, true)
            if (!current()) return
            const alreadySaved = row.entries.every((entry) =>
              fresh.day.entries.some(
                (saved) =>
                  saved.id === entry.id &&
                  saved.meal === entry.meal &&
                  saved.quantity === entry.quantity &&
                  saved.foodId === entry.foodId
              )
            )
            if (alreadySaved)
              storage.removeItem(prefix(scope) + row.operationId)
            bases.set(row.date, baseFrom(fresh))
            paint(row.date)
            continue
          }
          if ([400, 422].includes(error.status || 0)) {
            row.failed = error.message
            row.prepared = undefined
            save(row)
            paint(row.date)
            state(error.message)
            continue
          }
          state(error.message)
          throw error
        }
      }
    })().finally(() => {
      running = null
    })
    return running
  }
  const retry = () => {
    for (const row of rows())
      if (row.failed) {
        delete row.failed
        save(row)
      }
    state()
    return drain()
  }
  return { enqueue, drain, retry, rows }
}
