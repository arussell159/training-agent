import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Menu } from "@base-ui/react/menu"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Dumbbell,
  EllipsisVertical,
  History,
  Minus,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
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
import {
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import type {
  PlannedValueDraft,
  PlannedValueKey,
} from "@/lib/planned-workout-values"
import {
  uid,
  type WorkoutModel,
} from "../../../app-backend/lib/workout-editor-model.mjs"
import {
  addStrengthParameter,
  newStrengthBlock,
  newStrengthExercise,
  setStrengthValue,
  strengthParameterFields,
  strengthTotals,
  type StrengthBlock,
  type StrengthBlockKind,
  type StrengthExercise,
  type StrengthParameter,
  type StrengthParameterKind,
} from "../../../app-backend/lib/workout-strength-model.mjs"
import "./desktop-strength-builder.css"
import { StrengthGlyph } from "./desktop-strength-glyphs"
import { DesktopStrengthSubtype } from "./desktop-strength-subtype"
import { preloadable } from "@/lib/preloadable"
import {
  StrengthExerciseDefinitionDialog,
  StrengthLibraryHistoryView,
  StrengthLibraryCard,
  useStrengthExerciseLibrary,
} from "./strength-exercise-library"
import {
  strengthLibraryClient,
  selectStrengthLibraryExercise,
  type StrengthLibraryExercise,
  type StrengthLibraryResult,
} from "@/lib/strength-exercise-library"
import {
  strengthLibraryExerciseBlock,
  strengthMuscleGroups,
} from "../../../app-backend/lib/strength-exercise-library-model.mjs"

const strengthDateTime = preloadable(
  () =>
    import("./desktop-strength-date-time").then((module) => ({
      default: module.DesktopStrengthDateTime,
    })),
  () => (
    <div
      role="status"
      aria-label="Loading workout date and time"
      style={{ width: 308, height: 38.5625, flex: "0 0 auto" }}
    >
      <span className="sr-only">Loading workout date and time…</span>
    </div>
  )
)
const DesktopStrengthDateTime = strengthDateTime.Component

const blockNames: Record<StrengthBlockKind, string> = {
  single: "Single Exercise",
  circuit: "Circuit",
  warmup: "Warm Up",
  cooldown: "Cool Down",
  superset: "Superset",
}
const blockCode = (index: number) => {
  let value = index + 1,
    code = ""
  while (value > 0) {
    value--
    code = String.fromCharCode(65 + (value % 26)) + code
    value = Math.floor(value / 26)
  }
  return code
}
const clock = (seconds: number | null) =>
  seconds == null
    ? ""
    : [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map((value) => String(value).padStart(2, "0"))
        .join(":")
const parseClock = (value: string) => {
  if (!value.trim()) return null
  if (!/^\d{1,2}:\d{2}:\d{2}$/.test(value))
    throw Error("Use hh:mm:ss for time.")
  const [hours, minutes, seconds] = value.split(":").map(Number)
  if (
    minutes > 59 ||
    seconds > 59 ||
    hours * 3600 + minutes * 60 + seconds > 86400
  )
    throw Error("Enter a time of at most 24:00:00.")
  return hours * 3600 + minutes * 60 + seconds
}
const field = (parameter: StrengthParameter) =>
  strengthParameterFields.find((item) => item.kind === parameter.kind)!
const copyExercise = (exercise: StrengthExercise): StrengthExercise => {
  const columns = new Map(
    exercise.parameters.map((parameter) => [parameter.id, uid()])
  )
  return {
    ...structuredClone(exercise),
    id: uid(),
    parameters: exercise.parameters.map((parameter) => ({
      ...parameter,
      id: columns.get(parameter.id)!,
    })),
    sets: exercise.sets.map((set) => ({
      id: uid(),
      values: Object.fromEntries(
        Object.entries(set.values).map(([id, value]) => [
          columns.get(id)!,
          value,
        ])
      ),
    })),
  }
}

function StrengthCell({
  exercise,
  setId,
  parameter,
  value,
  onChange,
  onValidity,
  disabled,
}: {
  exercise: StrengthExercise
  setId: string
  parameter: StrengthParameter
  value: number | null
  onChange: (next: StrengthExercise) => void
  onValidity: (id: string, valid: boolean) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState(
    parameter.kind === "duration"
      ? clock(value)
      : value == null
        ? ""
        : String(value)
  )
  const [error, setError] = useState("")
  const cellId = `${setId}:${parameter.id}:${parameter.kind}:${parameter.unit}`
  useEffect(() => onValidity(cellId, true), [value, cellId, onValidity])
  const previous = useRef(value)
  if (previous.current !== value) {
    previous.current = value
    setDraft(
      parameter.kind === "duration"
        ? clock(value)
        : value == null
          ? ""
          : String(value)
    )
    setError("")
  }
  return (
    <div className="dsb-cell">
      <input
        aria-label={`${exercise.title || "Exercise"} set ${exercise.sets.findIndex((set) => set.id === setId) + 1} ${field(parameter).label}${["reps", "rpe", "rir", "s"].includes(parameter.unit) ? "" : ` ${parameter.unit}`}`}
        inputMode={parameter.kind === "duration" ? "text" : "decimal"}
        placeholder={parameter.kind === "duration" ? "hh:mm:ss" : "--"}
        disabled={disabled}
        value={draft}
        aria-invalid={Boolean(error)}
        title={error || undefined}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          setError("")
          try {
            if (
              text.trim() &&
              parameter.kind !== "duration" &&
              !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim())
            )
              throw Error("Enter a number or leave the field blank.")
            const numeric =
              parameter.kind === "duration"
                ? parseClock(text)
                : text.trim()
                  ? Number(text)
                  : null
            onChange(setStrengthValue(exercise, setId, parameter.id, numeric))
            onValidity(cellId, true)
          } catch {
            onValidity(cellId, false)
          }
        }}
        onBlur={() => {
          try {
            if (
              draft.trim() &&
              parameter.kind !== "duration" &&
              !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(draft.trim())
            )
              throw Error("Enter a number or leave the field blank.")
            const numeric =
              parameter.kind === "duration"
                ? parseClock(draft)
                : !draft.trim()
                  ? null
                  : Number(draft)
            const next = setStrengthValue(
              exercise,
              setId,
              parameter.id,
              numeric
            )
            onChange(next)
            onValidity(cellId, true)
            setDraft(
              parameter.kind === "duration"
                ? clock(numeric)
                : numeric == null
                  ? ""
                  : String(numeric)
            )
          } catch (reason) {
            onValidity(cellId, false)
            setError(
              reason instanceof Error ? reason.message : "Enter a valid value."
            )
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  )
}

function StrengthBlockTime({
  id,
  value,
  label,
  disabled,
  onChange,
  onValidity,
}: {
  id: string
  value: number | null
  label: string
  disabled: boolean
  onChange: (value: number | null) => void
  onValidity: (id: string, error: string) => void
}) {
  const [draft, setDraft] = useState(clock(value)),
    [error, setError] = useState("")
  const previous = useRef(value)
  useEffect(() => onValidity(id, ""), [id, value, onValidity])
  if (previous.current !== value) {
    previous.current = value
    setDraft(clock(value))
    setError("")
  }
  return (
    <input
      aria-label={label}
      value={draft}
      disabled={disabled}
      placeholder="hh:mm:ss"
      aria-invalid={Boolean(error)}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        setError("")
        try {
          const seconds = parseClock(text)
          onChange(seconds)
          onValidity(id, "")
        } catch {
          onValidity(id, "Use hh:mm:ss for time.")
        }
      }}
      onBlur={() => {
        try {
          const seconds = parseClock(draft)
          onChange(seconds)
          setDraft(clock(seconds))
          setError("")
          onValidity(id, "")
        } catch (reason) {
          const message =
            reason instanceof Error ? reason.message : "Enter a valid time."
          setError(message)
          onValidity(id, message)
        }
      }}
    />
  )
}

function ExerciseEditor({
  exercise,
  code,
  disabled,
  library,
  onChange,
  onRemove,
  onDuplicate,
  onConvert,
  onHistory,
  onCreate,
  onEditLibrary,
  canCreate,
  onValidity,
}: {
  exercise: StrengthExercise
  code: string
  disabled: boolean
  library: StrengthExercise[]
  onChange: (next: StrengthExercise) => void
  onRemove?: () => void
  onDuplicate: () => void
  onConvert?: (kind: StrengthBlockKind) => void
  onHistory: (exercise: StrengthExercise) => void
  onCreate: (title: string) => void
  onEditLibrary: (id: string) => void
  canCreate: boolean
  onValidity: (id: string, valid: boolean) => void
}) {
  const [menu, setMenu] = useState(false),
    [notes, setNotes] = useState(Boolean(exercise.notes)),
    [picker, setPicker] = useState(!exercise.title),
    [search, setSearch] = useState(exercise.title),
    [preview, setPreview] = useState(false)
  const suggestions = library.filter((item) =>
    item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  )
  const previousTitle = useRef(exercise.title)
  if (previousTitle.current !== exercise.title) {
    previousTitle.current = exercise.title
    setSearch(exercise.title)
    setPicker(false)
  }
  useEffect(
    () => onValidity(`picker:${exercise.id}`, true),
    [exercise.id, exercise.title, onValidity]
  )
  const choose = (title: string, source?: StrengthExercise) => {
    if (disabled) return
    // A library selection supplies the exercise identity/instructions, while
    // each prescription retains its own independent sets and parameters.
    const next = source?.libraryExerciseId
      ? selectStrengthLibraryExercise(exercise, {
          id: source.libraryExerciseId,
          title,
          instructions: source.instructions,
          parameters: source.parameters,
        })
      : { ...exercise, title, instructions: source?.instructions || "" }
    if (!source?.libraryExerciseId) delete next.libraryExerciseId
    onChange(next)
    setSearch(title)
    setPicker(false)
    onValidity(`picker:${exercise.id}`, true)
  }
  return (
    <section className="dsb-exercise" aria-label={`Prescription ${code}`}>
      <div className="dsb-exercise-heading">
        <strong>{code}</strong>
        <div className="dsb-exercise-picker">
          <label className="dsb-float-label">
            <span>Exercise</span>
            <input
              aria-label={`Exercise ${code}`}
              role="combobox"
              aria-expanded={picker}
              aria-controls={`dsb-options-${exercise.id}`}
              maxLength={128}
              disabled={disabled}
              value={picker ? search : exercise.title}
              placeholder="Search exercises"
              onFocus={() => {
                if (!picker) setSearch(exercise.title)
                setPicker(true)
              }}
              onChange={(event) => {
                setSearch(event.target.value)
                setPicker(true)
                onValidity(
                  `picker:${exercise.id}`,
                  event.target.value === exercise.title
                )
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setPicker(false)
                  setSearch(exercise.title)
                  onValidity(`picker:${exercise.id}`, true)
                }
                if (event.key === "Enter" && search.trim()) {
                  event.preventDefault()
                  const existing = suggestions.find(
                    (item) => item.title === search.trim()
                  )
                  if (existing) choose(existing.title, existing)
                  else {
                    if (!canCreate) return
                    setPicker(false)
                    onValidity(`picker:${exercise.id}`, true)
                    onCreate(search.trim())
                  }
                }
              }}
            />
          </label>
          {picker && (
            <div
              className="dsb-exercise-options"
              id={`dsb-options-${exercise.id}`}
              role="listbox"
              aria-label="Exercise search options"
            >
              {suggestions.map((item) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={item.title === exercise.title}
                  key={item.id}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item.title, item)}
                >
                  {item.title}
                </button>
              ))}
              {!suggestions.length && <p>No saved exercises match.</p>}
              <button
                type="button"
                disabled={!search.trim() || disabled || !canCreate}
                onClick={() => {
                  setPicker(false)
                  onValidity(`picker:${exercise.id}`, true)
                  onCreate(search.trim())
                }}
              >
                Create Custom Exercise
                {search.trim() ? `: ${search.trim()}` : ""}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPicker(false)
                  setSearch(exercise.title)
                  onValidity(`picker:${exercise.id}`, true)
                }}
              >
                Close exercise search
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="dsb-note-button"
          disabled={disabled}
          onClick={() => setNotes((value) => !value)}
        >
          {notes ? "Hide Coach Notes" : "Add Coach Notes"}
        </button>
        <div className="dsb-menu-anchor">
          <button
            type="button"
            aria-label={`Block options ${code}`}
            aria-expanded={menu}
            disabled={disabled}
            onClick={() => setMenu((value) => !value)}
          >
            <EllipsisVertical size={18} />
          </button>
          {menu && (
            <fieldset className="dsb-options" role="menu" disabled={disabled}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPreview(true)
                  setMenu(false)
                }}
              >
                Preview
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!exercise.libraryExerciseId}
                title={
                  !exercise.libraryExerciseId
                    ? "This legacy prescription has no saved library definition."
                    : undefined
                }
                onClick={() => {
                  if (exercise.libraryExerciseId)
                    onEditLibrary(exercise.libraryExerciseId)
                  setMenu(false)
                }}
              >
                Edit Exercise
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={exercise.parameters.length >= 12}
                onClick={() => {
                  onChange(addStrengthParameter(exercise))
                  setMenu(false)
                }}
              >
                Add Parameter
              </button>
              {onConvert && (
                <>
                  <span>Convert to</span>
                  {(
                    [
                      "single",
                      "circuit",
                      "warmup",
                      "cooldown",
                      "superset",
                    ] as const
                  ).map((kind) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={kind}
                      onClick={() => {
                        onConvert(kind)
                        setMenu(false)
                      }}
                    >
                      {blockNames[kind]}
                    </button>
                  ))}
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDuplicate()
                  setMenu(false)
                }}
              >
                Duplicate Exercise
              </button>
              {onRemove && (
                <button type="button" role="menuitem" onClick={onRemove}>
                  Remove
                </button>
              )}
            </fieldset>
          )}
        </div>
      </div>
      {notes && (
        <label className="dsb-float-label">
          <span>Coach Notes</span>
          <textarea
            aria-label={`Coach Notes ${code}`}
            maxLength={1000}
            value={exercise.notes}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...exercise, notes: event.target.value })
            }
          />
          <small>Count: {exercise.notes.length}/1000</small>
        </label>
      )}
      <div className="dsb-prescription-layout">
        <button
          type="button"
          className="dsb-preview"
          onClick={() => setPreview(true)}
          aria-label={`Preview ${exercise.title || "exercise"}`}
        >
          <Dumbbell size={38} />
          <span>Preview</span>
        </button>
        <div className="dsb-prescription-table-wrap">
          <table className="dsb-prescription-table" aria-label={`Sets ${code}`}>
            <thead>
              <tr>
                <th>
                  <div className="dsb-set-count">
                    <button
                      type="button"
                      aria-label={`Remove one set ${code}`}
                      title={
                        exercise.sets.length === 1
                          ? "Must contain at least one set"
                          : "Remove one set"
                      }
                      disabled={disabled || exercise.sets.length === 1}
                      onClick={() =>
                        onChange({
                          ...exercise,
                          sets: exercise.sets.slice(0, -1),
                        })
                      }
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Add one more set ${code}`}
                      title={
                        exercise.sets.length === 15
                          ? "Limit 15 Sets"
                          : "Add one more set"
                      }
                      disabled={disabled || exercise.sets.length === 15}
                      onClick={() =>
                        onChange({
                          ...exercise,
                          sets: [
                            ...exercise.sets,
                            {
                              id: uid(),
                              values: { ...exercise.sets.at(-1)!.values },
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </th>
                {exercise.parameters.map((parameter, index) => (
                  <th key={parameter.id}>
                    <select
                      aria-label={`Parameter ${code} ${index + 1}`}
                      value={`${parameter.kind}:${parameter.unit}`}
                      disabled={disabled}
                      onChange={(event) => {
                        const [kind, unit] = event.target.value.split(":") as [
                          StrengthParameterKind,
                          string,
                        ]
                        onChange({
                          ...exercise,
                          parameters: exercise.parameters.map((item) =>
                            item.id === parameter.id
                              ? { ...item, kind, unit }
                              : item
                          ),
                          sets: exercise.sets.map((set) => ({
                            ...set,
                            values: { ...set.values, [parameter.id]: null },
                          })),
                        })
                      }}
                    >
                      {strengthParameterFields.flatMap((item) =>
                        item.units.map((unit) => (
                          <option
                            key={`${item.kind}:${unit}`}
                            value={`${item.kind}:${unit}`}
                          >
                            {item.label}
                            {["reps", "rpe", "rir", "s"].includes(unit)
                              ? ""
                              : ` (${unit})`}
                          </option>
                        ))
                      )}
                    </select>
                    {index > 0 && (
                      <button
                        type="button"
                        aria-label={`Remove parameter ${code} ${index + 1}`}
                        disabled={disabled}
                        onClick={() =>
                          onChange({
                            ...exercise,
                            parameters: exercise.parameters.filter(
                              (item) => item.id !== parameter.id
                            ),
                            sets: exercise.sets.map((set) => ({
                              ...set,
                              values: Object.fromEntries(
                                Object.entries(set.values).filter(
                                  ([id]) => id !== parameter.id
                                )
                              ),
                            })),
                          })
                        }
                      >
                        <X size={12} />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exercise.sets.map((set, index) => (
                <tr key={set.id}>
                  <th>{index + 1}</th>
                  {exercise.parameters.map((parameter) => (
                    <td key={parameter.id}>
                      <StrengthCell
                        key={`${parameter.id}:${parameter.kind}:${parameter.unit}`}
                        exercise={exercise}
                        setId={set.id}
                        parameter={parameter}
                        value={set.values[parameter.id]}
                        onChange={onChange}
                        onValidity={onValidity}
                        disabled={disabled}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="dsb-text-button"
            disabled={disabled || exercise.parameters.length >= 12}
            onClick={() => onChange(addStrengthParameter(exercise))}
          >
            <Plus size={13} />
            Add Parameter
          </button>
        </div>
      </div>
      <button
        type="button"
        className="dsb-text-button dsb-last-performance"
        disabled={!exercise.title}
        onClick={() => onHistory(exercise)}
      >
        <History size={15} />
        Last Performance
        <ChevronDown size={14} />
      </button>
      {preview && (
        <Dialog open onOpenChange={setPreview}>
          <DialogContent className="dsb-preview-dialog">
            <DialogTitle>{exercise.title || "Exercise preview"}</DialogTitle>
            <DialogDescription>
              {exercise.instructions ||
                "No instructions have been added to this custom exercise."}
            </DialogDescription>
            {exercise.notes && <p>{exercise.notes}</p>}
            <button
              type="button"
              onClick={() => {
                setPreview(false)
                onHistory(exercise)
              }}
            >
              View History
            </button>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

export type DesktopStrengthBuilderProps = {
  model: WorkoutModel
  onChange: (model: WorkoutModel) => void
  planned: PlannedValueDraft
  onPlanned: (key: PlannedValueKey, value: string) => void
  time: string
  onTime: (value: string) => void
  onClose: () => void
  onSave: (close: boolean) => void
  saving: boolean
  canSave: boolean
  pending?: boolean
  onDraftState: (dirty: boolean) => void
  additionalDescription?: ReactNode
  disabled: boolean
  error: string
  notice: string
  validation: string[]
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  recovery?: ReactNode
  privateNotes?: ReactNode
  comment: string
  onComment: (value: string) => void
  comments: { id: string; body: string }[]
  onReload?: () => void
  onDelete?: () => void | Promise<void>
  onFiles?: () => void
  fileDialogs?: ReactNode
  onSaveTemplate?: () => void
  templateDialogs?: ReactNode
  discardOpen: boolean
  onDiscardOpen: (value: boolean) => void
  onDiscard: () => void
}

export function DesktopStrengthBuilder(props: DesktopStrengthBuilderProps) {
  const { model, onChange, onDraftState } = props
  const blocks = model.strength!.blocks
  const strengthDialog = useRef<HTMLDivElement>(null)
  const menuAction = useRef(false)
  const [deleteOpen, setDeleteOpen] = useState(false),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState("")
  const deleteInFlight = useRef(false)
  const saving = props.saving || deleting,
    disabled = props.disabled || deleting
  const deleteWorkout = async () => {
    if (deleteInFlight.current || !props.onDelete) return
    deleteInFlight.current = true
    setDeleting(true)
    setDeleteError("")
    try {
      await props.onDelete()
      setDeleteOpen(false)
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : "This workout could not be deleted. It remains open; retry when ready."
      )
    } finally {
      deleteInFlight.current = false
      setDeleting(false)
    }
  }
  const exerciseLibrary = useStrengthExerciseLibrary()
  const [definitionDialog, setDefinitionDialog] = useState<{
    row?: StrengthLibraryExercise
    title?: string
    preview?: boolean
    target?: { block: string; exercise: string }
    recover?: boolean
    deleting?: boolean
  } | null>(null)
  const [libraryOwner, setLibraryOwner] = useState("all"),
    [muscle, setMuscle] = useState("all"),
    [historyId, setHistoryId] = useState<string | null>(null),
    [libraryRecoveryError, setLibraryRecoveryError] = useState("")
  const [tab, setTab] = useState<"summary" | "history">("summary"),
    [panel, setPanel] = useState<"library" | "comments" | "notes" | null>(null),
    [add, setAdd] = useState(false),
    [menu, setMenu] = useState(false),
    [historyName, setHistoryName] = useState(""),
    [query, setQuery] = useState("")
  const [blockNotes, setBlockNotes] = useState<string[]>([]),
    [timeErrors, setTimeErrors] = useState<Record<string, string>>({})
  const [invalidCells, setInvalidCells] = useState<Record<string, boolean>>({})
  const [invalidHeader, setInvalidHeader] = useState(false)
  const onValidity = useCallback(
    (id: string, valid: boolean) =>
      setInvalidCells((current) =>
        current[id] === !valid ? current : { ...current, [id]: !valid }
      ),
    []
  )
  const onTimeValidity = useCallback(
    (id: string, error: string) =>
      setTimeErrors((current) =>
        current[id] === error ? current : { ...current, [id]: error }
      ),
    []
  )
  const activeCells = new Set<string>()
  for (const block of blocks)
    for (const exercise of block.exercises) {
      activeCells.add(`picker:${exercise.id}`)
      for (const set of exercise.sets)
        for (const parameter of exercise.parameters)
          activeCells.add(
            `${set.id}:${parameter.id}:${parameter.kind}:${parameter.unit}`
          )
    }
  const invalid =
    invalidHeader ||
    Object.entries(invalidCells).some(
      ([id, bad]) => bad && activeCells.has(id)
    ) ||
    Object.entries(timeErrors).some(
      ([id, error]) => Boolean(error) && blocks.some((block) => block.id === id)
    )
  useEffect(() => onDraftState(invalid), [invalid, onDraftState])
  const drag = useRef<string | null>(null)
  const blockRefs = useRef(new Map<string, HTMLElement>())
  const context = cachedTrainingContext()
  const records = [
    ...new Map(
      [...context.planned, ...context.history]
        .filter((row): row is PlannedWorkout =>
          Boolean(
            "editor_model" in row &&
            row.editor_model?.strength &&
            !row.app_pending_operation
          )
        )
        .map((row) => [row.id, row])
    ).values(),
  ]
  const legacyLibrary = useMemo(() => {
    const unique = new Map<string, StrengthExercise>()
    for (const workout of records)
      for (const block of workout.editor_model!.strength!.blocks)
        for (const exercise of block.exercises)
          if (exercise.title.trim() && !exercise.libraryExerciseId)
            unique.set(exercise.title.toLocaleLowerCase(), exercise)
    return [...unique.values()].sort((a, b) => a.title.localeCompare(b.title))
    // The snapshot is replaced by the normal mutation cache after a real save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context])
  const library = useMemo(
    () => [
      ...(exerciseLibrary.catalog?.exercises || []).map(
        (row) => strengthLibraryExerciseBlock(row).exercises[0]
      ),
      ...legacyLibrary,
    ],
    [exerciseLibrary.catalog, legacyLibrary]
  )
  const filteredCustom =
    exerciseLibrary.catalog?.exercises.filter(
      (row) =>
        row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
        (muscle === "all" || row.muscleGroup === muscle) &&
        (libraryOwner === "all" || row.owner === "me")
    ) || []
  const filteredLegacy =
    muscle === "all"
      ? legacyLibrary.filter((row) =>
          row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        )
      : []
  const editDefinition = (id: string, preview = false) => {
    const row = exerciseLibrary.catalog?.exercises.find((row) => row.id === id)
    if (row) setDefinitionDialog({ row, preview })
    else {
      setLibraryRecoveryError(
        "This saved definition is not currently available. Reload the library; its workout prescription is retained."
      )
      setPanel("library")
    }
  }
  const totals = (() => {
    try {
      return strengthTotals(model.strength!)
    } catch {
      return null
    }
  })()
  const exerciseCount = blocks.reduce(
      (sum, block) => sum + block.exercises.length,
      0
    ),
    setCount = blocks.reduce(
      (sum, block) =>
        sum +
        block.exercises.reduce(
          (all, exercise) => all + exercise.sets.length,
          0
        ),
      0
    )
  const mutateBlocks = (next: StrengthBlock[]) =>
    onChange({
      ...model,
      strength: { ...model.strength, version: 1, blocks: next },
    })
  const updateBlock = (next: StrengthBlock) =>
    mutateBlocks(blocks.map((block) => (block.id === next.id ? next : block)))
  const updateExercise = (block: StrengthBlock, next: StrengthExercise) =>
    updateBlock({
      ...block,
      exercises: block.exercises.map((exercise) =>
        exercise.id === next.id ? next : exercise
      ),
    })
  const addBlock = (kind: StrengthBlockKind, exercise?: StrengthExercise) => {
    mutateBlocks([...blocks, newStrengthBlock(kind, exercise)])
    setAdd(false)
  }
  const reorder = (source: string, destination: string) => {
    const from = blocks.findIndex((block) => block.id === source),
      to = blocks.findIndex((block) => block.id === destination)
    if (from < 0 || to < 0 || from === to) return
    const next = [...blocks]
    next.splice(to, 0, next.splice(from, 1)[0])
    mutateBlocks(next)
  }
  const viewHistory = (exercise: StrengthExercise) => {
    setHistoryName(exercise.title)
    setHistoryId(exercise.libraryExerciseId || null)
    setTab("history")
  }
  const histories = records
    .filter((workout) =>
      workout.editor_model?.strength?.blocks.some((block) =>
        block.exercises.some(
          (exercise) =>
            !exercise.libraryExerciseId &&
            (!historyName ||
              exercise.title.toLocaleLowerCase() ===
                historyName.toLocaleLowerCase())
        )
      )
    )
    .sort((a, b) =>
      String(b.workout_date).localeCompare(String(a.workout_date))
    )
  const definitionSaved = (result: StrengthLibraryResult, created: boolean) => {
    if (created && result.exercise) {
      const block = strengthLibraryExerciseBlock(result.exercise),
        target = definitionDialog?.target
      if (target)
        mutateBlocks(
          blocks.map((item) =>
            item.id === target.block
              ? {
                  ...item,
                  exercises: item.exercises.map((exercise) =>
                    exercise.id === target.exercise
                      ? selectStrengthLibraryExercise(
                          exercise,
                          result.exercise!
                        )
                      : exercise
                  ),
                }
              : item
          )
        )
      else mutateBlocks([...blocks, block])
    }
    exerciseLibrary.reload()
  }
  const recoverLibrary = () => {
    const catalog = exerciseLibrary.catalog
    if (!catalog) return
    try {
      const retained = strengthLibraryClient.pending(catalog.accountScope)
      if (retained) setDefinitionDialog({ recover: true })
      else setLibraryRecoveryError("No retained exercise change is available.")
    } catch (reason) {
      setLibraryRecoveryError(
        reason instanceof Error
          ? reason.message
          : "Exercise recovery could not load."
      )
    }
  }
  return (
    <>
      <Dialog
        open
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (
            !open &&
            details.reason === "escape-key" &&
            !saving &&
            !deleteInFlight.current
          )
            props.onClose()
        }}
      >
        <DialogContent
          ref={strengthDialog}
          showCloseButton={false}
          className="dsb-dialog"
          overlayClassName="dsb-backdrop"
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault()
              if (!saving && !invalid) props.onSave(false)
            }
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "z" &&
              !/INPUT|TEXTAREA|SELECT/.test(
                (event.target as HTMLElement).tagName
              )
            ) {
              event.preventDefault()
              if (!disabled) {
                if (event.shiftKey) props.redo()
                else props.undo()
              }
            }
          }}
        >
          <DialogTitle className="sr-only">Strength Workout</DialogTitle>
          <DialogDescription className="sr-only">
            Create and edit exercise blocks and sets.
          </DialogDescription>
          <header className="dsb-header">
            <DesktopStrengthSubtype
              subtype={model.strength?.subtype}
              disabled={disabled}
              onChange={(subtype) => {
                const strength = { ...model.strength! }
                if (subtype) strength.subtype = subtype
                else delete strength.subtype
                onChange({ ...model, strength })
              }}
            />
            <DesktopStrengthDateTime
              date={model.date}
              time={props.time}
              disabled={disabled}
              onDate={(date) => onChange({ ...model, date })}
              onTime={props.onTime}
              onValidity={setInvalidHeader}
            />
            <div className="dsb-header-actions">
              <button
                type="button"
                className="dsb-primary"
                disabled={!props.canSave || invalid}
                onClick={() => props.onSave(false)}
              >
                {saving ? "Saving…" : props.pending ? "Recheck Save" : "Save"}
              </button>
              <button
                type="button"
                className="dsb-outline"
                disabled={!props.canSave || invalid}
                onClick={() => props.onSave(true)}
              >
                Save &amp; Close
              </button>
              <Menu.Root
                open={menu}
                onOpenChange={(open) => {
                  if (open) menuAction.current = false
                  setMenu(open)
                }}
              >
                <Menu.Trigger
                  type="button"
                  aria-label="Strength workout options"
                  disabled={saving}
                >
                  <StrengthGlyph name="options" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner
                    className="dsb-menu-positioner"
                    side="bottom"
                    align="end"
                    sideOffset={0}
                  >
                    <Menu.Popup
                      className="dsb-header-options"
                      aria-label="Strength workout options"
                      finalFocus={(type) =>
                        menuAction.current || type !== "keyboard"
                          ? false
                          : strengthDialog.current
                      }
                    >
                      <Menu.Item
                        render={<button type="button" />}
                        disabled={!props.onFiles || disabled}
                        onClick={() => {
                          menuAction.current = true
                          setMenu(false)
                          props.onFiles?.()
                        }}
                      >
                        Files
                      </Menu.Item>
                      <Menu.Item
                        render={<button type="button" />}
                        disabled={!props.onSaveTemplate || disabled}
                        onClick={() => {
                          menuAction.current = true
                          setMenu(false)
                          props.onSaveTemplate?.()
                        }}
                      >
                        Save to Workout Library
                      </Menu.Item>
                      <Menu.Item
                        render={<button type="button" />}
                        disabled={!props.canUndo || disabled}
                        onClick={props.undo}
                      >
                        <Undo2 size={15} />
                        Undo
                      </Menu.Item>
                      <Menu.Item
                        render={<button type="button" />}
                        disabled={!props.canRedo || disabled}
                        onClick={props.redo}
                      >
                        <Redo2 size={15} />
                        Redo
                      </Menu.Item>
                      {props.onReload && (
                        <Menu.Item
                          render={<button type="button" />}
                          onClick={props.onReload}
                        >
                          Reload latest workout
                        </Menu.Item>
                      )}
                      <Menu.Item
                        render={<button type="button" />}
                        disabled={!props.onDelete || disabled}
                        onClick={() => {
                          if (!props.onDelete) return
                          menuAction.current = true
                          setDeleteError("")
                          setMenu(false)
                          setDeleteOpen(true)
                        }}
                      >
                        Delete Workout
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
              <button
                type="button"
                aria-label="Close Strength builder"
                disabled={saving}
                onClick={() => {
                  if (!deleteInFlight.current) props.onClose()
                }}
              >
                <StrengthGlyph name="close" />
              </button>
            </div>
          </header>
          {props.fileDialogs}
          {props.templateDialogs}
          {props.recovery}
          {props.error && (
            <div className="dsb-error" role="alert">
              {props.error}
            </div>
          )}
          <div className="dsb-body">
            <nav className="dsb-left-nav" aria-label="Strength views">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "summary"}
                onClick={() => setTab("summary")}
              >
                <StrengthGlyph name="summary" />
                <span className="dsb-view-label">Summary</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "history"}
                onClick={() => setTab("history")}
              >
                <StrengthGlyph name="history" />
                <span className="dsb-view-label">Exercise History</span>
              </button>
            </nav>
            <aside className="dsb-summary">
              <h2>{tab === "summary" ? "Summary" : "Exercise History"}</h2>
              {tab === "history" ? (
                <section className="dsb-history">
                  <label>
                    <input
                      aria-label="Search for an exercise to view its history"
                      list="dsb-history-exercises"
                      value={historyName}
                      onChange={(event) => {
                        setHistoryName(event.target.value)
                        setHistoryId(null)
                      }}
                      placeholder="Search for an exercise to view its history"
                    />
                    <datalist id="dsb-history-exercises">
                      {library.map((exercise) => (
                        <option key={exercise.id} value={exercise.title} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    <span className="sr-only">Saved exercise history</span>
                    <select
                      aria-label="Saved exercise history"
                      value={historyId || ""}
                      onChange={(event) => {
                        setHistoryId(event.target.value || null)
                        setHistoryName(
                          exerciseLibrary.catalog?.exercises.find(
                            (row) => row.id === event.target.value
                          )?.title || ""
                        )
                      }}
                    >
                      <option value="">Choose a saved exercise</option>
                      {exerciseLibrary.catalog?.exercises.map((row) => (
                        <option value={row.id} key={row.id}>
                          {row.title} — {row.muscleGroup}
                        </option>
                      ))}
                    </select>
                  </label>
                  {historyId && exerciseLibrary.catalog ? (
                    <StrengthLibraryHistoryView
                      id={historyId}
                      scope={exerciseLibrary.catalog.accountScope}
                      onApply={(exercise) => {
                        addBlock("single", copyExercise(exercise))
                        setTab("summary")
                      }}
                    />
                  ) : historyName && histories.length ? (
                    <>
                      <p>
                        Legacy name-only prescriptions. These entries have no
                        saved exercise identity.
                      </p>
                      {histories.map((workout) => (
                        <article key={workout.id}>
                          <h3>{workout.title}</h3>
                          <time>{workout.workout_date}</time>
                          {workout
                            .editor_model!.strength!.blocks.flatMap(
                              (block) => block.exercises
                            )
                            .filter(
                              (exercise) =>
                                !exercise.libraryExerciseId &&
                                (!historyName ||
                                  exercise.title.toLocaleLowerCase() ===
                                    historyName.toLocaleLowerCase())
                            )
                            .map((exercise) => (
                              <div key={exercise.id}>
                                <strong>{exercise.title}</strong>
                                <p>{exercise.sets.length} prescribed sets</p>
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => {
                                    addBlock("single", copyExercise(exercise))
                                    setTab("summary")
                                  }}
                                >
                                  Apply Last Prescribed
                                </button>
                              </div>
                            ))}
                        </article>
                      ))}
                    </>
                  ) : (
                    <div className="dsb-history-empty">
                      {!historyName && <p>No exercise selected</p>}
                      <p>No exercise history available</p>
                    </div>
                  )}
                </section>
              ) : (
                <>
                  <button
                    type="button"
                    className="dsb-summary-title"
                    onClick={() =>
                      document.getElementById("dsb-workout-title")?.focus()
                    }
                  >
                    {model.name}
                  </button>
                  <dl>
                    <div>
                      <dt>{exerciseCount === 1 ? "Exercise" : "Exercises"}</dt>
                      <dd>{exerciseCount}</dd>
                    </div>
                    <div>
                      <dt>{setCount === 1 ? "Set" : "Sets"}</dt>
                      <dd>{setCount}</dd>
                    </div>
                    <div>
                      <dt>Reps</dt>
                      <dd>{totals?.reps ?? (exerciseCount ? "—" : 0)}</dd>
                    </div>
                    <div>
                      <dt>Volume</dt>
                      <dd>
                        {totals?.volume
                          ? Object.entries(totals.volume)
                              .filter(([, value]) => value)
                              .map(
                                ([unit, value]) =>
                                  `${value.toLocaleString()} ${unit}`
                              )
                              .join(" + ") || "0"
                          : exerciseCount
                            ? "—"
                            : "0"}
                      </dd>
                    </div>
                    {(
                      [
                        ["duration_seconds", "Duration", "hh:mm:ss"],
                        ["tss", "TSS", "--"],
                        ["intensity_factor", "IF", "--"],
                      ] as const
                    ).map(([key, label, placeholder]) => (
                      <div key={key}>
                        <dt>
                          <label htmlFor={`dsb-${key}`}>{label}</label>
                        </dt>
                        <dd>
                          <input
                            id={`dsb-${key}`}
                            aria-label={`Planned ${label}`}
                            disabled={disabled}
                            placeholder={placeholder}
                            value={props.planned[key]}
                            onChange={(event) =>
                              props.onPlanned(key, event.target.value)
                            }
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {props.notice && (
                    <p className="dsb-sync-note" role="status">
                      {props.notice}
                    </p>
                  )}
                  <div className="dsb-block-index">
                    {blocks.map((block, index) => (
                      <button
                        key={block.id}
                        type="button"
                        onClick={() => {
                          setTab("summary")
                          blockRefs.current.get(block.id)?.scrollIntoView({
                            block: "start",
                            behavior: "smooth",
                          })
                        }}
                      >
                        <strong>{blockCode(index)}</strong>
                        <span>
                          {block.title ||
                            block.exercises[0]?.title ||
                            blockNames[block.kind]}
                          <small>
                            {block.exercises.length}{" "}
                            {block.exercises.length === 1
                              ? "Exercise"
                              : "Exercises"}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </aside>
            <main className="dsb-main">
              <>
                <section className="dsb-workout-fields">
                  <label className="dsb-float-label">
                    <span>Workout Title</span>
                    <input
                      id="dsb-workout-title"
                      aria-label="Workout Title"
                      maxLength={128}
                      value={model.name}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange({ ...model, name: event.target.value })
                      }
                    />
                    <small>Count: {model.name.length}/128</small>
                  </label>
                  <label className="dsb-float-label">
                    <span>Workout Instructions</span>
                    <textarea
                      aria-label="Workout Instructions"
                      maxLength={1000}
                      placeholder="Add instructions for this workout"
                      value={model.notes}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange({ ...model, notes: event.target.value })
                      }
                    />
                    <small>Count: {model.notes.length}/1000</small>
                  </label>
                </section>
                {props.additionalDescription}
                {blocks.map((block, index) => (
                  <article
                    className="dsb-block"
                    key={block.id}
                    ref={(node) => {
                      if (node) blockRefs.current.set(block.id, node)
                      else blockRefs.current.delete(block.id)
                    }}
                    data-strength-block={block.id}
                    onDragOver={(event) => {
                      if (drag.current && !disabled) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (drag.current && !disabled)
                        reorder(drag.current, block.id)
                      drag.current = null
                    }}
                  >
                    <div className="dsb-block-header">
                      <button
                        type="button"
                        draggable={!disabled}
                        disabled={disabled}
                        aria-label={`Move block ${blockCode(index)}`}
                        onDragStart={(event) => {
                          drag.current = block.id
                          event.dataTransfer.setData("text/plain", block.id)
                          event.dataTransfer.effectAllowed = "move"
                        }}
                        onDragEnd={() => {
                          drag.current = null
                        }}
                      >
                        {blockCode(index)}
                      </button>
                      {block.kind !== "single" && (
                        <label className="dsb-float-label">
                          <span>{blockNames[block.kind]} Title</span>
                          <input
                            maxLength={128}
                            value={block.title}
                            disabled={disabled}
                            onChange={(event) =>
                              updateBlock({
                                ...block,
                                title: event.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                      <div className="dsb-block-order">
                        <button
                          type="button"
                          aria-label={`Move block ${index + 1} up`}
                          disabled={disabled || index === 0}
                          onClick={() =>
                            reorder(block.id, blocks[index - 1].id)
                          }
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move block ${index + 1} down`}
                          disabled={disabled || index === blocks.length - 1}
                          onClick={() =>
                            reorder(block.id, blocks[index + 1].id)
                          }
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Duplicate block ${index + 1}`}
                          disabled={disabled || blocks.length >= 100}
                          onClick={() =>
                            mutateBlocks([
                              ...blocks.slice(0, index + 1),
                              {
                                ...structuredClone(block),
                                id: uid(),
                                exercises: block.exercises.map(copyExercise),
                              },
                              ...blocks.slice(index + 1),
                            ])
                          }
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove block ${index + 1}`}
                          disabled={disabled}
                          onClick={() =>
                            mutateBlocks(
                              blocks.filter((item) => item.id !== block.id)
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {block.kind !== "single" && (
                      <>
                        <div className="dsb-block-controls">
                          {block.kind !== "superset" && (
                            <>
                              <label>
                                Time (hh:mm:ss)
                                <StrengthBlockTime
                                  id={block.id}
                                  value={block.timeSeconds}
                                  label={`Block ${index + 1} time`}
                                  disabled={disabled}
                                  onChange={(seconds) =>
                                    updateBlock({
                                      ...block,
                                      timeSeconds: seconds,
                                    })
                                  }
                                  onValidity={onTimeValidity}
                                />
                              </label>
                              <label>
                                Record
                                <select
                                  aria-label={`Block ${index + 1} Record`}
                                  value="completion"
                                  disabled={disabled}
                                  onChange={() => undefined}
                                >
                                  <option value="completion">
                                    For Completion
                                  </option>
                                </select>
                              </label>
                            </>
                          )}
                          <button
                            type="button"
                            className="dsb-text-button"
                            disabled={disabled}
                            onClick={() =>
                              setBlockNotes((current) =>
                                current.includes(block.id)
                                  ? current.filter((id) => id !== block.id)
                                  : [...current, block.id]
                              )
                            }
                          >
                            Add Coach Notes
                          </button>
                        </div>
                        {timeErrors[block.id] && (
                          <p className="dsb-error" role="alert">
                            {timeErrors[block.id]}
                          </p>
                        )}
                        {(block.notes || blockNotes.includes(block.id)) && (
                          <label className="dsb-float-label">
                            <span>Coach Notes</span>
                            <textarea
                              aria-label={`Block ${index + 1} Coach Notes`}
                              maxLength={1000}
                              value={block.notes}
                              disabled={disabled}
                              onChange={(event) =>
                                updateBlock({
                                  ...block,
                                  notes: event.target.value,
                                })
                              }
                            />
                            <small>Count: {block.notes.length}/1000</small>
                          </label>
                        )}
                      </>
                    )}
                    {block.exercises.map((exercise, exerciseIndex) => (
                      <ExerciseEditor
                        key={exercise.id}
                        exercise={exercise}
                        code={`${blockCode(index)}${block.kind === "single" ? "" : exerciseIndex + 1}`}
                        disabled={disabled}
                        library={library}
                        onChange={(next) => updateExercise(block, next)}
                        onRemove={
                          block.kind !== "single" && block.exercises.length > 1
                            ? () =>
                                updateBlock({
                                  ...block,
                                  exercises: block.exercises.filter(
                                    (item) => item.id !== exercise.id
                                  ),
                                })
                            : undefined
                        }
                        onDuplicate={() => {
                          if (block.kind === "single")
                            mutateBlocks([
                              ...blocks.slice(0, index + 1),
                              newStrengthBlock(
                                "single",
                                copyExercise(exercise)
                              ),
                              ...blocks.slice(index + 1),
                            ])
                          else
                            updateBlock({
                              ...block,
                              exercises: [
                                ...block.exercises.slice(0, exerciseIndex + 1),
                                copyExercise(exercise),
                                ...block.exercises.slice(exerciseIndex + 1),
                              ],
                            })
                        }}
                        onConvert={
                          block.kind === "single"
                            ? (kind) =>
                                updateBlock({
                                  ...block,
                                  kind,
                                  title:
                                    kind === "single" ? "" : blockNames[kind],
                                  timeSeconds:
                                    kind === "circuit" ? 0 : block.timeSeconds,
                                })
                            : undefined
                        }
                        onHistory={viewHistory}
                        onCreate={(title) => {
                          setDefinitionDialog({
                            title,
                            target: { block: block.id, exercise: exercise.id },
                          })
                        }}
                        onEditLibrary={(id) => editDefinition(id)}
                        canCreate={Boolean(
                          exerciseLibrary.catalog &&
                          !exerciseLibrary.busy &&
                          !exerciseLibrary.catalog.readOnly
                        )}
                        onValidity={onValidity}
                      />
                    ))}
                    {block.kind !== "single" && (
                      <button
                        type="button"
                        className="dsb-text-button"
                        disabled={disabled || block.exercises.length >= 100}
                        onClick={() => {
                          const exercise = newStrengthExercise()
                          if (
                            ["circuit", "warmup", "cooldown"].includes(
                              block.kind
                            )
                          )
                            exercise.sets = exercise.sets.slice(0, 1)
                          updateBlock({
                            ...block,
                            exercises: [...block.exercises, exercise],
                          })
                        }}
                      >
                        <Plus size={15} />
                        Add Exercise
                      </button>
                    )}
                  </article>
                ))}
                <div className="dsb-add-block" data-empty={blocks.length === 0}>
                  <button
                    type="button"
                    className="dsb-primary"
                    disabled={disabled || blocks.length >= 100}
                    aria-expanded={add}
                    onClick={() => setAdd((value) => !value)}
                  >
                    Add Block
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M6.5 12h11M12 6.5v11"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  {add && (
                    <div className="dsb-add-options">
                      <p>OR SELECT TO CREATE</p>
                      {(
                        [
                          "single",
                          "circuit",
                          "cooldown",
                          "warmup",
                          "superset",
                        ] as const
                      ).map((kind) => (
                        <button
                          type="button"
                          key={kind}
                          onClick={() => addBlock(kind)}
                        >
                          {blockNames[kind]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {props.validation.length > 0 && blocks.length > 0 && (
                  <div className="dsb-validation" role="status">
                    {props.validation.map((value) => (
                      <p key={value}>{value}</p>
                    ))}
                  </div>
                )}
              </>
            </main>
            {panel && (
              <aside className="dsb-right-panel">
                <header>
                  <h2>
                    {panel === "library"
                      ? "Library"
                      : panel === "comments"
                        ? "Comments"
                        : "Private Notes"}
                  </h2>
                  <button
                    type="button"
                    aria-label="Close Strength side panel"
                    onClick={() => setPanel(null)}
                  >
                    <X size={18} />
                  </button>
                </header>
                {panel === "notes" ? (
                  props.privateNotes
                ) : panel === "comments" ? (
                  <>
                    <label>
                      Add Comment
                      <textarea
                        maxLength={2000}
                        value={props.comment}
                        disabled={disabled}
                        onChange={(event) =>
                          props.onComment(event.target.value)
                        }
                      />
                    </label>
                    {props.comments.map((comment) => (
                      <p key={comment.id}>{comment.body}</p>
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={
                        disabled ||
                        exerciseLibrary.busy ||
                        !exerciseLibrary.catalog ||
                        exerciseLibrary.catalog.readOnly ||
                        blocks.length >= 100
                      }
                      onClick={() => setDefinitionDialog({})}
                    >
                      Add Exercise
                    </button>
                    <input
                      aria-label="Search exercise library"
                      placeholder="Search exercises"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <div className="sel-library-toolbar">
                      <label>
                        Owner
                        <select
                          aria-label="Exercise owner"
                          value={libraryOwner}
                          onChange={(event) =>
                            setLibraryOwner(event.target.value)
                          }
                        >
                          <option value="all">All</option>
                          <option value="me">Me</option>
                        </select>
                      </label>
                      <label>
                        Muscle Group
                        <select
                          aria-label="Exercise muscle group"
                          value={muscle}
                          onChange={(event) => setMuscle(event.target.value)}
                        >
                          <option value="all">All</option>
                          {strengthMuscleGroups.map((group) => (
                            <option key={group}>{group}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="sel-library-status">
                      Your custom exercise definitions. Built-in exercise
                      catalog and media are unavailable.
                    </p>
                    {(exerciseLibrary.error || libraryRecoveryError) && (
                      <p className="sel-library-status" role="alert">
                        {exerciseLibrary.error || libraryRecoveryError}
                      </p>
                    )}
                    {exerciseLibrary.busy && (
                      <p className="sel-library-status" role="status">
                        Loading exercise library…
                      </p>
                    )}
                    {exerciseLibrary.catalog?.readOnly && (
                      <p role="status">This exercise library is read-only.</p>
                    )}
                    <div className="sel-library-toolbar">
                      <button
                        type="button"
                        disabled={exerciseLibrary.busy}
                        onClick={() => {
                          setLibraryRecoveryError("")
                          exerciseLibrary.reload()
                        }}
                      >
                        Reload exercise library
                      </button>
                      <button
                        type="button"
                        disabled={
                          !exerciseLibrary.catalog || exerciseLibrary.busy
                        }
                        onClick={recoverLibrary}
                      >
                        Recover exercise save
                      </button>
                    </div>
                    {filteredCustom.map((row) => (
                      <StrengthLibraryCard
                        key={row.id}
                        exercise={row}
                        disabled={disabled}
                        canInsert={blocks.length < 100}
                        onAdd={() =>
                          mutateBlocks([
                            ...blocks,
                            strengthLibraryExerciseBlock(row),
                          ])
                        }
                        onPreview={() => editDefinition(row.id, true)}
                        onEdit={() => editDefinition(row.id)}
                        onHistory={() => {
                          setHistoryId(row.id)
                          setHistoryName(row.title)
                          setTab("history")
                        }}
                        onDelete={() =>
                          setDefinitionDialog({
                            row,
                            preview: true,
                            deleting: true,
                          })
                        }
                      />
                    ))}
                    {exerciseLibrary.catalog &&
                      !filteredCustom.length &&
                      !filteredLegacy.length && <p>No Exercise Results</p>}
                    {exerciseLibrary.catalog &&
                      !exerciseLibrary.catalog.exercises.length && (
                        <p>No custom exercises saved.</p>
                      )}
                    {Boolean(legacyLibrary.length) && (
                      <h3 className="sel-legacy-heading">
                        Legacy saved prescriptions
                      </h3>
                    )}
                    {filteredLegacy.map((exercise) => (
                      <button
                        type="button"
                        key={exercise.id}
                        disabled={disabled || blocks.length >= 100}
                        onClick={() =>
                          addBlock("single", copyExercise(exercise))
                        }
                      >
                        <Dumbbell size={16} />
                        {exercise.title}
                        <Plus size={16} />
                      </button>
                    ))}
                    {!legacyLibrary.length && (
                      <p>Your saved exercise prescriptions appear here.</p>
                    )}
                  </>
                )}
              </aside>
            )}
            <nav className="dsb-right-nav" aria-label="Strength panels">
              {(
                [
                  ["library", "Library", "library"],
                  ["comments", "Comments", "comments"],
                  ["notes", "Private Notes", "notes"],
                ] as const
              ).map(([id, label, glyph]) => (
                <button
                  type="button"
                  key={id}
                  aria-expanded={panel === id}
                  onClick={() =>
                    setPanel((current) => (current === id ? null : id))
                  }
                >
                  <StrengthGlyph name={glyph} />
                  <span className="dsb-view-label">{label}</span>
                </button>
              ))}
            </nav>
          </div>
          {definitionDialog && exerciseLibrary.catalog && (
            <StrengthExerciseDefinitionDialog
              catalog={exerciseLibrary.catalog}
              exercise={definitionDialog.row}
              initialTitle={definitionDialog.title}
              preview={definitionDialog.preview}
              recover={definitionDialog.recover}
              deleteRequested={definitionDialog.deleting}
              onClose={() => setDefinitionDialog(null)}
              onSaved={definitionSaved}
              onResolved={exerciseLibrary.reload}
            />
          )}
          <AlertDialog
            open={props.discardOpen}
            onOpenChange={props.onDiscardOpen}
          >
            <AlertDialogContent
              onKeyDown={(event) => {
                event.stopPropagation()
                if (
                  (event.ctrlKey || event.metaKey) &&
                  ["s", "z"].includes(event.key.toLowerCase())
                )
                  event.preventDefault()
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                <AlertDialogDescription>
                  Saved changes remain. Discard removes this unsaved draft.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={props.onDiscard}>
                  Discard
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={deleteOpen}
            onOpenChange={(open) => {
              if (!deleteInFlight.current) setDeleteOpen(open)
            }}
          >
            <AlertDialogContent
              onKeyDown={(event) => {
                event.stopPropagation()
                if (
                  (event.ctrlKey || event.metaKey) &&
                  ["s", "z"].includes(event.key.toLowerCase())
                )
                  event.preventDefault()
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Are you sure you want to delete?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone!
                  <span className="sr-only">
                    {" "}
                    Strength workout: {model.name}.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError && <p role="alert">{deleteError}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={() => void deleteWorkout()}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </>
  )
}
