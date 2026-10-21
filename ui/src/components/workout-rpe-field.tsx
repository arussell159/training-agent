import { useEffect, useRef, useState } from "react"
import { normalizeRpeValue } from "@/lib/desktop-workout-builder"

/** Keep incomplete typing local; the observed RPE control rounds/clamps on blur. */
export function WorkoutRpeField({
  label,
  value,
  onChange,
  className = "dtb-target-number",
}: {
  label: string
  value: number
  onChange: (value: number) => void
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(String(value))
  }, [value])
  return (
    <input
      aria-label={label}
      type="text"
      inputMode="decimal"
      className={className}
      value={draft}
      style={{ width: `${Math.max(4, draft.length) + 2}ch` }}
      onFocus={(event) => {
        focused.current = true
        event.currentTarget.select()
      }}
      onChange={(event) => {
        if (/^-?\d*\.?\d{0,2}$/.test(event.target.value))
          setDraft(event.target.value)
      }}
      onBlur={() => {
        focused.current = false
        const amount = Number(draft)
        if (draft.trim() && Number.isFinite(amount)) {
          const next = normalizeRpeValue(amount)
          setDraft(String(next))
          onChange(next)
        } else setDraft(String(value))
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    />
  )
}
