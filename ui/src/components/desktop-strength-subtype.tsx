import { useId, useState } from "react"
import { Popover } from "@base-ui/react/popover"
import { Select } from "@base-ui/react/select"
import {
  strengthSubtypes,
  type StrengthSubtype,
} from "../../../app-backend/lib/workout-strength-model.mjs"
import { StrengthGlyph } from "./desktop-strength-glyphs"
import { strengthSubtypeIcons } from "./desktop-strength-subtype-icons"
import "./desktop-strength-subtype.css"

function SubtypeIcon({ subtype }: { subtype?: StrengthSubtype }) {
  if (!subtype) return <StrengthGlyph name="sport" />
  const icon = strengthSubtypeIcons[subtype]
  return (
    <svg
      width="24"
      height="24"
      viewBox={icon.viewBox}
      fill="currentColor"
      aria-hidden="true"
    >
      {icon.paths.map((path, index) => (
        <path key={index} d={path.d} />
      ))}
    </svg>
  )
}

export function DesktopStrengthSubtype({
  subtype,
  disabled,
  onChange,
}: {
  subtype?: StrengthSubtype
  disabled: boolean
  onChange: (subtype?: StrengthSubtype) => void
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<StrengthSubtype | "None">(subtype || "None")
  const labelId = useId()
  return (
    <Popover.Root
      modal
      open={open}
      onOpenChange={(value) => {
        if (value) setDraft(subtype || "None")
        setOpen(value)
      }}
    >
      <Popover.Trigger
        className="dsb-sport"
        aria-label="Activity Subtype"
        disabled={disabled}
      >
        <SubtypeIcon subtype={subtype} />
        <span>{subtype || "Strength"}</span>
        <StrengthGlyph name="dropdown" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={0}
          className="dsb-subtype-positioner"
        >
          <Popover.Popup className="dsb-subtype-popup">
            <Popover.Title>Activity Subtype</Popover.Title>
            <div className="dsb-subtype-field">
              <span id={labelId} className="dsb-subtype-label">
                Subtype
              </span>
              <Select.Root
                value={draft}
                items={["None", ...strengthSubtypes].map((value) => ({
                  value,
                  label: value,
                }))}
                onValueChange={(value) => {
                  if (
                    value === "None" ||
                    strengthSubtypes.includes(value as StrengthSubtype)
                  )
                    setDraft(value as StrengthSubtype | "None")
                }}
              >
                <Select.Trigger
                  aria-labelledby={labelId}
                  className="dsb-subtype-select"
                >
                  <Select.Value />
                  <Select.Icon>
                    <svg
                      width="27.428571"
                      height="27.428571"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M7 10l5 5 5-5z" fill="currentColor" />
                    </svg>
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Positioner
                    align="start"
                    alignItemWithTrigger
                    className="dsb-subtype-options-positioner"
                  >
                    <Select.Popup className="dsb-subtype-options">
                      <Select.List>
                        {["None", ...strengthSubtypes].map((value) => (
                          <Select.Item key={value} value={value}>
                            <Select.ItemText>{value}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.List>
                    </Select.Popup>
                  </Select.Positioner>
                </Select.Portal>
              </Select.Root>
              <fieldset aria-hidden="true" className="dsb-subtype-outline">
                <legend>
                  <span>Subtype</span>
                </legend>
              </fieldset>
            </div>
            <footer>
              <button
                type="button"
                className="dsb-primary"
                onClick={() => {
                  onChange(draft === "None" ? undefined : draft)
                  setOpen(false)
                }}
              >
                Select
              </button>
            </footer>
            <Popover.Close className="sr-only">
              Close subtype selector
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
