import { useEffect, useState } from "react"
import {
  dashboardTagClient,
  type ChartTagCatalog,
} from "@/lib/dashboard-chart-tags"
import { trainingCacheScope } from "@/lib/training-context"

export function DashboardChartTagSettings({
  tags,
  onChange,
  onCatalog,
  disabled,
}: {
  tags: readonly string[]
  onChange: (tags: string[]) => void
  onCatalog: (catalog: ChartTagCatalog | null) => void
  disabled: boolean
}) {
  const [catalog, setCatalog] = useState<ChartTagCatalog | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0)
  const scope = trainingCacheScope()
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    setCatalog(null)
    onCatalog(null)
    void dashboardTagClient
      .catalog(scope, { signal: controller.signal, force: true })
      .then((value) => {
        if (!controller.signal.aborted) {
          setCatalog(value)
          onCatalog(value)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Recording tags could not load."
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [scope, retry, onCatalog])
  const missing = tags.filter((tag) => !catalog?.tags.includes(tag))
  return (
    <fieldset disabled={disabled} className="ddc-tag-settings">
      <legend>Select Tags</legend>
      <p className="dta-data-note">
        Filter by native recording tags. Any selected tag can match.
      </p>
      <label>
        <input
          type="checkbox"
          checked={!tags.length}
          onChange={() => onChange([])}
        />
        All
      </label>
      {loading && <p role="status">Loading recording tags…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && catalog && !catalog.tags.length && (
        <p>No recording tags are available.</p>
      )}
      {catalog && (
        <div className="ddc-sports">
          {catalog.tags.map((tag) => (
            <label key={tag}>
              <input
                type="checkbox"
                aria-label={`Recording tag: ${tag}`}
                checked={tags.includes(tag)}
                disabled={
                  disabled || (!tags.includes(tag) && tags.length >= 20)
                }
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...tags, tag]
                      : tags.filter((value) => value !== tag)
                  )
                }
              />
              {tag}
            </label>
          ))}
        </div>
      )}
      {!loading && missing.length > 0 && (
        <p role="alert">
          Selected tags are unavailable: {missing.join(", ")}. The selection is
          retained. Reload tags or clear the selection.
        </p>
      )}
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setRetry((value) => value + 1)}
      >
        Reload recording tags
      </button>
      {!!tags.length && (
        <button type="button" disabled={disabled} onClick={() => onChange([])}>
          Clear recording tags
        </button>
      )}
    </fieldset>
  )
}
