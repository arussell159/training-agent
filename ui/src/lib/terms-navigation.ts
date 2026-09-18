export type TermsView = { open: boolean; metricId: string | null }
type HistoryPort = Pick<History, "state" | "pushState" | "back" | "go">
const key = "ar-performance-terms"

// Two real history entries: origin -> terms -> metric. Dismissal consumes the
// entry instead of pushing a replacement, so Back and Forward remain symmetric.
export function createTermsNavigation(
  history: HistoryPort,
  changed: (view: TermsView) => void,
  id: string
) {
  let view: TermsView = { open: false, metricId: null }
  let pending = false
  const read = (state: History["state"]): TermsView =>
    state?.[key]?.id === id
      ? { open: true, metricId: state[key].metricId ?? null }
      : { open: false, metricId: null }
  const update = (next: TermsView) => {
    view = next
    changed(next)
  }
  const push = (metricId: string | null) => {
    history.pushState({ ...history.state, [key]: { id, metricId } }, "")
    update({ open: true, metricId })
  }
  return {
    current: () => view,
    open: () => {
      if (!view.open && !pending) push(null)
    },
    metric: (metricId: string) => {
      if (view.open && !view.metricId && !pending) push(metricId)
    },
    back: () => {
      if (view.open && !pending) {
        pending = true
        history.back()
      }
    },
    dismiss: () => {
      if (view.open && !pending) {
        pending = true
        history.go(view.metricId ? -2 : -1)
      }
    },
    pop: (state: History["state"]) => {
      const next = read(state)
      if (!view.open && !next.open) return false
      pending = false
      update(next)
      return true
    },
  }
}
