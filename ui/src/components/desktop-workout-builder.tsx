import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowUp,
  Copy,
  CircleHelp,
  MoreHorizontal,
  Minus,
  Plus,
  Redo2,
  Maximize2,
  Minimize2,
  Undo2,
  X,
  Download,
  Upload,
  ChevronRight,
} from "lucide-react"
import { DesktopSportIcon } from "./desktop-sport-icon"
import { startAnimationLoop } from "@/lib/animation-loop"
import { workoutPresentationSport, workoutSelectionKey } from "@/lib/workout-presentation"
import { calendarAddTypes } from "@/lib/calendar-events"
import { DesktopWorkoutContextMenu } from "./desktop-workout-toolbar"
import { WorkoutDetailNavigation } from "./desktop-workout-personal-fields"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip"
import { DurationField, PaceField } from "./workout-duration-field"
import { useWorkoutFieldValidity } from "./workout-input-validity"
import { WorkoutRpeField } from "./workout-rpe-field"
import {
  cachedTrainingContext,
  trainingCacheScope,
} from "@/lib/training-context"
import {
  plannedValueRows,
  recordedValueRows,
  plannedDraftValue,
  type PlannedValueKey,
  type PlannedValuePresentation,
} from "@/lib/planned-workout-values"
import {
  builderBlock,
  desktopBuilderBlocks,
  desktopTargetUnits,
  displayTarget,
  desktopTargetPresentation,
  desktopBuilderTotals,
  desktopProfileAxis,
  desktopProfileMaximum,
  desktopProfileTicks,
  desktopWorkoutZoneOptions,
  desktopProfileRange,
  resizeDesktopRamp,
  desktopPaletteDropIndex,
  duplicateDesktopBlock,
  changeDesktopTargetShape,
  changeDesktopTargetUnit,
  changeDesktopStepLength,
  reshapeDesktopTarget,
  readDesktopBuilderPreferences,
  rememberDesktopBuilderPreferences,
  targetKind,
  editRpeTarget,
  type DesktopBlockLength,
} from "@/lib/desktop-workout-builder"
import {
  chartSegments,
  findNode,
  insertNodes,
  moveNode,
  paceFactors,
  removeNodes,
  roleNames,
  roles,
  stepLabel,
  updateNodes,
  type Step,
  type WorkoutModel,
  type WorkoutNode,
} from "../../../app-backend/lib/workout-editor-model.mjs"
import { durationClock } from "../../../app-backend/lib/workout-editor-inputs.mjs"
import {
  type SportZoneSettings,
} from "../../../app-backend/lib/workout-editor-zones.mjs"
import type { DesktopWorkoutMetadata } from "./desktop-workout-header"
import "./desktop-workout-builder.css"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog"

export type DesktopPalettePreview = {
  nodes: WorkoutNode[]
  index: number
  position: number
}
type Props = {
  model: WorkoutModel
  commit: (model: WorkoutModel) => void
  zones: SportZoneSettings[]
  selected: string[]
  select: (id: string, multi: boolean, reveal?: boolean) => void
  chart: (unit: string, palettePreview: DesktopPalettePreview | null) => ReactNode
  metadata: DesktopWorkoutMetadata
  onMetadata: (value: DesktopWorkoutMetadata) => void
  onSport: (sport: string) => void
  planned: Record<PlannedValueKey, string>
  onPlanned: (key: PlannedValueKey, value: string, presentation?: PlannedValuePresentation) => void
  autoCalculate: boolean
  onAutoCalculate: (value: boolean) => void
  comment: string
  onComment: (value: string) => void
  comments: { id: string; body: string }[]
  description: string
  onDescription: (value: string) => void
  onSave: (close: boolean) => void
  onClose: () => void
  onDelete?: () => Promise<void> | void
  onReload?: () => void
  canSave: boolean
  saving: boolean
  dirty: boolean
  error: string
  notice: string
  validation: string[]
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  isNew: boolean
  recovery?: ReactNode
  syncAction?: ReactNode
  personalFields?: ReactNode
  descriptionHeading?: ReactNode
  equipment?: ReactNode
  expanded: boolean
  onToggleExpanded: () => void
  settings?: ReactNode
  actions?: ReactNode
  recurrence?: ReactNode
  onUpload?: () => void
  onExport?: () => void
}
function WorkoutOutline({nodes, onSelect}: {nodes: WorkoutNode[]; onSelect: (id: string) => void}) {
  return <div className="dtb-workout-outline">
    {nodes.map(node => <div key={node.id}>
      <button type="button" onClick={() => onSelect(node.id)}>
        <strong>{node.kind === "repeat" ? `Repeat ${node.repetitions} times${node.sets > 1 ? ` · ${node.sets} sets` : ""}` : node.label}</strong>
        {node.kind === "step" && <span>{stepLabel(node)}</span>}
        {node.notes && <span>{node.notes}</span>}
      </button>
      {node.kind === "repeat" && <WorkoutOutline nodes={[...node.steps, ...(node.recovery ? [node.recovery] : []), ...(node.setRecovery ? [node.setRecovery] : [])]} onSelect={onSelect}/>}
    </div>)}
  </div>
}
function MiniProfile({
  model,
  nodes,
}: {
  model: WorkoutModel
  nodes: WorkoutNode[]
}) {
  const parts = chartSegments({ ...model, steps: nodes }).segments
  const total = parts.reduce((sum, p) => sum + p.width, 0) || 1
  const rpe=parts.length>0 && parts.every(part=>part.step.target.kind === "rpe")
  const max = rpe ? 1 : Math.max(1.5, ...parts.flatMap((p) => [p.start, p.end]))
  let left = 0
  return (
    <svg viewBox="0 0 80 32" preserveAspectRatio="none" aria-hidden="true">
      {parts.map((p, i) => {
        const x = (left / total) * 80,
          width = (p.width / total) * 80
        left += p.width
        const top = rpe ? desktopProfileRange(p).high : p.start
        const end = rpe ? top : p.end
        return (
          <polygon
            key={i}
            points={`${x},32 ${x},${30 - (top / max) * 27} ${x + width},${30 - (end / max) * 27} ${x + width},32`}
          />
        )
      })}
    </svg>
  )
}
function TargetNumber({
  label,
  value,
  onChange,
  allowZero = false,
  precision = 2,
  minimum,
  maximum,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  allowZero?: boolean
  precision?: number
  minimum?: number
  maximum?: number
}) {
  const format = useCallback((number: number) => String(Number(number.toFixed(precision))), [precision])
  const [draft, setDraft] = useState(() => format(value))
  const focused = useRef(false)
  const focusValue = useRef(value)
  const { invalid, markInvalid } = useWorkoutFieldValidity()
  useEffect(() => {
    if (!focused.current) { setDraft(format(value)); markInvalid(false) }
  }, [value, markInvalid, format])
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? `Enter a ${allowZero ? "nonnegative" : "positive"} number with at most ${precision} decimal places${minimum != null && maximum != null ? ` from ${minimum} to ${maximum}` : ""}.` : undefined}
      type="text"
      inputMode="decimal"
      className="dtb-target-number"
      value={draft}
      onFocus={(event) => {
        focused.current = true
        focusValue.current = value
        event.currentTarget.select()
      }}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        const amount = Number(next)
        const valid = new RegExp(`^(?:\\d+(?:\\.\\d{0,${precision}})?|\\.\\d{1,${precision}})$`).test(next) && Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0) && (minimum == null || amount >= minimum) && (maximum == null || amount <= maximum)
        markInvalid(!valid)
        if (valid) onChange(amount)
      }}
      onBlur={() => {
        focused.current = false
        if (!invalid) setDraft(format(value))
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          onChange(focusValue.current)
          setDraft(format(focusValue.current))
          markInvalid(false)
        }
      }}
    />
  )
}
function StepTarget({
  step,
  unit,
  model,
  zones,
  change,
  selectZone,
}: {
  step: Step
  unit: string
  model: WorkoutModel
  zones: SportZoneSettings[]
  change: (s: Step) => void
  selectZone: (step: Step, target: Step["target"]) => void
}) {
  let target = step.target
  try {
    target = displayTarget(target, unit, model, zones)
  } catch {
    /* Imported prescriptions remain editable in their original units. */
  }
  const current = target
  const options = desktopWorkoutZoneOptions(model, zones, target.unit || unit).filter(
    (option) => option.target.kind === target.kind
  )
  const presentation = desktopTargetPresentation(target, model, zones)
  if (target.kind === "none")
    return (
      <button
        className="dtb-link"
        type="button"
        onClick={() => {
          const sample = builderBlock(
            "Active",
            model,
            unit,
            "single"
          )[0] as Step
          change({
            ...step,
            target:
              sample.target.kind === "none"
                ? {
                    kind: targetKind(unit),
                    unit,
                    mode: "single",
                    value:
                      unit === "w"
                        ? 150
                        : unit === "bpm"
                          ? 140
                          : paceFactors[unit]
                            ? paceFactors[unit] / (model.thresholds?.pace || 3)
                            : 100,
                  }
                : sample.target,
          })
        }}
      >
        + Add target
      </button>
    )
  const number = (key: "value" | "start" | "end") =>
    target.kind === "rpe" ? <WorkoutRpeField label={key === "value" ? "Target" : key === "start" ? "Range from" : "Range to"} value={target[key] || 1} onChange={value=>change({...step,target:editRpeTarget(current,key,value)})}/> : paceFactors[target.unit!] ? (
      <PaceField
        label={key === "value" ? "Target pace" : `${key} pace`}
        value={target[key] || 0}
        unit={target.unit!.replace("secs", "min")}
        onChange={(value) =>
          change({ ...step, target: { ...current, [key]: value } })
        }
      />
    ) : (
      <TargetNumber
        allowZero={target.kind === "power"}
        label={
          key === "value"
            ? "Target"
            : key === "start"
              ? "Range from"
              : "Range to"
        }
        value={target[key] || 0}
        onChange={(value) =>
          change({
            ...step,
            target: { ...current, [key]: value },
          })
        }
      />
    )
  return (
    <div className="dtb-target-values">
      {target.mode === "single" ? (
        number("value")
      ) : (
        <>
          {number("start")}
          <span>{target.mode === "ramp" ? "→" : "–"}</span>
          {number("end")}
        </>
      )}
      <span className="dtb-target-unit">
        <strong>
          {(target.unit === "%ftp" ? "% FTP" : target.unit === "w" ? "W" : desktopTargetUnits.find(([value]) => value === target.unit)?.[1]) ||
            target.unit.replace("_zone", " zone")}
        </strong>
        {presentation.physical && <span>{presentation.physical}</span>}
      </span>
      {target.kind !== "rpe" && <select
        aria-label="Training zone"
        value={
          options.some((option) => option.id === presentation.zoneId)
            ? presentation.zoneId
            : ""
        }
        onChange={(event) => {
          const zone = options.find((z) => z.id === event.target.value)
          if (zone) selectZone(step, zone.target)
        }}
      >
        <option value="">
          {options.length ? "Select zone…" : "Custom target"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>}
      <button
        type="button"
        className="dtb-subtle"
        aria-label="Remove target"
        onClick={() => change({ ...step, target: { kind: "none" } })}
      >
        <X size={12} />
      </button>
    </div>
  )
}
function StepCard({
  step,
  model,
  unit,
  zones,
  selected,
  onSelect,
  change,
  selectZone,
  add,
  remove,
  duplicate,
  move,
  recoverySlot = false,
  canMoveUp,
  canMoveDown,
  onError,
}: {
  step: Step
  model: WorkoutModel
  unit: string
  zones: SportZoneSettings[]
  selected: boolean
  onSelect: () => void
  change: (step: Step) => void
  selectZone: (step: Step, target: Step["target"]) => void
  add: () => void
  remove: () => void
  duplicate: () => void
  move: (direction: number) => void
  recoverySlot?: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onError: (message: string) => void
}) {
  const cadenceOpen = Boolean(step.cadence)
  return (
    <section
      id={`editor-step-${step.id}`}
      className={`dtb-step-card ${selected ? "dtb-selected" : ""}`}
      onFocusCapture={onSelect}
    >
      {!recoverySlot && <button
        type="button"
        className="dtb-step-remove"
        aria-label={`Remove ${step.label} block`}
        title="Remove block"
        onClick={remove}
      ><X size={16} /></button>}
      <div className="dtb-step-heading">
        <input
          aria-label="Step title"
          value={step.label}
          maxLength={200}
          onChange={(event) => change({ ...step, label: event.target.value })}
        />
        <select
          aria-label="Interval type"
          value={step.role}
          onChange={(event) =>
            change({ ...step, role: event.target.value as Step["role"] })
          }
        >
          {roles.filter(role => ["warmup", "active", "recovery", "cooldown", step.role].includes(role)).map((role) => (
            <option key={role} value={role}>
              {role === "active" ? "Work" : role === "warmup" ? "Warmup" : role === "cooldown" ? "Cooldown" : role === "recovery" ? "Recover" : roleNames[role]}
            </option>
          ))}
        </select>
        <select
          aria-label="Length mode"
          value={step.end.kind === "distance" ? "distance" : "time"}
          onChange={(event) => {
            try {
              change(
                changeDesktopStepLength(
                  step,
                  event.target.value as "time" | "distance",
                  /swim/i.test(model.sport) ? "yd" : "mi",
                  model
                )
              )
              onError("")
            } catch (reason) {
              onError(
                reason instanceof Error
                  ? reason.message
                  : "This step could not be converted."
              )
            }
          }}
        >
          <option value="time">Duration</option>
          <option value="distance">Distance</option>
        </select>
        <select
          aria-label="Target shape"
          value={step.target.kind === "none" ? "single" : step.target.mode}
          disabled={step.target.kind === "none"}
          onChange={(event) => {
            if (step.target.kind === "none") return
            try {
              change({
                ...step,
                target: reshapeDesktopTarget(
                  displayTarget(step.target, unit, model, zones),
                  event.target.value as "single" | "range" | "ramp",
                  model
                ),
              })
              onError("")
            } catch (reason) {
              onError(
                reason instanceof Error
                  ? reason.message
                  : "The target could not be changed."
              )
            }
          }}
        >
          <option value="single">Target</option>
          <option value="range">Range</option>
          <option value="ramp" disabled={step.target.kind === "rpe"}>Ramp</option>
        </select>
      </div>
      <div className="dtb-step-prescription">
        {step.end.kind === "distance" ? (
          <label className="dtb-length">
            <TargetNumber
              label="Step distance"
              precision={5}
              value={step.end.value}
              onChange={(value) =>
                change({
                  ...step,
                  end: { ...step.end, value },
                })
              }
            />
            <select
              aria-label="Distance units"
              value={step.end.unit}
              onChange={(event) => {
                try {
                  change(
                    changeDesktopStepLength(
                      step,
                      "distance",
                      event.target.value,
                      model
                    )
                  )
                  onError("")
                } catch (reason) {
                  onError(
                    reason instanceof Error
                      ? reason.message
                      : "This distance could not be converted."
                  )
                }
              }}
            >
              {["mi", "km", "m", "yd"].map((value) => (
                <option key={value} value={value}>{value === "yd" ? "yds" : value}</option>
              ))}
            </select>
          </label>
        ) : (
          <DurationField
            compactHours
            label="Step duration"
            value={step.end.value}
            onChange={(value) =>
              change({ ...step, end: { ...step.end, value } })
            }
          />
        )}
        <StepTarget
          step={step}
          unit={unit}
          model={model}
          zones={zones}
          change={change}
          selectZone={selectZone}
        />
      </div>
      <div className="dtb-step-tools">
        {!recoverySlot && (
          <>
            <button type="button" onClick={add}>
              <Plus size={13} /> Add step
            </button>
            <button type="button" onClick={remove}>
              <X size={13} /> Remove step
            </button>
          </>
        )}
        {(!/swim/i.test(model.sport) || cadenceOpen) && <button
          type="button"
          onClick={() => {
            change({
              ...step,
              cadence: cadenceOpen ? null : /run/i.test(model.sport) ? { start: 160, end: 170 } : { start: 80, end: 90 },
            })
          }}
        >
          {cadenceOpen ? "× Remove cadence" : "+ Add cadence range"}
        </button>}
        {!recoverySlot && (
          <details className="dtb-step-menu" onClick={event => {
            if (event.target instanceof Element && event.target.closest("button")) event.currentTarget.open = false
          }}>
            <summary aria-label={`More actions for ${step.label}`}>
              <MoreHorizontal size={14} />
            </summary>
            <div>
              <button
                type="button"
                onClick={duplicate}
                aria-label={`Duplicate ${step.label}`}
              >
                <Copy size={13} /> Duplicate step
              </button>
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label={`Move ${step.label} up`}
                disabled={!canMoveUp}
              >
                <ArrowUp size={13} /> Move up
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label={`Move ${step.label} down`}
                disabled={!canMoveDown}
              >
                <ArrowDown size={13} /> Move down
              </button>
            </div>
          </details>
        )}
        <label className="dtb-lap">
          <input
            type="checkbox"
            role="switch"
            checked={Boolean(step.end.pressLap || step.end.kind === "lap")}
            onChange={(event) =>
              change({
                ...step,
                end: {
                  ...step.end,
                  kind: step.end.kind === "lap" ? "time" : step.end.kind,
                  pressLap: event.target.checked,
                },
              })
            }
          />{" "}
          End step on lap button
          <span title="Finish this step by pressing the lap button on your device.">
            <CircleHelp size={14} aria-label="Lap button help" />
          </span>
        </label>
      </div>
      {step.cadence && (
        <div className="dtb-cadence">
          <span>Cadence</span>
          <TargetNumber
            label="Minimum cadence"
            minimum={1}
            maximum={300}
            value={step.cadence.start}
            onChange={(value) =>
              change({
                ...step,
                cadence: {
                  ...step.cadence!,
                  start: value,
                },
              })
            }
          />
          <span>–</span>
          <TargetNumber
            label="Maximum cadence"
            minimum={1}
            maximum={300}
            value={step.cadence.end}
            onChange={(value) =>
              change({
                ...step,
                cadence: { ...step.cadence!, end: value },
              })
            }
          />
          <span>{/run/i.test(model.sport) ? "spm" : "rpm"}</span>
        </div>
      )}
      <div className="dtb-step-notes-container">
      <textarea
        className="dtb-step-notes"
        aria-label="Step notes"
        placeholder="Enter notes"
        maxLength={2000}
        value={step.notes}
        onChange={(event) => change({ ...step, notes: event.target.value })}
      /></div>
    </section>
  )
}
export function DesktopWorkoutBuilder(props: Props) {
  const { model, commit, zones, selected, select } = props
  const presentationSport = workoutPresentationSport(model)
  const workspace = useRef<HTMLDivElement>(null)
  const titleField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Native autoFocus ran during React's DOM commit, forcing the entire new
    // dialog to lay out and scrolling the calendar underneath it. Let its first
    // layout finish, then keep the same initial field focused without scrolling.
    let nextFrame = 0
    let interacted = false
    const interactedWithEditor = () => { interacted = true }
    const editor = workspace.current
    editor?.addEventListener("pointerdown", interactedWithEditor)
    editor?.addEventListener("keydown", interactedWithEditor)
    const firstFrame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        if (!interacted) titleField.current?.focus({ preventScroll: true })
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(nextFrame)
      editor?.removeEventListener("pointerdown", interactedWithEditor)
      editor?.removeEventListener("keydown", interactedWithEditor)
    }
  }, [])
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      workspace.current?.querySelectorAll<HTMLDetailsElement>(".dtb-step-menu[open]").forEach(menu => {
        if (!(event.target instanceof Node) || !menu.contains(event.target)) menu.open = false
      })
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const menus = workspace.current?.querySelectorAll<HTMLDetailsElement>(".dtb-step-menu[open]")
      if (!menus?.length) return
      event.preventDefault()
      event.stopPropagation()
      menus.forEach(menu => { menu.open = false })
      menus[0].querySelector<HTMLElement>("summary")?.focus({preventScroll:true})
    }
    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("keydown", escape, true)
    return () => {
      document.removeEventListener("pointerdown", dismiss)
      document.removeEventListener("keydown", escape, true)
    }
  }, [])
  const descriptionField = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = descriptionField.current
    if (!field) return
    const resize = () => {
      field.style.height = "0px"
      field.style.height = `${Math.max(29.125, field.scrollHeight + 2)}px`
    }
    resize()
    let width = field.parentElement?.clientWidth
    const observer = new ResizeObserver(() => {
      const nextWidth = field.parentElement?.clientWidth
      if (nextWidth !== width) {
        width = nextWidth
        resize()
      }
    })
    const parent = field.parentElement
    if (parent) observer.observe(parent)
    return () => observer.disconnect()
  }, [props.description])
  const preferences = useMemo(() => {
    try {
      return readDesktopBuilderPreferences(
        localStorage,
        trainingCacheScope(),
        model.sport
      )
    } catch {
      return null
    }
  }, [model.sport])
  const [deleting, setDeleting] = useState(false)
  const saving = props.saving || deleting
  const totals = useMemo(() => desktopBuilderTotals(model), [model])
  const chartData = useMemo(() => {
    try {
      return chartSegments(model)
    } catch {
      return { segments: [] }
    }
  }, [model])
  const firstTarget = chartData.segments.find(
    (segment) => segment.step.target.kind !== "none"
  )?.step.target
  const hasRpe = chartData.segments.some(segment=>segment.step.target.kind === "rpe")
  const rpeAxis = hasRpe && chartData.segments.every(segment=>["none","rpe"].includes(segment.step.target.kind))
  const chartMaximum = desktopProfileMaximum(chartData.segments)
  const [unit, setUnit] = useState(() => {
    const preferred =
      !firstTarget && preferences
        ? preferences.unit
        : firstTarget?.kind === "rpe" ? "rpe" : firstTarget?.kind === "hr"
          ? desktopTargetUnits.some(([value]) => value === firstTarget.unit)
            ? firstTarget.unit!
            : "bpm"
          : firstTarget?.kind === "power"
            ? "%ftp"
            : /run|swim/i.test(model.sport)
              ? "%pace"
              : "%ftp"
    if (firstTarget)
      try {
        displayTarget(firstTarget, preferred, model, zones)
      } catch {
        return desktopTargetUnits.some(([value]) => value === firstTarget.unit)
          ? firstTarget.unit!
          : preferred
      }
    return preferred
  })
  const [mode, setMode] = useState<"single" | "range">(
    firstTarget
      ? firstTarget.mode === "single"
        ? "single"
        : "range"
      : preferences?.mode || "range"
  )
  const lastTarget = useRef({
    unit: firstTarget?.unit,
    mode: firstTarget?.mode,
  })
  useEffect(() => {
    if (firstTarget?.unit && lastTarget.current.unit !== firstTarget.unit)
      setUnit(firstTarget.unit)
    if (firstTarget?.mode && lastTarget.current.mode !== firstTarget.mode)
      setMode(firstTarget.mode === "single" ? "single" : "range")
    lastTarget.current = { unit: firstTarget?.unit, mode: firstTarget?.mode }
  }, [firstTarget?.unit, firstTarget?.mode])
  const [localError, setLocalError] = useState("")
  const [rampDrafts, setRampDrafts] = useState<Record<string, string>>({})
  const invalidRampCount = Object.keys(rampDrafts).some(
    (id) => findNode(model.steps, id)?.kind === "repeat"
  )
  const { markInvalid: markRepeatInvalid } = useWorkoutFieldValidity()
  useEffect(() => { markRepeatInvalid(invalidRampCount) }, [invalidRampCount, markRepeatInvalid])
  const [zoom, setZoom] = useState(1)
  const chartScroll = useRef<HTMLDivElement>(null)
  const [canPanForward, setCanPanForward] = useState(true)
  useEffect(() => {
    const viewport = chartScroll.current
    if (!viewport) return
    const update = () => {
      if (viewport.scrollLeft <= 2) setCanPanForward(true)
      else if (viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 2) setCanPanForward(false)
    }
    update()
    viewport.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => {
      observer.disconnect()
      viewport.removeEventListener("scroll", update)
    }
  }, [zoom])
  const [clearOpen, setClearOpen] = useState(false)
  const [setupRequested, setSetupOpen] = useState(
    props.isNew && !model.steps.length
  )
  const setupOpen = setupRequested && !model.steps.length
  const [length, setLength] = useState<DesktopBlockLength>(() => {
    if (preferences) return preferences.length
    const distance = chartData.segments.filter(
      (segment) => segment.step.end.kind === "distance"
    )
    const end =
      distance.length > chartData.segments.length / 2
        ? distance[0]?.step.end
        : undefined
    return end?.kind === "distance"
      ? {
          kind: "distance",
          unit: (["m", "km", "mi", "yd"].includes(end.unit)
            ? end.unit
            : "m") as DesktopBlockLength["unit"],
        }
      : /swim/i.test(model.sport)
        ? { kind: "distance", unit: "yd" }
        : { kind: "time", unit: "s" }
  })
  useEffect(() => {
    try {
      rememberDesktopBuilderPreferences(
        localStorage,
        trainingCacheScope(),
        model.sport,
        { length, unit, mode }
      )
    } catch {
      /* Browser storage is optional. */
    }
  }, [length, unit, mode, model.sport])
  const drag = useRef<{ nodes: WorkoutNode[]; original: WorkoutModel } | null>(null)
  const palettePointer = useRef<{ x: number; y: number } | null>(null)
  const stopPalettePan = useRef<(() => void) | null>(null)
  const [palettePreview, setPalettePreview] = useState<DesktopPalettePreview | null>(null)
  const paletteDropAt = useCallback((x: number, y: number): DesktopPalettePreview | null => {
    const pending = drag.current
    const viewport = chartScroll.current
    const plot = viewport?.querySelector<SVGSVGElement>("svg[data-workout-profile]")
    if (!pending || pending.original !== model || !viewport || !plot) return null
    const visible = viewport.getBoundingClientRect()
    const bounds = plot.getBoundingClientRect()
    const endVisible = bounds.right <= visible.right + 1
    const right = endVisible ? bounds.right + 30 : visible.right
    if (x < visible.left || x > right || y < bounds.top || y > Math.min(visible.bottom, bounds.bottom) || !bounds.width) return null
    const blocks = model.steps.map(node => ({
      width: chartData.segments.filter(part => Boolean(findNode([node], part.step.id))).reduce((sum, part) => sum + part.width, 0),
    }))
    const axis = desktopProfileAxis(model)
    const index = desktopPaletteDropIndex(blocks, (x - bounds.left) / bounds.width * axis.maximum / axis.actual)
    const total = blocks.reduce((sum, block) => sum + block.width, 0)
    return { nodes: pending.nodes, index, position: total ? blocks.slice(0, index).reduce((sum, block) => sum + block.width, 0) / axis.maximum : 0 }
  }, [chartData, model])
  const cancelPaletteDrag = useCallback(() => {
    const nativeDragActive = drag.current !== null
    stopPalettePan.current?.()
    drag.current = null
    palettePointer.current = null
    setPalettePreview(null)
    const viewport = chartScroll.current
    if (nativeDragActive && viewport?.isConnected) {
      // Chromium may retain native HTML-drag auto-scroll after dragend,
      // independently of our canceled animation frames. Retire its scroll
      // layout box synchronously, before paint, without moving the viewport.
      const display = viewport.style.getPropertyValue("display")
      const priority = viewport.style.getPropertyPriority("display")
      const left = viewport.scrollLeft
      const top = viewport.scrollTop
      const focused = document.activeElement as HTMLElement | null
      try {
        viewport.style.setProperty("display", "none", "important")
        viewport.getBoundingClientRect()
      } finally {
        if (display) viewport.style.setProperty("display", display, priority)
        else viewport.style.removeProperty("display")
        if (focused?.isConnected && viewport.contains(focused))
          focused.focus({ preventScroll: true })
        viewport.scrollTo({ left, top, behavior: "instant" })
      }
    }
  }, [])
  const paletteOverChart = palettePreview !== null
  useEffect(() => {
    if (!paletteOverChart) return
    const stop = startAnimationLoop(() => {
      const point = palettePointer.current, viewport = chartScroll.current
      if (drag.current && point && viewport) {
        const bounds = viewport.getBoundingClientRect()
        const delta = point.x < bounds.left + 32 ? -Math.min(12, (bounds.left + 32 - point.x) / 3)
          : point.x > bounds.right - 32 ? Math.min(12, (point.x - bounds.right + 32) / 3) : 0
        if (delta && point.x >= bounds.left && point.x <= bounds.right) {
          const before = viewport.scrollLeft
          viewport.scrollLeft += delta
          if (before !== viewport.scrollLeft) setPalettePreview(paletteDropAt(point.x, point.y))
        }
      }
    })
    stopPalettePan.current = stop
    return () => {
      stop()
      if (stopPalettePan.current === stop) stopPalettePan.current = null
    }
  }, [paletteOverChart, paletteDropAt])
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault()
        event.stopPropagation()
        cancelPaletteDrag()
      }
    }
    window.addEventListener("keydown", cancel, true)
    window.addEventListener("blur", cancelPaletteDrag)
    // Native HTML drag cancellation can retire the source before React's
    // source handler runs. End the gesture at the window boundary as well.
    window.addEventListener("dragend", cancelPaletteDrag, true)
    window.addEventListener("mouseup", cancelPaletteDrag, true)
    return () => {
      window.removeEventListener("keydown", cancel, true)
      window.removeEventListener("blur", cancelPaletteDrag)
      window.removeEventListener("dragend", cancelPaletteDrag, true)
      window.removeEventListener("mouseup", cancelPaletteDrag, true)
    }
  }, [cancelPaletteDrag])
  const date = new Date(`${props.metadata.date}T12:00:00Z`).toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }
  )
  const metrics = cachedTrainingContext().metrics
  const add = (name: string, index = model.steps.length) => {
    if (setupOpen) return
    const nodes = builderBlock(name, model, unit, mode, length)
    commit({ ...model, steps: insertNodes(model.steps, null, index, nodes) })
    select(nodes[0].id, false, true)
  }
  const changeNode = (node: WorkoutNode) =>
    commit({ ...model, steps: updateNodes(model.steps, [node.id], () => node) })
  const renderNodes = (
    nodes: WorkoutNode[],
    parent: string | null = null
  ): ReactNode =>
    nodes.map((node, index) => {
      const remove = () => {
        const group = parent ? findNode(model.steps, parent) : null
        const removeId =
          group?.kind === "repeat" &&
          group.steps.length === 1 &&
          group.steps[0].id === node.id
            ? group.id
            : node.id
        commit({ ...model, steps: removeNodes(model.steps, [removeId]) })
        setLocalError("")
      }
      if (node.kind === "repeat")
        return (
          <section
            className={`dtb-repeat ${selected.includes(node.id) ? "dtb-selected" : ""}`}
            key={node.id}
            id={`editor-step-${node.id}`}
          >
            <div className="dtb-repeat-heading">
              <label>
                {node.label === "Ramp" && node.repetitions === 1
                  ? "Ramp stages"
                  : "Repeats"}{" "}
                <input
                  aria-label={
                    node.label === "Ramp" && node.repetitions === 1
                      ? "Ramp stages"
                      : "Repetitions"
                  }
                  type="number"
                  min={
                    node.label === "Ramp" && node.repetitions === 1 ? "2" : "1"
                  }
                  max="100"
                  value={
                    node.label === "Ramp" && node.repetitions === 1
                      ? (rampDrafts[node.id] ?? node.steps.length)
                      : (rampDrafts[node.id] ?? node.repetitions)
                  }
                  aria-invalid={rampDrafts[node.id] != null || undefined}
                  onChange={(event) => {
                    const count = Number(event.target.value)
                    markRepeatInvalid(!Number.isInteger(count) || count < (node.label === "Ramp" && node.repetitions === 1 ? 2 : 1) || count > 100 || Object.keys(rampDrafts).some(id => id !== node.id && findNode(model.steps, id)?.kind === "repeat"))
                    if (node.label === "Ramp" && node.repetitions === 1) {
                      try {
                        const resized = resizeDesktopRamp(
                          node,
                          Number(event.target.value)
                        )
                        setRampDrafts((current) => {
                          const next = { ...current }
                          delete next[node.id]
                          return next
                        })
                        setLocalError("")
                        changeNode(resized)
                      } catch (reason) {
                        setRampDrafts((current) => ({
                          ...current,
                          [node.id]: event.target.value,
                        }))
                        setLocalError(
                          reason instanceof Error
                            ? reason.message
                            : "Enter a valid ramp stage count."
                        )
                      }
                    } else {
                      const count = Number(event.target.value)
                      if (
                        !Number.isInteger(count) ||
                        count < 1 ||
                        count > 100
                      ) {
                        setRampDrafts((current) => ({
                          ...current,
                          [node.id]: event.target.value,
                        }))
                        setLocalError("Repeat counts must be 1 to 100.")
                      } else {
                        setRampDrafts((current) => {
                          const next = { ...current }
                          delete next[node.id]
                          return next
                        })
                        setLocalError("")
                        changeNode({ ...node, repetitions: count })
                      }
                    }
                  }}
                />{" "}
                {node.label === "Ramp" && node.repetitions === 1
                  ? "steps"
                  : "times"}
              </label>
              {node.sets > 1 && (
                <label>
                  Sets{" "}
                  <input
                    aria-label="Sets"
                    type="number"
                    min="1"
                    max="100"
                    value={node.sets}
                    onChange={(event) =>
                      changeNode({ ...node, sets: Number(event.target.value) })
                    }
                  />
                </label>
              )}
              <button
                aria-label="Duplicate repeat"
                title="Duplicate block"
                type="button"
                onClick={() => {
                  const copy = duplicateDesktopBlock(node)
                  commit({
                    ...model,
                    steps: insertNodes(model.steps, parent, index + 1, [copy]),
                  })
                  select(copy.id, false, true)
                }}
              >
                <Copy size={14} />
              </button>
              <button aria-label="Remove repeat" type="button" onClick={remove}>
                <X size={16} />
              </button>
            </div>
            {renderNodes(node.steps, node.id)}
            {node.recovery && (
              <div className="dtb-recovery">
                {renderNodes([node.recovery], node.id)}
                <label>
                  <input
                    type="checkbox"
                    checked={node.finalRecovery}
                    onChange={(event) =>
                      changeNode({
                        ...node,
                        finalRecovery: event.target.checked,
                      })
                    }
                  />{" "}
                  Include final recovery
                </label>
              </div>
            )}
            {node.setRecovery && (
              <div className="dtb-recovery">
                {renderNodes([node.setRecovery], node.id)}
              </div>
            )}
            <button
              type="button"
              className="dtb-link"
              onClick={() =>
                changeNode({
                  ...node,
                  steps: [
                    ...node.steps,
                    builderBlock("Active", model, unit, mode, length)[0],
                  ],
                })
              }
            >
              + Add step to repeat
            </button>
          </section>
        )
      return (
        <StepCard
          key={node.id}
          step={node}
          canMoveUp={index > 0}
          canMoveDown={index < nodes.length - 1}
          model={model}
          unit={unit}
          zones={zones}
          selected={selected.includes(node.id)}
          onError={setLocalError}
          onSelect={() => {
            if (!selected.includes(node.id)) select(node.id, false)
          }}
          selectZone={(step, target) => {
            try {
              changeNode({...step, target})
              setLocalError("")
            } catch (error) { setLocalError(error instanceof Error ? error.message : "The zone could not be applied.") }
          }}
          change={changeNode}
          remove={remove}
          add={() => {
            const step = builderBlock("Active", model, unit, mode, length)[0]
            commit({
              ...model,
              steps: insertNodes(model.steps, parent, index + 1, [step]),
            })
          }}
          duplicate={() => {
            const copy = duplicateDesktopBlock(node)
            commit({
              ...model,
              steps: insertNodes(model.steps, parent, index + 1, [copy]),
            })
          }}
          move={(direction) =>
            commit({
              ...model,
              steps: moveNode(
                model.steps,
                node.id,
                parent,
                index + (direction < 0 ? -1 : 2)
              ),
            })
          }
          recoverySlot={Boolean(
            parent &&
            (() => {
              const p = findNode(model.steps, parent)
              return (
                p?.kind === "repeat" &&
                (p.recovery?.id === node.id || p.setRecovery?.id === node.id)
              )
            })()
          )}
        />
      )
    })
  const palette = desktopBuilderBlocks.map((name) => ({
    name,
    nodes: builderBlock(name, model, unit, mode, length),
  }))
  const distance = props.planned.distance_meters || "—"
  return (
    <div ref={workspace} className="dtb-workspace" data-sport={presentationSport}>
      {props.recovery}
      <header className="dtb-header">
        <div className="dtb-date-row">
          <label className="desktop-workout-date-edit">
            <span className="desktop-workout-weekday">
              {date.split(", ")[0]}
            </span>{" "}
            {date.split(", ").slice(1).join(", ")}
            <input
              type="date"
              required
              aria-label="Workout date"
              value={props.metadata.date}
              disabled={saving}
              onInput={(event) =>
                props.onMetadata({
                  ...props.metadata,
                  date: event.currentTarget.value,
                })
              }
              onChange={(event) =>
                props.onMetadata({
                  ...props.metadata,
                  date: event.target.value,
                })
              }
            />
          </label>
          <label
            className="desktop-workout-time-edit"
            data-empty={!props.metadata.time || undefined}
          >
            <input
              type="time"
              aria-label="Workout start time"
              value={props.metadata.time}
              disabled={saving}
              onInput={(event) =>
                props.onMetadata({
                  ...props.metadata,
                  time: event.currentTarget.value,
                })
              }
              onChange={(event) =>
                props.onMetadata({
                  ...props.metadata,
                  time: event.target.value,
                })
              }
            />
            {!props.metadata.time && (
              <span aria-hidden="true">Enter Time ▾</span>
            )}
          </label>
          <div className="desktop-workout-fitness">
            {(["fitness", "fatigue", "form"] as const).map(
              (key) =>
                metrics[key] != null && (
                  <span data-training-metric={key} key={key}>
                    {key[0].toUpperCase() + key.slice(1)}{" "}
                    <strong>{Math.round(metrics[key]!)}</strong>
                  </span>
                )
            )}
          </div>
          <div className="dtb-window-tools">
            <DesktopWorkoutContextMenu
              rootRef={workspace}
              disabled={saving}
              settings={<>
                {props.settings || <label><input type="checkbox" disabled={saving} checked={props.autoCalculate} onChange={event => props.onAutoCalculate(event.target.checked)} /> Automatically calculate planned values</label>}
                <label>New blocks
                  <select aria-label="New block length" disabled={saving || setupOpen} value={length.kind} onChange={event => setLength({kind:event.target.value as DesktopBlockLength["kind"],unit:event.target.value === "time" ? "s" : /swim/i.test(model.sport) ? "yd" : "mi"})}>
                    <option value="time">Duration</option><option value="distance">Distance</option>
                  </select>
                </label>
                {length.kind === "distance" && <label>Distance units
                  <select aria-label="New block distance units" disabled={saving || setupOpen} value={length.unit} onChange={event => setLength({...length,unit:event.target.value as DesktopBlockLength["unit"]})}>
                    {["mi","km","m","yd"].map(value => <option key={value} value={value}>{value === "yd" ? "yds" : value}</option>)}
                  </select>
                </label>}
              </>}
              actions={<>
                <button type="button" disabled={saving || !props.canUndo} onClick={() => {setRampDrafts({});setLocalError("");props.undo()}}><Undo2 size={15}/> Undo</button>
                <button type="button" disabled={saving || !props.canRedo} onClick={() => {setRampDrafts({});setLocalError("");props.redo()}}><Redo2 size={15}/> Redo</button>
                <button type="button" disabled={saving || !model.steps.length} onClick={() => setClearOpen(true)}><X size={15}/> Clear Blocks</button>
                {props.actions}
              </>}
            />
            <button
              type="button"
              aria-label={
                props.expanded ? "Restore workout size" : "Expand workout"
              }
              disabled={saving}
              onClick={props.onToggleExpanded}
            >
              {props.expanded ? (
                <Minimize2 size={16} />
              ) : (
                <Maximize2 size={16} />
              )}
            </button>
            <button
              type="button"
              aria-label="Close workout builder"
              disabled={saving}
              onClick={props.onClose}
            >
              <X size={19} />
            </button>
          </div>
        </div>
        <div className="dtb-repeat-status">
          {props.recurrence || "Does not repeat"}
        </div>
        <div className="dtb-build-row">
          <div className="dtb-overview">
            <input
              ref={titleField}
              aria-label="Workout title"
              placeholder="Untitled Workout"
              maxLength={200}
              value={model.name}
              disabled={saving}
              onChange={(event) =>
                props.onMetadata({
                  ...props.metadata,
                  name: event.target.value,
                })
              }
            />
            <div>
              <span className="dtb-sport-picker">
                <DesktopSportIcon sport={presentationSport} />
                <select
                  aria-label="Workout sport"
                  title="Changing sport recalculates planned values from the workout blocks"
                  disabled={saving}
                  value={workoutSelectionKey(model)}
                  onChange={(event) => props.onSport(event.target.value)}
                >
                  {[...calendarAddTypes.filter(type=>type.sport!=="Note" && type.label!=="Sauna").map(type=>[workoutSelectionKey(type),type.label]),
                    ["VirtualRide", "Virtual Bike"],
                    ["VirtualRun", "Virtual Run"],
                    ["TrailRun", "Trail Run"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </span>
              <strong>
                {totals.unknownTime ? "≥ " : ""}
                {props.planned.duration_seconds ||
                  (model.steps.length
                    ? durationClock(totals.seconds).replace(/^0(?=\d:)/, "")
                    : "--:--:--")}
              </strong>
              <strong>
                {distance}{" "}
                <small>{/swim/i.test(model.sport) ? "yds" : /rowing/i.test(model.sport) ? "m" : "mi"}</small>
              </strong>
              <strong title="Estimated planned training stress from step targets">
                {props.planned.tss || "—"} <small>TSS</small>
              </strong>
            </div>
            <span>
              {presentationSport === "Ride"
                ? "Bike"
                : presentationSport === "WeightTraining"
                  ? "Strength"
                  : presentationSport}
            </span>
            {props.onExport && <button type="button" className="desktop-workout-export" title="Export workout" aria-label="Export workout" onClick={props.onExport} disabled={saving || !model.steps.length}><Download size={17}/></button>}
          </div>
          <div className="desktop-workout-view-actions dtb-view-actions">
            <button type="button" disabled={saving || !props.onUpload} onClick={props.onUpload} title={props.onUpload ? "Upload a file" : "Save the workout before uploading a recording"}><Upload size={14}/> Upload</button>
            <button type="button" disabled title="Analysis requires a completed recording">Analyze</button>
            <button type="button" disabled title="Analysis requires a completed recording">Analyze 360</button>
          </div>
          <div className="dtb-palette">
            <h3>
              Click or drag blocks
              <br />
              to build workout
              <span title="Click a block to append it. Drag a block onto the workout profile to choose its position."><CircleHelp size={15} aria-label="Workout block help"/></span>
            </h3>
            <TooltipProvider delay={150}><div>
              {palette.map(({ name, nodes }) => (
                <Tooltip key={name}><TooltipTrigger render={<button
                  key={name}
                  aria-label={`Add ${name}`}
                  type="button"
                  draggable={!saving && !setupOpen}
                  disabled={saving || setupOpen}
                  onDragStart={(event) => {
                    drag.current = { nodes: builderBlock(name, model, unit, mode, length), original: model }
                    event.dataTransfer.effectAllowed = "copy"
                    event.dataTransfer.setData("text/plain", name)
                    const blank = document.createElement("canvas")
                    blank.width = blank.height = 1
                    event.dataTransfer.setDragImage(blank, 0, 0)
                  }}
                  onDragEnd={cancelPaletteDrag}
                  onClick={() => add(name)}
                />}>
                  <MiniProfile model={model} nodes={nodes} />
                </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={9} className="desktop-workout-block-tooltip" arrowClassName="desktop-workout-block-tooltip-arrow">{name}</TooltipContent>
                </Tooltip>
              ))}
            </div></TooltipProvider>
          </div>
          <div className="dtb-unit-controls">
            <label>
              Units
              <select
                aria-label="Workout target units"
                value={unit}
                disabled={saving}
                onChange={(event) => {
                  try {
                    const next = changeDesktopTargetUnit(
                      model,
                      event.target.value,
                      zones
                    )
                    commit(next)
                    setUnit(event.target.value)
                    setLocalError("")
                  } catch (reason) {
                    setLocalError(
                      reason instanceof Error
                        ? reason.message
                        : "The intensity units could not be changed."
                    )
                  }
                }}
              >
                {desktopTargetUnits.map(([value, label]) => (
                  <option key={value} value={value}>
                      {value === "%pace" && /ride|bike/i.test(model.sport) ? "% Threshold Speed" : label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <select
                aria-label="Default target shape"
                value={mode}
                disabled={saving}
                onChange={(event) => {
                  try {
                    const nextMode = event.target.value as "single" | "range"
                    commit(
                      changeDesktopTargetShape(model, nextMode, unit, zones)
                    )
                    setMode(nextMode)
                    setLocalError("")
                  } catch (reason) {
                    setLocalError(
                      reason instanceof Error
                        ? reason.message
                        : "The target shape could not be changed."
                    )
                  }
                }}
              >
                <option value="range">Range</option>
                <option value="single">Target</option>
              </select>
              <button
                type="button"
                disabled={saving || !model.steps.length}
                onClick={() => setClearOpen(true)}
              >
                Clear Blocks
              </button>
            </div>
          </div>
        </div>
      </header>
      <div
        className="dtb-chart-row"
        inert={saving || undefined}
        onDragOver={(event) => {
          if (drag.current) {
            event.preventDefault()
            event.dataTransfer.dropEffect = "copy"
            palettePointer.current = { x: event.clientX, y: event.clientY }
            setPalettePreview(paletteDropAt(event.clientX, event.clientY))
          }
        }}
        onDragLeave={(event) => {
          if (drag.current && !paletteDropAt(event.clientX, event.clientY)) {
            palettePointer.current = null
            setPalettePreview(null)
          }
        }}
        onDrop={(event) => {
          if (drag.current) {
            event.preventDefault()
            const insertion = paletteDropAt(event.clientX, event.clientY)
            if (insertion) {
              commit({ ...model, steps: insertNodes(model.steps, null, insertion.index, insertion.nodes) })
              select(insertion.nodes[0].id, false, true)
            }
            cancelPaletteDrag()
          }
        }}
      >
        {setupOpen && (
          <section
            className="dtb-setup"
            role="group"
            aria-label="Workout builder setup"
          >
            <h3>Choose how you would like to build this workout.</h3>
            <div>
              <select
                aria-label="Build workout by"
                value={length.kind}
                onChange={(event) =>
                  setLength({
                    kind: event.target.value as DesktopBlockLength["kind"],
                    unit:
                      event.target.value === "time"
                        ? "s"
                        : /swim/i.test(model.sport)
                          ? "yd"
                          : "mi",
                  })
                }
              >
                <option value="time">Duration</option>
                <option value="distance">Distance</option>
              </select>
              {length.kind === "distance" && (
                <select
                  aria-label="Builder distance units"
                  value={length.unit}
                  onChange={(event) =>
                    setLength({
                      ...length,
                      unit: event.target.value as DesktopBlockLength["unit"],
                    })
                  }
                >
                  {["mi", "km", "m", "yd"].map((value) => (
                    <option key={value} value={value}>
                      {value === "yd" ? "yds" : value}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="Builder intensity units"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              >
                {desktopTargetUnits.map(([value, label]) => (
                  <option key={value} value={value}>
                    {value === "%pace" && /ride|bike/i.test(model.sport) ? "% Threshold Speed" : label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Builder target shape"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as "single" | "range")
                }
              >
                <option value="range">Range</option>
                <option value="single">Target</option>
              </select>
            </div>
            <button
              type="button"
              className="dtb-primary"
              onClick={() => setSetupOpen(false)}
            >
              Continue
            </button>
          </section>
        )}
        <div className="dtb-chart-axis" aria-hidden="true">
          {hasRpe && !rpeAxis ? <span>Mixed units</span> : desktopProfileTicks(chartMaximum, rpeAxis).map(value => (
            <span key={value} style={{ top: `${(180 - value / chartMaximum * 180) / 195 * 100}%` }}>
              {rpeAxis ? Math.round(value * 10) : `${Math.round(value * 100)}%`}
            </span>
          ))}
        </div>
        <div className="dtb-chart-scroll" ref={chartScroll}>
          <div style={{ width: `${zoom * 100}%` }}>{props.chart(unit, palettePreview)}</div>
        </div>
        <div className="dtb-chart-zoom">
          <button
            type="button"
            className="dtb-chart-pan"
            aria-label={`Scroll workout profile ${canPanForward ? "forward" : "backward"}`}
            disabled={zoom === 1}
            onClick={() => {
              cancelPaletteDrag()
              const viewport = chartScroll.current
              if (viewport) viewport.scrollBy({ left: viewport.clientWidth * (canPanForward ? 0.75 : -0.75), behavior: "smooth" })
            }}
          ><ChevronRight size={27} style={{ transform: canPanForward || zoom === 1 ? undefined : "rotate(180deg)" }}/></button>
          <div className="dtb-chart-zoom-controls">
          <button
            type="button"
            aria-label="Zoom out workout profile"
            disabled={zoom === 1}
            onClick={() => {
              cancelPaletteDrag()
              const next = Math.max(1, zoom - 1)
              if (next === 1) {
                // Reset now: a rapid zoom-in can otherwise restore the wide
                // plot before the browser clamps its previous scroll position.
                chartScroll.current?.scrollTo({ left: 0, behavior: "instant" })
                setCanPanForward(true)
              }
              setZoom(next)
            }}
          >
            <Minus size={14} />
          </button>
          <span>{zoom}x</span>
          <button
            type="button"
            aria-label="Zoom in workout profile"
            disabled={zoom === 5}
            onClick={() => {
              cancelPaletteDrag()
              setZoom((n) => Math.min(5, n + 1))
            }}
          >
            <Plus size={14} />
          </button>
          </div>
        </div>
      </div>
      <div className="dtb-lower desktop-workout-details-shell">
        <WorkoutDetailNavigation />
        <aside className="dtb-summary">
          <div className="dtb-summary-grid">
            <section
              className="desktop-workout-totals"
              aria-label="Planned and completed values"
            >
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Planned</th>
                    <th>Completed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plannedValueRows(presentationSport).map(
                    ({ key, rowKey = key, presentation, label, unit: rowUnit, planned }) => (
                      <tr key={rowKey}>
                        <th>
                          {planned === false ? <span>{label}</span> : <label htmlFor={`builder-${rowKey}`}>{label}</label>}
                        </th>
                        <td>
                          {planned !== false && <input
                            id={`builder-${rowKey}`}
                            aria-label={`Planned ${label.toLowerCase()}`}
                            disabled={saving || key === "normalized_power"}
                            value={plannedDraftValue(props.planned, key, presentationSport, presentation)}
                            onChange={(event) =>
                              props.onPlanned(key, event.target.value, presentation)
                            }
                          />}
                        </td>
                        <td>
                          <output
                            aria-label={`Completed ${label.toLowerCase()}`}
                          >
                            —
                          </output>
                        </td>
                        <td>{rowUnit}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
              <table className="dtb-recorded" aria-label="Recorded minimum average maximum">
                <thead>
                  <tr>
                    <th />
                    <th>Min</th>
                    <th>Avg</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {recordedValueRows(presentationSport).map(({ label }) => (
                    <tr key={label}>
                      <th>{label}</th>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {props.equipment}
            </section>
            <div className="dtb-text">
              {props.descriptionHeading || <h3>Description</h3>}
              <textarea
                ref={descriptionField}
                aria-label="Workout description"
                value={props.description}
                maxLength={12000}
                disabled={saving}
                onChange={(event) => props.onDescription(event.target.value)}
              />
              <h3>Post-activity Comments</h3>
              {props.comments.map((comment) => (
                <p key={comment.id}>{comment.body}</p>
              ))}
              <textarea
                aria-label="New planned workout comment"
                placeholder="Enter a new comment"
                maxLength={2000}
                value={props.comment}
                disabled={saving}
                onChange={(event) => props.onComment(event.target.value)}
              />
              {props.personalFields}
              {model.steps.length > 0 && <section className="dtb-workout-outline-section">
                <h3>Workout Details</h3>
                <WorkoutOutline nodes={model.steps} onSelect={id => select(id, false, true)}/>
              </section>}
            </div>
          </div>
        </aside>
        <main className="dtb-details" aria-label="Workout Details Editor">
          <div className="dtb-details-heading">
            <h3>Workout Details Editor</h3>
          </div>
          <fieldset disabled={saving}>
            {renderNodes(model.steps)}
            {!model.steps.length && (
              <div className="dtb-empty">
                Click or drag a block above to start building your workout.
              </div>
            )}
            <button
              className="dtb-link dtb-add-last"
              type="button"
              disabled={setupOpen}
              onClick={() => add("Active")}
            >
              + Add step
            </button>
          </fieldset>
        </main>
      </div>
      <footer className="dtb-footer">
        <div className="dtb-footer-status">
          <label>
            <input
              type="checkbox"
              checked={props.autoCalculate}
              disabled={saving}
              onChange={(event) => props.onAutoCalculate(event.target.checked)}
            />{" "}
            Automatically calculate planned values
          </label>
          {(localError || props.error) && (
            <p role="alert">
              {localError || props.error}
              {props.syncAction || (props.onReload && props.error && (
                <button
                  type="button"
                  className="dtb-link"
                  onClick={props.onReload}
                >
                  Review remote version
                </button>
              ))}
            </p>
          )}
          {!props.error && props.validation.length > 0 && (
            <p role="status">{props.validation.slice(0, 2).join(" · ")}</p>
          )}
          {props.notice && <p role="status">{props.notice}</p>}
        </div>
        {props.onDelete && !props.isNew && (
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setDeleting(true)
              try {
                await props.onDelete?.()
              } catch (reason) {
                setLocalError(
                  reason instanceof Error
                    ? reason.message
                    : "The workout could not be deleted."
                )
              } finally {
                setDeleting(false)
              }
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
        <button type="button" disabled={saving} onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!props.canSave || saving || invalidRampCount}
          onClick={() => {
            setLocalError("")
            props.onSave(false)
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="dtb-primary"
          disabled={
            saving ||
            invalidRampCount ||
            (!props.canSave && (props.dirty || props.isNew))
          }
          onClick={() => {
            setLocalError("")
            if (props.canSave) props.onSave(true)
            else props.onClose()
          }}
        >
          Save &amp; Close
        </button>
      </footer>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all workout blocks?</AlertDialogTitle>
            <AlertDialogDescription>
              You can restore them with Undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep blocks</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                commit({ ...model, steps: [] })
                setSetupOpen(true)
                setClearOpen(false)
              }}
            >
              Clear blocks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
