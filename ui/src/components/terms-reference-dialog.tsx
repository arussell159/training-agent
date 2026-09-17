import { useMemo, useRef, useState } from "react"
import referenceMarkdown from "../../../docs/section-11-reference.md?raw"
import { BookOpen, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type ReferenceRow = {
  section: string
  subsection: string
  term: string
  headers: string[]
  details: string[]
}

function cleanCell(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cleanCell)
}

function parseReference(markdown: string): ReferenceRow[] {
  const lines = markdown.split(/\r?\n/)
  const rows: ReferenceRow[] = []
  let section = "Section 11"
  let subsection = "Reference"
  let headers: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line.startsWith("## ")) {
      section = cleanCell(line.slice(3))
      subsection = section
      headers = []
      continue
    }
    if (line.startsWith("### ")) {
      subsection = cleanCell(line.slice(4))
      headers = []
      continue
    }
    if (!line.startsWith("|")) continue

    const cells = splitTableRow(line)
    const nextLine = lines[index + 1]?.trim() || ""
    if (nextLine.startsWith("|") && /^[|\s:*-]+$/.test(nextLine)) {
      headers = cells
      index += 1
      continue
    }
    if (cells.length < 2 || !cells[0]) continue

    rows.push({
      section,
      subsection,
      term: cells[0],
      headers: headers.slice(1),
      details: cells.slice(1),
    })
  }

  return rows
}

const referenceRows = parseReference(referenceMarkdown)
const sectionOptions = [...new Set(referenceRows.map((row) => row.section))]

export function TermsReferenceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const [section, setSection] = useState("all")
  const popup = useRef<HTMLDivElement>(null)

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return referenceRows.filter((row) => {
      const matchesSection = section === "all" || row.section === section
      if (!matchesSection) return false
      if (!normalizedQuery) return true
      return [row.term, row.section, row.subsection, ...row.details]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [query, section])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popup}
        initialFocus={popup}
        className="terms-reference-dialog flex min-h-0 w-[calc(100vw-1.5rem)] max-w-none min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <div className="min-w-0 shrink-0 border-b bg-background px-4 py-3 sm:px-6">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-base leading-snug sm:text-lg">
              <BookOpen className="size-5 shrink-0 text-primary" />
              Section 11 terms &amp; ranges
            </DialogTitle>
            <DialogDescription className="sr-only sm:not-sr-only">
              Search the shorthand, formulas, thresholds, and race-week ranges
              used in your reports. Your current page stays open underneath this
              lookup.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search e.g. ACWR, DFA a1, D-2, TSB…"
                aria-label="Search Section 11 terms"
                className="h-9 pl-9 text-base md:text-sm"
              />
            </label>
            <select
              value={section}
              onChange={(event) => setSection(event.target.value)}
              aria-label="Filter terms by section"
              className="h-9 max-w-full min-w-0 truncate rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-80 md:text-sm"
            >
              <option value="all">All sections</option>
              {sectionOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {filteredRows.length}{" "}
            {filteredRows.length === 1 ? "entry" : "entries"}
          </p>
        </div>

        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
          aria-label="Terms definitions"
          tabIndex={0}
        >
          <div className="space-y-3 p-4 sm:p-6">
            {filteredRows.length ? (
              filteredRows.map((row, index) => (
                <article
                  key={`${row.section}-${row.term}-${index}`}
                  className="min-w-0 rounded-xl border bg-card p-4 break-words shadow-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-semibold tracking-tight">{row.term}</h2>
                    <Badge
                      variant="secondary"
                      className="max-w-full font-normal whitespace-normal"
                    >
                      {row.subsection}
                    </Badge>
                  </div>
                  <dl className="mt-3 space-y-2 text-sm">
                    {row.details.map((detail, detailIndex) => (
                      <div
                        key={`${row.term}-${detailIndex}`}
                        className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3"
                      >
                        <dt className="text-xs font-medium text-muted-foreground">
                          {row.headers[detailIndex] ||
                            (detailIndex === 0 ? "Definition" : "Detail")}
                        </dt>
                        <dd className="min-w-0 leading-relaxed whitespace-pre-wrap">
                          {detail || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No terms match “{query}”. Try a shorthand, metric, or race
                countdown day.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
