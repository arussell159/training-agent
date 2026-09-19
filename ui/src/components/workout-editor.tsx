import { canEditWorkout } from "@/lib/workout-permissions"
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Ellipsis,
  GripVertical,
  LoaderCircle,
  Pencil,
  Plus,
  Redo2,
  Repeat2,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  MobileActionMenu,
  MobileSelect,
} from "@/components/ui/mobile-native-controls"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiFetch } from "@/lib/api-client"
import {
  cachedTrainingContext,
  rememberTrainingContext,
  trainingCacheScope,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"
import {
  chartSegments,
  clone,
  copyNodes,
  defaultTarget,
  distanceFactors,
  expandSteps,
  findNode,
  insertNodes,
  makeTemplate,
  moveNode,
  newRepeat,
  newStep,
  paceFactors,
  removeNodes,
  roleNames,
  round,
  stepLabel,
  templateNames,
  uid,
  updateNodes,
  validateWorkout,
  workoutOutline,
  workoutTotals,
  type ImportResult,
  type Role,
  type Step,
  type Target,
  type WorkoutModel,
  type WorkoutNode,
  type Repeat,
} from "../../../app-backend/lib/workout-editor-model.mjs"
import {
  workoutZoneOptions,
  sportZoneSettings,
  type SportZoneSettings,
} from "../../../app-backend/lib/workout-editor-zones.mjs"
import { DurationField, PaceField } from "@/components/workout-duration-field"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  durationClock,
  editorUnits,
  editorTarget,
} from "../../../app-backend/lib/workout-editor-inputs.mjs"
import "./workout-editor.css"

const ZoneSettingsContext = createContext<SportZoneSettings[]>([])
type Loaded = ImportResult & {
  revision: string
  scheduledTime: string
  zoneSettings?: SportZoneSettings[]
  zoneError?: string
  isNew?: boolean
}
type SavedBlock = {
  id: string
  name?: string
  sport: string
  steps: WorkoutNode[]
}
type Draft = {
  model: WorkoutModel
  revision: string
  creationId?: string
  creationAttempted?: boolean
  savedId?: string
}
const tones: Record<Role, string> = {
  warmup: "#66a8a0",
  active: "#5686de",
  recovery: "#9bc3b9",
  rest: "#b7bdc8",
  cooldown: "#79aab8",
  other: "#a394c2",
}

function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  options: (string | { value: string; label: string })[]
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const chosen = options.find(
    (o) => (typeof o === "string" ? o : o.value) === value
  )
  return (
    <label className="we-field">
      <span>{label}</span>
      <MobileSelect
        aria-label={label}
        className="w-full"
        value={value}
        disabled={disabled}
        options={options.map((option) =>
          typeof option === "string" ? { value: option, label: option } : option
        )}
        onValueChange={onChange}
      >
        <Select
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            if (v != null) onChange(v)
          }}
        >
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue>
              {typeof chosen === "string" ? chosen : chosen?.label || value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => {
              const v = typeof o === "string" ? o : o.value
              return (
                <SelectItem key={v} value={v}>
                  {typeof o === "string" ? o : o.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </MobileSelect>
    </label>
  )
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  unit,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
  unit?: string
}) {
  return (
    <label className="we-field">
      <span>
        {label
          .replace(" target", "")
          .replace("Range from", "From")
          .replace("Range to", "To")}
        {unit ? " (" + unit + ")" : ""}
      </span>
      <Input
        aria-label={label}
        type="number"
        min={min}
        step={step}
        value={Number.isFinite(value) ? round(value, 5) : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
    </label>
  )
}
function TargetShape({
  target,
  onChange,
}: {
  target: Target
  onChange: (t: Target) => void
}) {
  if (target.kind === "none") return null
  return (
    <Choice
      label="Target shape"
      value={target.mode}
      options={(target.unit.includes("zone")
        ? ["single", "range"]
        : ["single", "range", "ramp"]
      ).map((value) => ({
        value,
        label: { single: "Single", range: "Range", ramp: "Ramp" }[value]!,
      }))}
      onChange={(mode) =>
        onChange({
          ...target,
          mode: mode as "single" | "range" | "ramp",
          ...(mode === "single"
            ? { value: target.value ?? target.start ?? 1 }
            : {
                start: target.start ?? target.value ?? 1,
                end: target.end ?? target.value ?? 1,
              }),
        })
      }
    />
  )
}
function StepHeadingFields({
  step,
  model,
  onChange,
}: {
  step: Step
  model: WorkoutModel
  onChange: (s: Step) => void
}) {
  const settings = useContext(ZoneSettingsContext)
  const displayed = editorTarget(
    step.target,
    model.sport,
    settings,
    model.thresholds
  )
  return (
    <div className="we-heading-fields">
      <Choice
        label="Measure"
        value={step.end.kind === "lap" ? "time" : step.end.kind}
        options={[
          { value: "time", label: "Time" },
          { value: "distance", label: "Distance" },
        ]}
        onChange={(kind) =>
          onChange({
            ...step,
            end: {
              kind: kind as "time" | "distance",
              value:
                kind === "distance"
                  ? /swim/i.test(model.sport)
                    ? 100
                    : 1
                  : 60,
              unit:
                kind === "distance" ? editorUnits(model.sport).distance : "s",
              ...(step.end.pressLap || step.end.kind === "lap"
                ? { pressLap: true }
                : {}),
            },
          })
        }
      />
      {displayed && (
        <TargetShape
          target={displayed}
          onChange={(target) => onChange({ ...step, target })}
        />
      )}
    </div>
  )
}
function Action({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
function DropSlot({ parent, index }: { parent: string | null; index: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `insert:${parent || "root"}:${index}`,
    data: { parent, index },
  })
  return (
    <div
      ref={setNodeRef}
      className={`we-insert ${isOver ? "we-insert-active" : ""}`}
      aria-label={`Insert at position ${index + 1}`}
    />
  )
}
function BlockProfile({
  model,
  nodes,
}: {
  model: WorkoutModel
  nodes: WorkoutNode[]
}) {
  let segments: ReturnType<typeof chartSegments>["segments"]
  try {
    segments = chartSegments({ ...model, steps: nodes }).segments
  } catch {
    segments = []
  }
  const total = segments.reduce((n, s) => n + s.width, 0) || 1
  const maximum = Math.max(1.3, ...segments.flatMap((s) => [s.start, s.end]))
  let offset = 0
  return (
    <svg
      className="we-block-mini"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {segments.map((segment, index) => {
        const x = (offset / total) * 100,
          w = (segment.width / total) * 100
        offset += segment.width
        const top = (v: number) => 30 - Math.max(2, (v / maximum) * 27)
        return (
          <polygon
            key={index}
            points={[
              x + ",30",
              x + "," + top(segment.start),
              x + w + "," + top(segment.end),
              x + w + ",30",
            ].join(" ")}
            fill="#2455c7"
            stroke="var(--background)"
            strokeWidth=".5"
          />
        )
      })}
    </svg>
  )
}
function PaletteBlock({
  name,
  id,
  onAdd,
  model,
  nodes,
}: {
  name: string
  id: string
  onAdd: () => void
  model: WorkoutModel
  nodes: WorkoutNode[]
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: "palette:" + id,
    data: { template: id },
  })
  return (
    <div
      ref={setNodeRef}
      className={"we-palette-block " + (isDragging ? "opacity-40" : "")}
    >
      <button
        type="button"
        className="we-drag"
        {...listeners}
        {...attributes}
        aria-label={"Drag " + name}
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="we-block-button"
        aria-label={"Add " + name}
        title={name}
      >
        <BlockProfile model={model} nodes={nodes} />
      </button>
    </div>
  )
}
type NodeListProps = {
  nodes: WorkoutNode[]
  parent: string | null
  selected: string[]
  select: (id: string, multi: boolean) => void
  move: (id: string, parent: string | null, index: number) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  model: WorkoutModel
  change: (node: WorkoutNode) => void
  insert: (parent: string | null, index: number) => void
}
function NodeList(props: NodeListProps) {
  return (
    <div className="we-step-list">
      <DropSlot parent={props.parent} index={0} />
      {props.nodes.map((n, index) => (
        <div key={n.id}>
          <NodeRow {...props} node={n} index={index} />
          <DropSlot parent={props.parent} index={index + 1} />
        </div>
      ))}
    </div>
  )
}
function NodeRow({
  node,
  index,
  recoverySlot = false,
  ...props
}: NodeListProps & {
  node: WorkoutNode
  index: number
  recoverySlot?: boolean
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: node.id,
    data: { node: node.id },
    disabled: recoverySlot,
  })
  const selected = props.selected.includes(node.id)
  return (
    <section
      ref={setNodeRef}
      className={[
        "we-node",
        selected ? "we-node-selected" : "",
        node.kind === "repeat" ? "we-repeat" : "",
        isDragging ? "opacity-35" : "",
      ].join(" ")}
      id={"editor-step-" + node.id}
      aria-label={node.label || "Workout step"}
    >
      <div className="we-node-heading">
        {!recoverySlot && (
          <button
            type="button"
            className="we-drag"
            {...listeners}
            {...attributes}
            aria-label={"Move " + node.label}
          >
            <GripVertical size={16} />
          </button>
        )}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => props.select(node.id, true)}
          aria-label={"Select " + node.label}
        />
        {node.kind === "repeat" ? (
          <RepeatFields
            group={node}
            sets={node.sets > 1}
            onChange={props.change}
          />
        ) : (
          <>
            <span
              className="we-role-mark"
              title={roleNames[node.role]}
              style={{ background: tones[node.role] }}
            />
            <Input
              aria-label="Step label"
              className="we-step-name"
              value={node.label}
              onFocus={() => props.select(node.id, false)}
              onChange={(e) => props.change({ ...node, label: e.target.value })}
            />
            <StepHeadingFields
              step={node}
              model={props.model}
              onChange={props.change}
            />
          </>
        )}
        <div className="we-row-actions">
          {!recoverySlot && (
            <>
              <Action
                label={"Move " + node.label + " up"}
                disabled={index === 0}
                onClick={() => props.move(node.id, props.parent, index - 1)}
              >
                <ArrowUp size={14} />
              </Action>
              <Action
                label={"Move " + node.label + " down"}
                disabled={index === props.nodes.length - 1}
                onClick={() => props.move(node.id, props.parent, index + 2)}
              >
                <ArrowDown size={14} />
              </Action>
            </>
          )}
          <Action
            label={"Duplicate " + node.label}
            onClick={() => props.duplicate(node.id)}
          >
            <Copy size={14} />
          </Action>
          <Action
            label={"Delete " + node.label}
            onClick={() => props.remove(node.id)}
          >
            <Trash2 size={14} />
          </Action>
        </div>
      </div>
      {node.kind === "step" ? (
        <div
          className="we-inline-fields"
          onFocusCapture={() => props.select(node.id, false)}
        >
          <StepFields step={node} model={props.model} onChange={props.change} />
        </div>
      ) : (
        <>
          <div className="we-repeat-children">
            <div className={node.sets > 1 ? "we-repeat we-nested-set" : ""}>
              {node.sets > 1 && (
                <RepeatFields group={node} onChange={props.change} />
              )}
              <NodeList {...props} nodes={node.steps} parent={node.id} />
              {node.recovery && (
                <div className="we-recovery">
                  <NodeRow
                    {...props}
                    node={node.recovery}
                    nodes={node.steps}
                    parent={node.id}
                    index={node.steps.length - 1}
                    recoverySlot
                  />
                </div>
              )}
            </div>
            {node.setRecovery && node.sets > 1 && (
              <div className="we-recovery">
                <NodeRow
                  {...props}
                  node={node.setRecovery}
                  index={0}
                  recoverySlot
                />
              </div>
            )}
          </div>
        </>
      )}
      {node.kind === "step" && (
        <button
          type="button"
          className="we-add-step"
          onClick={() => props.insert(props.parent, index + 1)}
        >
          <Plus size={13} /> Add step
        </button>
      )}
    </section>
  )
}
function RepeatFields({
  group,
  sets = false,
  onChange,
}: {
  group: Repeat
  sets?: boolean
  onChange: (n: WorkoutNode) => void
}) {
  return (
    <label className="we-repeat-controls">
      <span>Repeats</span>
      <Input
        aria-label={sets ? "Sets" : "Repetitions"}
        type="number"
        min={1}
        max={100}
        value={sets ? group.sets : group.repetitions}
        onChange={(e) =>
          onChange({
            ...group,
            [sets ? "sets" : "repetitions"]: Number(e.target.value),
          })
        }
      />
      <span>times</span>
    </label>
  )
}

function TargetFields({
  target,
  sport,
  thresholds,
  showShape = true,
  onChange,
}: {
  target: Target
  sport: string
  thresholds?: WorkoutModel["thresholds"]
  showShape?: boolean
  onChange: (t: Target) => void
}) {
  const settings = useContext(ZoneSettingsContext)
  const units = editorUnits(sport)
  const displayed = editorTarget(target, sport, settings, thresholds)
  const zones = workoutZoneOptions(settings, sport, units.target)
  const selectedZone =
    zones.find((zone) => {
      if (target.unit?.endsWith("_zone") && target.mode === "single")
        return zone.id === String(target.value)
      const t = zone.target
      return (
        displayed &&
        displayed.kind === t.kind &&
        displayed.unit === t.unit &&
        displayed.mode === t.mode &&
        (t.mode === "single"
          ? displayed.value === t.value
          : Math.abs((displayed.start || 0) - (t.start || 0)) < 1 &&
            Math.abs((displayed.end || 0) - (t.end || 0)) < 1)
      )
    })?.id || "custom"
  const valueField = (label: string, key: "value" | "start" | "end") => {
    if (!displayed || displayed.kind === "none") return null
    const value = displayed[key] || 0
    const change = (n: number) => onChange({ ...displayed, [key]: n })
    return units.kind === "pace" ? (
      <PaceField
        label={label}
        unit={units.label}
        value={value}
        onChange={change}
      />
    ) : (
      <NumberField
        label={label}
        unit={units.label}
        value={value}
        onChange={change}
      />
    )
  }
  if (target.kind === "none")
    return (
      <Button
        variant="ghost"
        size="sm"
        className="we-no-target"
        onClick={() => onChange(defaultTarget(sport))}
      >
        Add {units.kind} target
      </Button>
    )
  return (
    <div className="we-target-fields">
      {showShape && displayed && (
        <TargetShape target={displayed} onChange={onChange} />
      )}
      {displayed ? (
        <div className="we-target-values">
          {displayed.mode === "single" ? (
            valueField("Target", "value")
          ) : (
            <>
              {valueField(
                displayed.mode === "ramp" ? "Start target" : "Range from",
                "start"
              )}
              <span className="we-range-separator">
                {displayed.mode === "ramp" ? "→" : "–"}
              </span>
              {valueField(
                displayed.mode === "ramp" ? "End target" : "Range to",
                "end"
              )}
            </>
          )}
        </div>
      ) : (
        <div className="we-target-unavailable">
          <span>
            {selectedZone !== "custom"
              ? zones.find((z) => z.id === selectedZone)?.label
              : "The imported target needs your sport threshold to display in " +
                units.label +
                "."}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(defaultTarget(sport))}
          >
            Set {units.label} target
          </Button>
        </div>
      )}
      <div className="we-zone-choice">
        <Choice
          label="Training zone"
          value={selectedZone}
          disabled={!zones.length}
          options={[
            {
              value: "custom",
              label: zones.length ? "Select zone…" : "No configured zones",
            },
            ...zones.map((zone) => ({ value: zone.id, label: zone.label })),
          ]}
          onChange={(id) => {
            const zone = zones.find((z) => z.id === id)
            if (zone) onChange(zone.target)
          }}
        />
      </div>
    </div>
  )
}
function StepFields({
  step,
  model,
  onChange,
}: {
  step: Step
  model: WorkoutModel
  onChange: (s: Step) => void
}) {
  const swimming = /swim/i.test(model.sport)
  const units = editorUnits(model.sport)
  return (
    <>
      <div className="we-prescription">
        <div className="we-end-fields">
          {step.end.kind === "distance" ? (
            <NumberField
              label={"Distance (" + units.distanceLabel + ")"}
              min={0.001}
              step={swimming ? 1 : 0.01}
              value={
                (step.end.value * distanceFactors[step.end.unit]) /
                distanceFactors[units.distance]
              }
              onChange={(value) =>
                onChange({
                  ...step,
                  end: { ...step.end, value, unit: units.distance },
                })
              }
            />
          ) : (
            <DurationField
              value={step.end.value}
              onChange={(value) =>
                onChange({ ...step, end: { ...step.end, value } })
              }
            />
          )}
        </div>
        {(step.role !== "rest" || step.target.kind !== "none") && (
          <TargetFields
            target={step.target}
            showShape={false}
            sport={model.sport}
            thresholds={model.thresholds}
            onChange={(target) => onChange({ ...step, target })}
          />
        )}
      </div>
      <div className="we-step-options">
        {(swimming || step.end.pressLap || step.end.kind === "lap") && (
          <label className="we-check">
            <input
              type="checkbox"
              role="switch"
              checked={Boolean(step.end.pressLap || step.end.kind === "lap")}
              onChange={(e) =>
                onChange({
                  ...step,
                  end: {
                    ...step.end,
                    kind: step.end.kind === "lap" ? "time" : step.end.kind,
                    pressLap: e.target.checked,
                  },
                })
              }
            />
            End step on lap button
          </label>
        )}
      </div>
    </>
  )
}

function IntervalChart({
  model,
  selected,
  select,
  commit,
}: {
  model: WorkoutModel
  selected: string[]
  select: (id: string, multi: boolean, reveal?: boolean) => void
  commit: (m: WorkoutModel) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [gesture, setGesture] = useState<{
    id: string
    selectionId: string
    multi: boolean
    mode: "duration" | "intensity"
    x: number
    y: number
    width: number
    original: WorkoutModel
    preview: WorkoutModel
  } | null>(null)
  const visible = gesture?.preview || model
  let chart: ReturnType<typeof chartSegments>
  try {
    chart = chartSegments(visible)
  } catch {
    return <p role="alert">Reduce the repeat counts to render the chart.</p>
  }
  const selectionIds = new Map<string, string>()
  for (const root of model.steps)
    for (const { step } of expandSteps([root]))
      selectionIds.set(step.id, root.id)
  const groupId = (step: Step) => selectionIds.get(step.id) || step.id
  const selectedGroup = (id: string) =>
    selected.some(
      (selectedId) =>
        selectedId === id ||
        Boolean(
          findNode([findNode(model.steps, id)!].filter(Boolean), selectedId)
        )
    )
  const total = chart.segments.reduce((n, s) => n + s.width, 0) || 1,
    maximum = Math.max(1.3, ...chart.segments.flatMap((s) => [s.start, s.end]))
  let position = 0
  const width = Math.max(600, Math.min(12000, chart.segments.length * 20))
  const height = (v: number) => 16 + (Math.max(0, v) / maximum) * 140
  const begin = (
    e: React.PointerEvent<SVGElement>,
    step: Step,
    mode: "duration" | "intensity",
    segmentWidth: number
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const screenScale =
      e.currentTarget.ownerSVGElement!.getBoundingClientRect().width / width
    setGesture({
      id: step.id,
      selectionId: groupId(step),
      multi: e.shiftKey || e.metaKey || e.ctrlKey,
      mode,
      x: e.clientX,
      y: e.clientY,
      width: segmentWidth * screenScale,
      original: model,
      preview: model,
    })
  }
  const drag = (e: React.PointerEvent<SVGElement>) => {
    if (!gesture) return
    const dx = e.clientX - gesture.x,
      dy = e.clientY - gesture.y
    if (Math.abs(dx) + Math.abs(dy) < 5) return
    const nodes = updateNodes(gesture.original.steps, [gesture.id], (n) => {
      if (n.kind !== "step") return n
      if (gesture.mode === "duration") {
        const snap =
          n.end.kind === "distance"
            ? n.end.unit === "km" || n.end.unit === "mi"
              ? 0.01
              : 5
            : 5
        n.end.value = Math.max(
          snap,
          Math.round(
            (n.end.value * (1 + dx / Math.max(gesture.width, 1))) / snap
          ) * snap
        )
      } else if (n.target.kind !== "none") {
        const t = n.target,
          inverse = Boolean(paceFactors[t.unit]),
          delta = Math.round(-dy / 3) * (inverse ? -1 : 1)
        const alter = (v: number) =>
          Math.max(
            t.unit.includes("zone") ? 1 : 0.1,
            Math.min(t.unit.includes("zone") ? 10 : 10000, v + delta)
          )
        n.target = {
          ...t,
          ...(t.mode === "single"
            ? { value: alter(t.value!) }
            : { start: alter(t.start!), end: alter(t.end!) }),
        }
      }
      return n
    })
    setGesture({ ...gesture, preview: { ...gesture.original, steps: nodes } })
  }
  const finish = () => {
    if (gesture) {
      if (JSON.stringify(gesture.preview) !== JSON.stringify(gesture.original))
        commit(gesture.preview)
      else select(gesture.selectionId, gesture.multi, true)
      setGesture(null)
    }
  }
  const tickValues = chart.axis.startsWith("Distance")
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => total * f)
    : Array.from({ length: Math.floor(total / 900) + 1 }, (_, i) => i * 900)
  const hoverNode = hovered ? findNode(model.steps, hovered) : null
  return (
    <section
      className="we-chart"
      onPointerLeave={() => setHovered(null)}
      aria-label="Interactive interval chart"
    >
      <div className="overflow-x-auto pb-2">
        <div style={{ minWidth: width }}>
          <svg
            role="group"
            preserveAspectRatio="none"
            aria-label={chart.axis}
            viewBox={`0 0 ${width} 195`}
            style={{ width: "100%", minWidth: width }}
          >
            {[50, 100, 150].map((y) => (
              <line
                key={y}
                x1={0}
                x2={width}
                y1={y}
                y2={y}
                stroke="currentColor"
                opacity=".08"
              />
            ))}
            {chart.segments.map((s) => {
              const x = (position / total) * width,
                w = (s.width / total) * width
              position += s.width
              const active =
                  selectedGroup(groupId(s.step)) ||
                  gesture?.selectionId === groupId(s.step),
                y1 = 180 - height(s.start),
                y2 = 180 - height(s.end)
              return (
                <g
                  key={s.step.id + ":" + s.index}
                  className={
                    "we-profile-segment" +
                    (active ? " is-selected" : "") +
                    (hovered === groupId(s.step) ? " is-hovered" : "")
                  }
                  onPointerEnter={() => setHovered(groupId(s.step))}
                >
                  <polygon
                    points={`${x},180 ${x},${y1} ${x + w},${y2} ${x + w},180`}
                    fill={tones[s.step.role]}
                    stroke={active ? "#2563eb" : "var(--background)"}
                    strokeWidth={active ? 1.5 : 1}
                    vectorEffect="non-scaling-stroke"
                    opacity={active ? 1 : 0.8}
                  />
                  <rect
                    x={x}
                    y={Math.min(y1, y2)}
                    width={Math.max(w - 3, 3)}
                    height={height(Math.max(s.start, s.end))}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${s.step.label}, ${stepLabel(s.step)}, repetition ${s.iteration}`}
                    aria-pressed={Boolean(active)}
                    style={{
                      cursor:
                        s.step.target.kind === "none" ? "pointer" : "ns-resize",
                      touchAction: "none",
                    }}
                    onPointerDown={(e) => begin(e, s.step, "intensity", w)}
                    onPointerMove={drag}
                    onPointerUp={finish}
                    onPointerCancel={() => setGesture(null)}
                    onFocus={() => setHovered(groupId(s.step))}
                    onBlur={() => setHovered(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        select(groupId(s.step), e.shiftKey, true)
                      }
                    }}
                  >
                    <title>
                      {s.step.label} · {stepLabel(s.step)}
                      {s.estimated ? " · estimated width" : ""}
                    </title>
                  </rect>
                  <rect
                    x={x + Math.max(0, w - 5)}
                    y={Math.min(y1, y2)}
                    width={Math.min(8, Math.max(w, 3))}
                    height={height(Math.max(s.start, s.end))}
                    fill={active ? "var(--foreground)" : "transparent"}
                    opacity=".25"
                    style={{ cursor: "ew-resize", touchAction: "none" }}
                    onPointerDown={(e) => begin(e, s.step, "duration", w)}
                    onPointerMove={drag}
                    onPointerUp={finish}
                    onPointerCancel={() => setGesture(null)}
                  >
                    <title>
                      Resize {s.step.label} · snaps to 5 seconds or distance
                      increments
                    </title>
                  </rect>
                  {s.group && (
                    <line
                      x1={x}
                      x2={x + w}
                      y1={190}
                      y2={190}
                      stroke="var(--primary)"
                      strokeWidth={3}
                      opacity={s.iteration % 2 ? 0.6 : 0.3}
                    />
                  )}
                </g>
              )
            })}
          </svg>
          <div className="we-chart-ticks" aria-label="Workout timeline">
            {tickValues.map((value) => (
              <span
                key={value}
                style={{
                  left: (value / total) * 100 + "%",
                  transform:
                    value === 0
                      ? "none"
                      : value === total
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
              >
                {chart.axis.startsWith("Distance")
                  ? Math.round(value).toLocaleString() + " m"
                  : Math.floor(value / 3600) +
                    ":" +
                    String(Math.floor(value / 60) % 60).padStart(2, "0")}
              </span>
            ))}
          </div>
        </div>
      </div>
      {hoverNode && !gesture && (
        <div role="tooltip" className="we-profile-tooltip">
          <strong>
            {hoverNode.kind === "repeat"
              ? hoverNode.repetitions + " × set"
              : hoverNode.label}
          </strong>
          {(hoverNode.kind === "repeat"
            ? [
                ...hoverNode.steps,
                ...(hoverNode.recovery ? [hoverNode.recovery] : []),
              ]
            : [hoverNode]
          ).map((node) => (
            <p key={node.id}>
              {node.kind === "step"
                ? (node.end.kind === "distance"
                    ? round(node.end.value) + " " + node.end.unit
                    : durationClock(node.end.value)) +
                  " · " +
                  node.label
                : stepLabel(node)}
            </p>
          ))}
        </div>
      )}
      {chart.placeholder && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Distance steps without a convertible pace have unknown duration. Their
          chart widths use a 60-second placeholder; totals exclude those unknown
          durations.
        </p>
      )}
    </section>
  )
}

export function WorkoutEditorMenu({
  workout,
  className = "",
  onSaved,
}: {
  workout: PlannedWorkout
  className?: string
  onSaved?: (w: PlannedWorkout) => void
}) {
  const [open, setOpen] = useState(false)
  const editable = canEditWorkout(workout)
  if (!editable) return null
  return (
    <>
      <MobileActionMenu
        label="Workout options"
        className={className}
        actions={[
          {
            value: "edit",
            label: editable
              ? "Edit Workout"
              : "Completed activity is read-only",
            disabled: !editable,
            onSelect: () => setOpen(true),
          },
        ]}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={className}
                aria-label="Workout options"
              />
            }
          >
            <Ellipsis size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!editable}
              onClick={() => setOpen(true)}
            >
              <Pencil size={16} />
              Edit Workout
            </DropdownMenuItem>
            {!editable && (
              <p className="max-w-56 p-2 text-xs text-muted-foreground">
                Completed activity data is read-only. Open its planned calendar
                workout to edit the prescription.
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </MobileActionMenu>
      {open && (
        <WorkoutEditor
          workout={workout}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  )
}
export function WorkoutEditor({
  workout,
  date,
  onClose,
  onSaved,
}: {
  workout?: PlannedWorkout
  date?: string
  onClose: () => void
  onSaved?: (w: PlannedWorkout) => void
}) {
  const editorId = workout?.id || "new:" + date
  const editorUrl = workout
    ? "/api/workouts/" + encodeURIComponent(workout.id) + "/editor"
    : "/api/workouts/new/editor?date=" + encodeURIComponent(date || "")
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [loadError, setLoadError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoadError("")
    apiFetch(editorUrl, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok)
          throw Error(data.error || "Could not load the workout")
        setLoaded(data)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLoadError(e.message)
      })
    return () => controller.abort()
  }, [editorUrl, reloadKey])
  if (loaded)
    return (
      <EditorWorkspace
        key={editorId + ":" + reloadKey}
        loaded={loaded}
        workoutId={editorId}
        onClose={onClose}
        onSaved={onSaved}
        onReload={() => {
          setLoaded(null)
          setReloadKey((n) => n + 1)
        }}
      />
    )
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>{workout ? "Edit Workout" : "Create Workout"}</DialogTitle>
        <DialogDescription>
          {loadError ||
            (workout
              ? "Loading the current workout from Intervals.icu…"
              : "Opening a new workout…")}
        </DialogDescription>
        {loadError ? (
          <Button onClick={() => setReloadKey((n) => n + 1)}>Retry</Button>
        ) : (
          <LoaderCircle className="animate-spin" />
        )}
      </DialogContent>
    </Dialog>
  )
}
export function useEditedWorkout<T extends PlannedWorkout | null>(
  initial: T
): T {
  const [updated, setUpdated] = useState<PlannedWorkout | null>(null)
  useEffect(() => {
    const listener = (event: Event) => {
      const workout = (event as CustomEvent<PlannedWorkout>).detail
      if (workout.id === initial?.id) setUpdated(workout)
    }
    const refresh = () => {
      const context = cachedTrainingContext()
      const workout = [...context.planned, ...context.history].find(
        (item): item is PlannedWorkout =>
          "id" in item && item.id === initial?.id
      )
      if (workout) setUpdated(workout)
    }
    window.addEventListener("workout-editor-saved", listener)
    window.addEventListener("training-context-updated", refresh)
    return () => {
      window.removeEventListener("workout-editor-saved", listener)
      window.removeEventListener("training-context-updated", refresh)
    }
  }, [initial?.id])
  return (updated?.id === initial?.id ? updated : initial) as T
}

function EditorWorkspace({
  loaded,
  workoutId,
  onClose,
  onSaved,
  onReload,
}: {
  loaded: Loaded
  workoutId: string
  onClose: () => void
  onSaved?: (w: PlannedWorkout) => void
  onReload: () => void
}) {
  const mobile = useIsMobile()
  const [history, setHistory] = useState({
    past: [] as WorkoutModel[],
    present: loaded.model,
    future: [] as WorkoutModel[],
  })
  const [savedId, setSavedId] = useState(loaded.isNew ? "" : workoutId)
  const [creationId, setCreationId] = useState(uid)
  const [creationAttempted, setCreationAttempted] = useState(false)
  const isNew = !savedId
  const model = history.present
  const [baseline, setBaseline] = useState(JSON.stringify(loaded.model)),
    [revision, setRevision] = useState(loaded.revision)
  const [selected, setSelected] = useState<string[]>([])
  const [discardOpen, setDiscardOpen] = useState(false),
    [reloadOpen, setReloadOpen] = useState(false)
  const [status, setStatus] = useState<
      "draft" | "saving" | "synced" | "failed"
    >("draft"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("")
  const [dragLabel, setDragLabel] = useState(""),
    [bulkSeconds, setBulkSeconds] = useState(60),
    [bulkTarget, setBulkTarget] = useState<Target>(defaultTarget(model.sport))
  const draftKey = `workout-editor-draft:${trainingCacheScope()}:${workoutId}`,
    blocksKey = `workout-editor-blocks:${trainingCacheScope()}`
  const [recovered, setRecovered] = useState<Draft | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) || "null")
      return value?.model &&
        typeof value.revision === "string" &&
        !validateWorkout(value.model).length
        ? value
        : null
    } catch {
      return null
    }
  })
  const [blocks, setBlocks] = useState<SavedBlock[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(blocksKey) || "[]")
      return Array.isArray(value)
        ? value.filter(
            (b) =>
              typeof b.id === "string" &&
              Array.isArray(b.steps) &&
              !validateWorkout({ ...loaded.model, steps: b.steps }).length
          )
        : []
    } catch {
      return []
    }
  })
  const saving = status === "saving",
    dirty = JSON.stringify(model) !== baseline
  const commit = (next: WorkoutModel) => {
    if (saving) return
    setHistory((h) =>
      JSON.stringify(h.present) === JSON.stringify(next)
        ? h
        : { past: [...h.past.slice(-99), h.present], present: next, future: [] }
    )
    setStatus("draft")
    setError("")
  }
  const undo = () => {
    if (saving) return
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past.at(-1)!,
            future: [h.present, ...h.future],
          }
        : h
    )
    setStatus("draft")
  }
  const redo = () => {
    if (saving) return
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h
    )
    setStatus("draft")
  }
  const edit = (ids: string[], change: (n: WorkoutNode) => WorkoutNode) =>
    commit({ ...model, steps: updateNodes(model.steps, ids, change) })
  const select = (id: string, multi: boolean, reveal = false) => {
    setSelected((s) =>
      multi ? (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]) : [id]
    )
    if (reveal)
      requestAnimationFrame(() => {
        const row = document.getElementById("editor-step-" + id)
        const scroll = row?.closest<HTMLElement>(".we-scroll")
        if (row && scroll)
          scroll.scrollTo({
            top: Math.max(
              0,
              scroll.scrollTop +
                row.getBoundingClientRect().top -
                scroll.getBoundingClientRect().top -
                12
            ),
            behavior: "smooth",
          })
      })
  }
  const selectedLeaves: string[] = []
  const collect = (nodes: WorkoutNode[], inherited = false) => {
    for (const n of nodes) {
      const match = inherited || selected.includes(n.id)
      if (n.kind === "step") {
        if (match) selectedLeaves.push(n.id)
      } else {
        collect(n.steps, match)
        if (n.recovery) collect([n.recovery], match)
        if (n.setRecovery) collect([n.setRecovery], match)
      }
    }
  }
  collect(model.steps)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  )
  const getBlock = (key: string) =>
    templateNames.includes(key)
      ? makeTemplate(key, model.sport)
      : copyNodes(blocks.find((b) => b.id === key)?.steps || [])
  const add = (
    key: string,
    parent: string | null = null,
    index = model.steps.length
  ) => {
    const nodes = getBlock(key)
    commit({ ...model, steps: insertNodes(model.steps, parent, index, nodes) })
    setSelected(nodes.map((n) => n.id))
  }
  const move = (id: string, parent: string | null, index: number) =>
    commit({ ...model, steps: moveNode(model.steps, id, parent, index) })
  const duplicate = (id?: string) => {
    const ids = id ? [id] : selected
    const visit = (nodes: WorkoutNode[]): WorkoutNode[] =>
      nodes.flatMap((n) => {
        if (ids.includes(n.id)) return [n, ...copyNodes([n])]
        if (n.kind !== "repeat") return [n]
        const recoveryCopies = [n.recovery, n.setRecovery].filter(
          (step): step is Step => Boolean(step && ids.includes(step.id))
        )
        if (recoveryCopies.length)
          setNotice(
            "The recovery was copied as an independent step after its repeat group."
          )
        return [{ ...n, steps: visit(n.steps) }, ...copyNodes(recoveryCopies)]
      })
    commit({ ...model, steps: visit(model.steps) })
  }
  const remove = (id?: string) => {
    commit({ ...model, steps: removeNodes(model.steps, id ? [id] : selected) })
    setSelected([])
  }
  const group = () => {
    let changed = false
    const visit = (nodes: WorkoutNode[]): WorkoutNode[] => {
      const indexes = nodes
        .map((n, i) => (selected.includes(n.id) ? i : -1))
        .filter((i) => i >= 0)
      if (
        indexes.length === selected.length &&
        indexes.length > 0 &&
        indexes.at(-1)! - indexes[0] + 1 === indexes.length
      ) {
        const g = newRepeat(nodes.slice(indexes[0], indexes.at(-1)! + 1))
        const next = [...nodes]
        next.splice(indexes[0], indexes.length, g)
        changed = true
        setSelected([g.id])
        return next
      }
      return nodes.map((n) =>
        n.kind === "repeat" ? { ...n, steps: visit(n.steps) } : n
      )
    }
    const steps = visit(model.steps)
    if (changed) commit({ ...model, steps })
    else
      setNotice(
        "Select consecutive steps in the same group to create a repeat."
      )
  }
  const ungroup = () => {
    const visit = (nodes: WorkoutNode[]): WorkoutNode[] =>
      nodes.flatMap((n) =>
        n.kind === "repeat" && selected.includes(n.id)
          ? copyNodes(expandSteps([n]).map((v) => v.step))
          : [n.kind === "repeat" ? { ...n, steps: visit(n.steps) } : n]
      )
    commit({ ...model, steps: visit(model.steps) })
    setSelected([])
  }
  const dragEnd = (e: DragEndEvent) => {
    setDragLabel("")
    if (!e.over || saving) return
    const { parent, index } = e.over.data.current as {
      parent: string | null
      index: number
    }
    if (typeof index !== "number") return
    const data = e.active.data.current
    if (data?.template) add(data.template, parent, index)
    else if (data?.node) move(data.node, parent, index)
  }
  const storeDraft = () => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          model,
          revision,
          creationId,
          creationAttempted,
          savedId,
        })
      )
    } catch {
      setNotice(
        "Browser storage is unavailable. Keep this editor open to retain your draft."
      )
    }
  }
  useEffect(() => {
    if (dirty && !recovered) {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            model,
            revision,
            creationId,
            creationAttempted,
            savedId,
          })
        )
      } catch {
        /* Storage is optional; in-memory draft survives failed saves. */
      }
    }
  }, [
    model,
    dirty,
    recovered,
    draftKey,
    revision,
    creationId,
    creationAttempted,
    savedId,
  ])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty || saving) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty, saving])
  const requestClose = () => {
    if (saving) return
    if (dirty) setDiscardOpen(true)
    else onClose()
  }
  const validation = validateWorkout(model)
  const canSave =
    !saving && (dirty || isNew) && !loaded.issues.length && !validation.length
  const save = async () => {
    if (!canSave) return
    setStatus("saving")
    setError("")
    storeDraft()
    if (isNew) {
      setCreationAttempted(true)
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            model,
            revision,
            creationId,
            creationAttempted: true,
          })
        )
      } catch {
        /* In-memory state retains the attempt. */
      }
    }
    try {
      const response = await apiFetch(
        isNew
          ? "/api/workouts/editor"
          : "/api/workouts/" + encodeURIComponent(savedId) + "/editor",
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            revision,
            ...(isNew ? { creationId, reconcileOnly: creationAttempted } : {}),
          }),
        }
      )
      const data = (await response.json()) as {
        error?: string
        code?: string
        verified?: boolean
        revision: string
        context?: TrainingContext
        workout?: PlannedWorkout
        refreshWarning?: string
      }
      if (
        !response.ok &&
        response.status >= 400 &&
        response.status < 500 &&
        data.code !== "CREATE_UNCONFIRMED"
      )
        setCreationAttempted(false)
      if (!response.ok || !data.verified || !data.workout)
        throw Error(
          data.error || "Intervals.icu did not verify the saved workout"
        )
      setSavedId(data.workout.id)
      setCreationAttempted(false)
      setRevision(data.revision)
      setBaseline(JSON.stringify(model))
      setStatus("synced")
      setNotice(data.refreshWarning || "")
      try {
        localStorage.removeItem(draftKey)
      } catch {
        /* Optional cache. */
      }
      setRecovered(null)
      if (data.context) rememberTrainingContext(data.context, "full")
      else {
        const context = cachedTrainingContext()
        const sessions = [
          ...new Map(
            [...context.history, ...context.planned, data.workout].map((w) => [
              (w as PlannedWorkout).id,
              w,
            ])
          ).values(),
        ]
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: context.athlete.time_zone || "America/Chicago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date())
        rememberTrainingContext(
          {
            ...context,
            history: sessions.filter(
              (w) => (w.workout_date || "") <= today
            ) as TrainingContext["history"],
            planned: sessions.filter(
              (w) => (w.workout_date || "") >= today
            ) as PlannedWorkout[],
          },
          "full"
        )
      }
      window.dispatchEvent(
        new CustomEvent("workout-editor-saved", { detail: data.workout })
      )
      onSaved?.(data.workout)
    } catch (e) {
      setStatus("failed")
      setError(
        e instanceof Error ? e.message : "Save failed. Your draft is retained."
      )
    }
  }
  const keyActions = useRef({
    save,
    undo,
    redo,
    duplicate,
    remove,
    group,
    saving,
  })
  useEffect(() => {
    keyActions.current = { save, undo, redo, duplicate, remove, group, saving }
  })
  const totals = workoutTotals(model)
  const durationText = `${totals.open ? "Open · " : totals.unknownTime ? "At least " : totals.estimated ? "≈ " : ""}${durationClock(totals.seconds)}`
  const saveBlock = () => {
    const chosen: WorkoutNode[] = []
    const visit = (nodes: WorkoutNode[]) => {
      for (const n of nodes) {
        if (selected.includes(n.id)) chosen.push(n)
        else if (n.kind === "repeat") {
          visit(n.steps)
          if (n.recovery) visit([n.recovery])
          if (n.setRecovery) visit([n.setRecovery])
        }
      }
    }
    visit(model.steps)
    if (!chosen.length) return
    const next = [
      ...blocks,
      {
        id: uid(),
        sport: model.sport,
        steps: copyNodes(chosen),
      },
    ]
    try {
      localStorage.setItem(blocksKey, JSON.stringify(next))
      setBlocks(next)
      setNotice("Block saved in this browser. Inserted copies are independent.")
    } catch {
      setNotice("Could not save the block: browser storage is unavailable.")
    }
  }
  return (
    <ZoneSettingsContext.Provider value={loaded.zoneSettings || []}>
      <Dialog
        open
        disablePointerDismissal
        onOpenChange={(v) => {
          if (!v) requestClose()
        }}
      >
        <DialogContent
          showCloseButton={false}
          fullscreen={mobile}
          className="we-dialog"
          onKeyDown={(e) => {
            const a = keyActions.current,
              typing =
                /INPUT|TEXTAREA|SELECT/.test(
                  (e.target as HTMLElement).tagName
                ) || (e.target as HTMLElement).isContentEditable
            if (a.saving) return
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault()
              void a.save()
            }
            if (typing) return
            if (e.ctrlKey || e.metaKey) {
              const key = e.key.toLowerCase()
              if (["z", "y", "d", "g", "a"].includes(key)) e.preventDefault()
              if (key === "z") {
                if (e.shiftKey) a.redo()
                else a.undo()
              }
              if (key === "y") a.redo()
              if (key === "d") a.duplicate()
              if (key === "g") a.group()
              if (key === "a") setSelected(model.steps.map((n) => n.id))
            } else if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault()
              a.remove()
            }
          }}
        >
          <MobileSiteNavbar
            title={isNew ? "Create Workout" : "Edit Workout"}
            onBack={requestClose}
            backLabel="Close editor"
            actions={[
              {
                value: "undo",
                label: "Undo",
                disabled: !history.past.length || saving,
                onSelect: undo,
              },
              {
                value: "redo",
                label: "Redo",
                disabled: !history.future.length || saving,
                onSelect: redo,
              },
            ]}
          />
          <header className="we-header">
            <div>
              <DialogTitle className="text-lg font-semibold">
                {isNew ? "Create Workout" : "Edit Workout"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Shape the session. Every change stays in your draft until you
                save.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1">
              <Action
                label="Undo (Ctrl/⌘ Z)"
                onClick={undo}
                disabled={!history.past.length || saving}
              >
                <Undo2 size={17} />
              </Action>
              <Action
                label="Redo (Ctrl/⌘ Shift Z)"
                onClick={redo}
                disabled={!history.future.length || saving}
              >
                <Redo2 size={17} />
              </Action>
              <Action
                label="Close editor"
                onClick={requestClose}
                disabled={saving}
              >
                <X size={18} />
              </Action>
            </div>
          </header>
          <div className="we-scroll">
            {recovered && (
              <div className="we-notice">
                <p>
                  A local draft is available.
                  {recovered.revision !== loaded.revision
                    ? " The remote event has changed; restoring retains the old revision and requires a conflict review before saving."
                    : ""}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer">
                    Compare saved draft
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">
                    {recovered.model.name}
                    {"\n"}
                    {workoutOutline(recovered.model)}
                    {"\n\n"}
                    {recovered.model.notes}
                  </pre>
                </details>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (validateWorkout(recovered.model).length) {
                        setNotice(
                          "This draft is invalid and cannot be restored."
                        )
                        return
                      }
                      commit(recovered.model)
                      if (recovered.savedId) setSavedId(recovered.savedId)
                      if (recovered.creationId)
                        setCreationId(recovered.creationId)
                      setCreationAttempted(Boolean(recovered.creationAttempted))
                      setRevision(recovered.revision)
                      setRecovered(null)
                    }}
                  >
                    Restore draft
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      try {
                        localStorage.removeItem(draftKey)
                      } catch {
                        /* Optional. */
                      }
                      setRecovered(null)
                    }}
                  >
                    Discard saved draft
                  </Button>
                </div>
              </div>
            )}
            {loaded.issues.length > 0 && (
              <div role="alert" className="we-notice text-destructive">
                <strong>This workout cannot be safely overwritten.</strong>
                <ul className="list-disc pl-5">
                  {loaded.issues.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </div>
            )}
            <fieldset
              disabled={
                saving ||
                (isNew && creationAttempted) ||
                Boolean(loaded.issues.length)
              }
              className="min-w-0"
            >
              <DndContext
                sensors={sensors}
                collisionDetection={(args) => {
                  const hits = pointerWithin(args)
                  return hits.length ? hits : closestCenter(args)
                }}
                onDragStart={(e) =>
                  setDragLabel(
                    e.active.data.current?.template || String(e.active.id)
                  )
                }
                onDragEnd={dragEnd}
                onDragCancel={() => setDragLabel("")}
              >
                <div className="we-topbar">
                  <section className="we-summary" aria-label="Workout summary">
                    <Input
                      aria-label="Workout name"
                      className="we-workout-name"
                      value={model.name}
                      onChange={(e) =>
                        commit({ ...model, name: e.target.value })
                      }
                    />
                    <div className="we-summary-stats">
                      <strong title="Planned duration">{durationText}</strong>
                      <strong
                        title={
                          totals.unknownDistance
                            ? "Known distance"
                            : "Planned distance"
                        }
                      >
                        {totals.distance
                          ? (totals.unknownDistance ? "≥ " : "") +
                            round(
                              totals.distance /
                                (model.sport === "Swim" ? 0.9144 : 1609.344),
                              model.sport === "Swim" ? 0 : 2
                            ).toLocaleString()
                          : "—"}
                        <small>{model.sport === "Swim" ? "yds" : "mi"}</small>
                      </strong>
                      {totals.load != null && (
                        <strong title="Planning load estimate based on relative power">
                          ≈ {Math.round(totals.load)}
                          <small>load</small>
                        </strong>
                      )}
                    </div>
                    <div className="we-summary-meta">
                      <Choice
                        label="Sport"
                        value={model.sport}
                        options={[
                          "Ride",
                          "VirtualRide",
                          "Run",
                          "VirtualRun",
                          "TrailRun",
                          "Swim",
                          "Other",
                        ].map((value) => ({
                          value,
                          label:
                            value === "Swim"
                              ? "Pool Swim"
                              : value === "Ride"
                                ? "Bike"
                                : value,
                        }))}
                        onChange={(sport) => {
                          const setting = sportZoneSettings(
                            loaded.zoneSettings || [],
                            sport
                          )
                          commit({
                            ...model,
                            sport,
                            thresholds: {
                              ftp: setting?.ftp || null,
                              pace: setting?.threshold_pace || null,
                            },
                            poolLength:
                              sport === "Swim"
                                ? model.poolLength || "25y"
                                : model.poolLength,
                          })
                          setBulkTarget(defaultTarget(sport))
                        }}
                      />
                      <Input
                        type="date"
                        aria-label="Scheduled date"
                        value={model.date}
                        onChange={(e) =>
                          commit({ ...model, date: e.target.value })
                        }
                      />
                    </div>
                  </section>
                  <aside className="we-palette" aria-label="Workout blocks">
                    <h3>Blocks</h3>
                    <div className="we-template-grid">
                      {templateNames.map((name) => (
                        <PaletteBlock
                          key={name}
                          id={name}
                          name={name}
                          model={model}
                          nodes={makeTemplate(name, model.sport)}
                          onAdd={() => add(name)}
                        />
                      ))}
                    </div>
                  </aside>
                  <aside
                    className="we-saved-blocks"
                    aria-label="Saved workout blocks"
                  >
                    <h3>My blocks</h3>
                    <div className="we-saved-list">
                      {blocks
                        .filter((b) => b.sport === model.sport)
                        .map((b, index) => (
                          <div key={b.id} className="flex items-center">
                            <div className="min-w-0 flex-1">
                              <PaletteBlock
                                id={b.id}
                                name={"saved block " + (index + 1)}
                                model={model}
                                nodes={b.steps}
                                onAdd={() => add(b.id)}
                              />
                            </div>
                            <Action
                              label={"Remove saved block " + (index + 1)}
                              onClick={() => {
                                const next = blocks.filter((v) => v.id !== b.id)
                                try {
                                  localStorage.setItem(
                                    blocksKey,
                                    JSON.stringify(next)
                                  )
                                  setBlocks(next)
                                } catch {
                                  setNotice("Could not remove the saved block.")
                                }
                              }}
                            >
                              <X size={12} />
                            </Action>
                          </div>
                        ))}
                    </div>
                    <div className="we-save-block">
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={!selected.length}
                        onClick={saveBlock}
                      >
                        <Save size={14} />
                        Save selected block
                      </Button>
                    </div>
                  </aside>
                </div>
                {loaded.zoneError && (
                  <p
                    role="status"
                    className="mb-3 text-xs text-muted-foreground"
                  >
                    {loaded.zoneError}
                  </p>
                )}
                <div className="we-workspace">
                  <main className="min-w-0">
                    <IntervalChart
                      model={model}
                      selected={selected}
                      select={select}
                      commit={commit}
                    />
                    <div className="we-list-toolbar">
                      <h3>
                        Steps{" "}
                        <span className="font-normal text-muted-foreground">
                          {selected.length
                            ? `· ${selected.length} selected`
                            : ""}
                        </span>
                      </h3>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!selected.length}
                          onClick={() => duplicate()}
                        >
                          <Copy size={13} />
                          Duplicate
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!selected.length}
                          onClick={group}
                        >
                          <Repeat2 size={13} />
                          Group
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            !selected.some(
                              (id) =>
                                findNode(model.steps, id)?.kind === "repeat"
                            )
                          }
                          onClick={ungroup}
                        >
                          Ungroup
                        </Button>
                        <Action
                          label="Delete selected steps"
                          disabled={!selected.length}
                          onClick={() => remove()}
                        >
                          <Trash2 size={15} />
                        </Action>
                      </div>
                    </div>
                    {selected.length > 1 && (
                      <section className="we-bulk" aria-label="Bulk edit">
                        <h3>Bulk edit · {selectedLeaves.length} intervals</h3>
                        <div className="we-bulk-fields">
                          <DurationField
                            label="Bulk duration"
                            value={bulkSeconds}
                            onChange={setBulkSeconds}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              edit(selectedLeaves, (n) =>
                                n.kind === "step"
                                  ? {
                                      ...n,
                                      end: {
                                        kind: "time",
                                        value: bulkSeconds,
                                        unit: "s",
                                      },
                                    }
                                  : n
                              )
                            }
                          >
                            Apply time
                          </Button>
                          <TargetFields
                            target={bulkTarget}
                            sport={model.sport}
                            thresholds={model.thresholds}
                            onChange={setBulkTarget}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              edit(selectedLeaves, (n) =>
                                n.kind === "step"
                                  ? { ...n, target: clone(bulkTarget) }
                                  : n
                              )
                            }
                          >
                            Apply target
                          </Button>
                        </div>
                      </section>
                    )}
                    <NodeList
                      nodes={model.steps}
                      parent={null}
                      selected={selected}
                      select={select}
                      move={move}
                      remove={remove}
                      duplicate={duplicate}
                      model={model}
                      change={(node) => edit([node.id], () => node)}
                      insert={(parent, index) => {
                        const step = newStep(model.sport)
                        commit({
                          ...model,
                          steps: insertNodes(model.steps, parent, index, [
                            step,
                          ]),
                        })
                        setSelected([step.id])
                      }}
                    />
                    {!model.steps.length && (
                      <div className="we-empty">
                        Add a block to begin your workout.
                      </div>
                    )}
                    <details className="we-outline">
                      <summary className="cursor-pointer text-sm font-medium">
                        Workout outline
                      </summary>
                      <pre className="mt-3 font-sans text-xs leading-relaxed whitespace-pre-wrap">
                        {workoutOutline(model)}
                      </pre>
                    </details>
                  </main>
                </div>
                <DragOverlay>
                  {dragLabel && (
                    <div className="w-36 rounded-lg border bg-background p-2 shadow-lg">
                      <BlockProfile
                        model={model}
                        nodes={
                          findNode(model.steps, dragLabel)
                            ? [findNode(model.steps, dragLabel)!]
                            : getBlock(dragLabel)
                        }
                      />
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            </fieldset>
            {validation.length > 0 && (dirty || !isNew) && (
              <p role="alert" className="mt-4 text-xs text-destructive">
                {validation.join(". ")}
              </p>
            )}
          </div>
          <footer className="we-footer">
            <div className="min-w-0 flex-1" aria-live="polite">
              <p
                className={`flex items-center gap-2 text-xs ${status === "failed" ? "text-destructive" : status === "synced" ? "text-emerald-600" : "text-muted-foreground"}`}
              >
                {saving ? (
                  <>
                    <LoaderCircle size={14} className="animate-spin" />
                    Saving and verifying with Intervals.icu…
                  </>
                ) : status === "synced" ? (
                  <>
                    <Check size={14} />
                    Synced · parsed workout verified
                  </>
                ) : status === "failed" ? (
                  "Save failed · draft retained"
                ) : null}
              </p>
              {error && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mt-1 text-xs">
                  {notice}
                </p>
              )}
              {status === "failed" && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 py-1"
                  onClick={() => setReloadOpen(true)}
                >
                  Reload remote version for review
                </Button>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                disabled={saving}
                onClick={requestClose}
              >
                {status === "synced" ? "Done" : "Cancel"}
              </Button>
              <Button disabled={!canSave} onClick={() => void save()}>
                <Save size={15} />
                {saving
                  ? "Saving…"
                  : status === "failed"
                    ? "Retry Save"
                    : isNew
                      ? creationAttempted
                        ? "Recheck creation"
                        : "Create Workout"
                      : "Save Changes"}
              </Button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Discarding removes the unsaved local changes and their recovery
              copy. Changes already saved to Intervals.icu remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                try {
                  localStorage.removeItem(draftKey)
                } catch {
                  /* Optional. */
                }
                onClose()
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={reloadOpen} onOpenChange={setReloadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Review the latest remote workout?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The current draft will stay in browser storage. The latest remote
              version will open, and you can compare it with or restore your
              saved draft. A stale draft cannot overwrite newer remote edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                storeDraft()
                onReload()
              }}
            >
              Load remote version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ZoneSettingsContext.Provider>
  )
}
