import { useMemo, useState, type ReactNode } from "react"
import { Columns3, Download, Filter, ArrowUpDown } from "lucide-react"
import { analysisCsv } from "@/lib/analysis-360"

export type AnalysisColumn = {
  key: string
  label: string
  format?: (value: number) => string
}
export type AnalysisTableRow = {
  id: string
  [key: string]: string | number | null
}

export function Analysis360Table({
  columns,
  rows,
  label,
  selected,
  onToggle,
  onSelect,
  children,
  filename = "workout-analysis.csv",
}: {
  columns: AnalysisColumn[]
  rows: AnalysisTableRow[]
  label: string
  selected?: string[]
  onToggle?: (id: string) => void
  onSelect?: (id: string) => void
  children?: ReactNode
  filename?: string
}) {
  const [hidden, setHidden] = useState<string[]>([]),
    [filterOpen, setFilterOpen] = useState(false),
    [filter, setFilter] = useState(""),
    [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null)
  const visible = columns.filter((column) => !hidden.includes(column.key))
  const filtered = useMemo(() => {
    const matching = rows.filter((row) =>
      columns.some(
        (column) =>
          String(row[column.key] ?? "")
            .toLowerCase()
            .includes(filter.toLowerCase()) ||
          (typeof row[column.key] === "number" &&
            Boolean(
              column
                .format?.(row[column.key] as number)
                .toLowerCase()
                .includes(filter.toLowerCase())
            ))
      )
    )
    if (sort)
      matching.sort((a, b) => {
        const left = a[sort.key],
          right = b[sort.key]
        return (
          (left == null
            ? 1
            : right == null
              ? -1
              : typeof left === "number" && typeof right === "number"
                ? left - right
                : String(left).localeCompare(String(right))) * sort.direction
        )
      })
    return matching
  }, [rows, columns, filter, sort])
  const format = (row: AnalysisTableRow, column: AnalysisColumn) =>
    row[column.key] == null
      ? "—"
      : typeof row[column.key] === "number" && column.format
        ? column.format(row[column.key] as number)
        : String(row[column.key])
  const download = () => {
    const csv = analysisCsv([
      visible.map((column) => column.label),
      ...filtered.map((row) => visible.map((column) => format(row, column))),
    ])
    const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" })
      ),
      anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section className="a360-table-section" aria-label={label}>
      <div className="a360-table-toolbar">
        {children}
        <details className="a360-column-picker">
          <summary>
            <Columns3 size={14} />
            Columns
          </summary>
          <div>
            {columns.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(column.key)}
                  disabled={
                    !hidden.includes(column.key) && visible.length === 1
                  }
                  onChange={() =>
                    setHidden((current) =>
                      current.includes(column.key)
                        ? current.filter((key) => key !== column.key)
                        : [...current, column.key]
                    )
                  }
                />
                {column.label}
              </label>
            ))}
          </div>
        </details>
        <button
          type="button"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((value) => !value)}
        >
          <Filter size={14} />
          Filters
        </button>
        <span className="a360-row-count">
          {filtered.length} {label.includes("lap") ? "Laps" : "Rows"}
          {selected?.length ? ` (${selected.length} selected)` : ""}
        </span>
        <button type="button" onClick={download}>
          <Download size={14} />
          Export
        </button>
      </div>
      {filterOpen && (
        <input
          className="a360-table-filter"
          type="search"
          aria-label={`Filter ${label}`}
          placeholder="Filter rows…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <div className="a360-grid-scroll">
        <table role="grid" aria-label={label}>
          <thead>
            <tr>
              {onToggle && (
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all laps"
                    checked={
                      filtered.length > 0 &&
                      filtered.every((row) => selected?.includes(row.id))
                    }
                    onChange={() => {
                      const all = filtered.every((row) =>
                        selected?.includes(row.id)
                      )
                      for (const row of filtered)
                        if (Boolean(selected?.includes(row.id)) !== !all)
                          onToggle(row.id)
                    }}
                  />
                </th>
              )}
              {visible.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort?.key === column.key
                      ? sort.direction === 1
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((current) => ({
                        key: column.key,
                        direction:
                          current?.key === column.key && current.direction === 1
                            ? -1
                            : 1,
                      }))
                    }
                  >
                    {column.label}
                    <ArrowUpDown size={10} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                aria-selected={
                  onToggle ? selected?.includes(row.id) : undefined
                }
                onDoubleClick={() => onSelect?.(row.id)}
              >
                {onToggle && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.name}`}
                      checked={selected?.includes(row.id) || false}
                      onChange={() => onToggle(row.id)}
                    />
                  </td>
                )}
                {visible.map((column, index) => (
                  <td key={column.key}>
                    {index === 0 && onSelect ? (
                      <button
                        className="a360-row-link"
                        type="button"
                        onClick={() => onSelect(row.id)}
                      >
                        {format(row, column)}
                      </button>
                    ) : (
                      format(row, column)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="a360-empty">No matching rows.</p>}
      </div>
    </section>
  )
}
