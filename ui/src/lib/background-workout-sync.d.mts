import type { TrainingContext } from "./training-context"
export type BackgroundSyncResult = {
  context?: TrainingContext
  probe?: { token: string; expiresAt: number; baseline?: string }
  needs_import?: boolean
  error?: string
  sync_error?: string
  probe_error?: string
  changed?: boolean
  paused?: boolean
  queue?: { pending: number; failed: number }
}
export function createBackgroundWorkoutSync(options: {
  issue: () => Promise<BackgroundSyncResult>
  probe: (token: string) => Promise<BackgroundSyncResult>
  importWorkouts: () => Promise<BackgroundSyncResult>
  flushEdits: (retry: boolean) => Promise<BackgroundSyncResult>
  onContext?: (context: TrainingContext) => void
}): {
  start: () => Promise<BackgroundSyncResult | void>
  check: () => Promise<BackgroundSyncResult>
  edit: (retry?: boolean) => Promise<BackgroundSyncResult>
  reset: () => void
  status: () => {
    started: boolean
    paused: boolean
    hasLease: boolean
    busy: boolean
  }
}
