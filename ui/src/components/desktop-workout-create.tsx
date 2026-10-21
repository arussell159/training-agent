import { useWorkoutAccountBoundary } from "@/hooks/use-workout-account-boundary"
import { registerWorkoutNavigationGuard, bypassWorkoutNavigationGuard } from "@/lib/workout-navigation-guard"
import { useEffect, useMemo, useRef, useState } from "react"
import { BarChart3 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import {
  DesktopWorkoutHeader,
  type DesktopWorkoutMetadata,
} from "./desktop-workout-header"
import {
  WorkoutEditor,
  type DesktopBuilderSubmission,
} from "./workout-editor-launcher"
import {
  createPlannedWorkout,
  trainingCacheScope,
  type PlannedWorkout,
  type WorkoutSummaryValues,
} from "@/lib/training-context"
import {
  changedPlannedValues,
  formatPlannedValue,
  plannedValueDraft,
  plannedValueRows,
  recordedValueRows,
  plannedDraftValue,
  hasPlannedValueChanges,
  updatePlannedValueDraft,
} from "@/lib/planned-workout-values"
import { randomId } from "@/lib/random-id"
import {
  readPendingWorkoutCreation,
  inspectPendingWorkoutCreation,
  rememberPendingWorkoutCreation,
  clearPendingWorkoutCreation,
  type PendingWorkoutCreation,
} from "@/lib/pending-workout-creation"
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
import { simpleWorkoutModel } from "../../../app-backend/lib/simple-workout.mjs"
import {
  builderWorkoutModel,
  hasWorkoutStructure,
} from "@/lib/unstructured-workout"
import {
  workoutPresentationSport,
  workoutSelection,
  type WorkoutVariant,
} from "@/lib/workout-presentation"
import {
  chartSegments,
  workoutTotals,
  type WorkoutModel,
} from "../../../app-backend/lib/workout-editor-model.mjs"
import "./desktop-workout-details.css"
import "./desktop-strength-builder.css"
import {
  useWorkoutPersonalFields,
  WorkoutDescriptionInput,
  WorkoutDetailNavigation,
  WorkoutEquipment,
  WorkoutPersonalNotes,
  WorkoutAttachments,
} from "./desktop-workout-personal-fields"
import { removeWorkoutLocalMetadata } from "@/lib/workout-local-metadata"
import { yieldForWorkoutFeedback } from "@/lib/workout-feedback-frame"
import { useToastManager } from "./ui/toast"
import { useWorkoutFiles } from "./workout-file-actions"
import { WorkoutRecurrenceControl } from "./desktop-workout-recurrence"
import {
  applyWorkoutRecurrence,
  type WorkoutRecurrenceDraft,
} from "@/lib/workout-recurrence"
import {
  clearWorkoutSaveDraft,
  readWorkoutSaveDraft,
  retainWorkoutSaveDraft,
} from "@/lib/workout-save-drafts"

type DesktopWorkoutCreateProps = {
  date: string
  initialSport?: string
  initialName?: string
  initialVariant?: WorkoutVariant
  initialModel?: WorkoutModel
  initialWarnings?: string[]
  onClose: () => void
  onSaved: (workout: PlannedWorkout, close: boolean, notice?: string) => void
}

export function DesktopWorkoutCreate(props: DesktopWorkoutCreateProps) {
  const [pendingState] = useState(() => {
    try {
      return inspectPendingWorkoutCreation(localStorage, trainingCacheScope())
    } catch {
      return {
        status: "blocked" as const,
        error:
          "Browser storage is unavailable. Restore access so an earlier workout save can be checked before creating another.",
      }
    }
  })
  const pending = pendingState.status === "pending" ? pendingState.input : null
  const [strengthMode, setStrengthMode] = useState<"choose" | "old" | "new">(
    props.initialModel?.strength || pending?.model.strength ? "new" : "choose"
  )
  const [strengthModel] = useState<WorkoutModel>(() =>
    pending?.model.strength
      ? structuredClone(pending.model)
      : props.initialModel?.strength
        ? structuredClone(props.initialModel)
        : {
            version: 1,
            name: "Strength Workout",
            sport: "WeightTraining",
            date: props.date,
            notes: "",
            poolLength: "",
            steps: [],
            strength: { version: 1, blocks: [] },
          }
  )
  if (pendingState.status === "blocked")
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
      >
        <DialogContent>
          <DialogTitle>Review the earlier workout save</DialogTitle>
          <DialogDescription>{pendingState.error}</DialogDescription>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </DialogContent>
      </Dialog>
    )
  if (
    (!pending || pending.model.strength) &&
    (pending?.model.strength ||
      props.initialSport === "WeightTraining" ||
      props.initialModel?.strength) &&
    !props.initialModel?.steps.length
  ) {
    if (strengthMode === "choose")
      return (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) props.onClose()
          }}
        >
          <DialogContent className="dsb-selector" showCloseButton={false}>
            <header>
              <DialogTitle>Strength Workout</DialogTitle>
              <button
                type="button"
                aria-label="Close strength builder selector"
                onClick={props.onClose}
              >
                ×
              </button>
            </header>
            <DialogDescription className="sr-only">
              Choose a strength builder.
            </DialogDescription>
            <div>
              <button type="button" onClick={() => setStrengthMode("old")}>
                Old Strength Builder
              </button>
              <button type="button" onClick={() => setStrengthMode("new")}>
                New Strength Builder
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )
    if (strengthMode === "new")
      return (
        <WorkoutEditor
          date={strengthModel.date}
          initialSport="WeightTraining"
          initialName="Strength Workout"
          initialModel={strengthModel}
          onClose={props.onClose}
          onSaved={(workout, close) => props.onSaved(workout, Boolean(close))}
        />
      )
  }
  return <LegacyDesktopWorkoutCreate {...props} />
}

// A certified rejection is editable local recovery, never a pending provider intent.
const rejectedCreationSection = "rejected-create"
function readRejectedCreation(scope: string) {
  return readWorkoutSaveDraft<PendingWorkoutCreation>(scope,"new-workout",rejectedCreationSection,input => input?.reconcileOnly === false && Boolean(readPendingWorkoutCreation({getItem:()=>JSON.stringify({version:1,input}),setItem:()=>{},removeItem:()=>{}},scope)))?.value || null
}
function clearRejectedCreation(scope: string, creationId: string) {
  if(readRejectedCreation(scope)?.creationId === creationId)clearWorkoutSaveDraft(scope,"new-workout",rejectedCreationSection)
}

function LegacyDesktopWorkoutCreate({
  date,
  initialSport = "Run",
  initialName = "Run",
  initialVariant,
  initialModel,
  initialWarnings,
  onClose,
  onSaved,
}: DesktopWorkoutCreateProps) {
  const toast = useToastManager()
  const dialog = useRef<HTMLDivElement>(null)
  const account = useWorkoutAccountBoundary(true)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [scope] = useState(trainingCacheScope)
  const [recovered] = useState(() => {
    try {
      return readPendingWorkoutCreation(localStorage, scope) || readRejectedCreation(scope)
    } catch {
      return null
    }
  })
  const [creationId] = useState(() => recovered?.creationId || randomId())
  const [seedModel] = useState(
    () =>
      recovered?.model || (initialModel ? structuredClone(initialModel) : null)
  )
  const personal = useWorkoutPersonalFields(scope, `draft:${creationId}`)
  const [recurrence, setRecurrence] = useState<WorkoutRecurrenceDraft | null>(
    () =>
      readWorkoutSaveDraft<WorkoutRecurrenceDraft>(
        scope,
        `draft:${creationId}`,
        "recurrence"
      )?.value || null
  )
  const [selectedSport, setSelectedSport] = useState(
    seedModel?.sport || initialSport
  )
  const [selectedVariant, setSelectedVariant] = useState(
    seedModel?.variant || initialVariant
  )
  const [selectionChanged, setSelectionChanged] = useState(false)
  const [metadata, setMetadata] = useState<DesktopWorkoutMetadata>({
    name: seedModel?.name || "",
    date: seedModel?.date || date,
    time: recovered?.time || "",
  })
  const [draft, setDraft] = useState(() =>
    plannedValueDraft(
      recovered?.values,
      workoutPresentationSport(
        seedModel || { sport: initialSport, variant: initialVariant }
      )
    )
  )
  const [description, setDescription] = useState(seedModel?.notes || "")
  const [comment, setComment] = useState(recovered?.comment || "")
  const [structure, setStructure] = useState<WorkoutModel | null>(seedModel)
  const nativeSport = structure?.sport || selectedSport
  const variant = structure ? structure.variant : selectedVariant
  const sport = workoutPresentationSport({ sport: nativeSport, variant })
  const sportName =
    (
      {
        Ride: "Bike",
        MountainBikeRide: "Mtn Bike",
        NordicSki: "XC-Ski",
        Workout: "Crosstrain",
        WeightTraining: "Strength",
        Other:
          initialName === "Sauna" &&
          nativeSport === initialSport &&
          !selectionChanged
            ? "Sauna"
            : "Other",
      } as Record<string, string>
    )[sport] || sport
  const defaultName =
    nativeSport === initialSport &&
    variant === initialVariant &&
    !selectionChanged
      ? initialName
      : sportName
  const [builder, setBuilder] = useState<WorkoutModel | null>(() =>
    initialModel && !recovered && seedModel
      ? builderWorkoutModel(seedModel)
      : null
  )
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const autoCalculate = personal.value.autoCalculate
  const [uncertain, setUncertain] = useState(
    Boolean(recovered) && recovered?.reconcileOnly !== false
  )
  const [error, setError] = useState(
    recovered
      ? recovered.reconcileOnly === false
        ? "The previous save was rejected. Review your retained draft and save again."
        : "A previous save needs confirmation. Recheck this draft before creating another workout."
      : ""
  )
  const [discardPending, setDiscardPending] = useState(false)
  const saving = useRef(false)
  const submitted = useRef<Parameters<typeof createPlannedWorkout>[0] | null>(
    recovered?.reconcileOnly === false ? null : recovered
  )
  const submittedExtras = useRef<{personal:typeof personal.value,recurrence:WorkoutRecurrenceDraft|null}|null>((recovered as (typeof recovered & {creatorSnapshot?:{personal:typeof personal.value,recurrence:WorkoutRecurrenceDraft|null}}))?.creatorSnapshot || null)
  const hasDraft = Boolean(
    metadata.name ||
    metadata.date !== date ||
    metadata.time ||
    selectedSport !== initialSport ||
    selectedVariant !== initialVariant ||
    description ||
    comment ||
    personal.dirty ||
    recurrence ||
    structure ||
    hasPlannedValueChanges(draft, plannedValueDraft(null, sport), sport)
  )
  const navigationResolve = useRef<((allowed:boolean)=>void)|null>(null)
  const navigationCleanup = useRef(false)
  const navigation = useRef({dirty:false,prepare:async()=>false,commit:()=>{}})
  const clearRecovery = () => {
    clearPendingWorkoutCreation(localStorage,scope,creationId)
    clearRejectedCreation(scope,creationId)
    removeWorkoutLocalMetadata(scope,`draft:${creationId}`)
    clearWorkoutSaveDraft(scope,`draft:${creationId}`,"recurrence")
  }
  const prepareNavigation = async () => {
    navigationCleanup.current=false
    if(saving.current || busy || personal.busy || !account.isCurrent() || discardPending)return false
    if(uncertain || builder)return true
    if(!hasDraft)return true
    return new Promise<boolean>(resolve=>{navigationResolve.current=resolve;setDiscardPending(true)})
  }
  const commitNavigation = () => {
    if(!navigationCleanup.current)return
    if(!account.isCurrent())throw Error("The connected account changed. Reopen this workout.")
    clearRecovery();navigationCleanup.current=false
  }
  navigation.current={dirty:hasDraft || busy || uncertain,prepare:prepareNavigation,commit:commitNavigation}
  useEffect(()=>{const unregister=registerWorkoutNavigationGuard(()=>navigation.current.prepare(),()=>navigation.current.dirty,5,()=>navigation.current.commit());return()=>{unregister();navigationResolve.current?.(false);navigationResolve.current=null}},[])
  const onDiscardChange = (open:boolean) => {setDiscardPending(open);if(!open){navigationResolve.current?.(false);navigationResolve.current=null}}
  const confirmDiscard = () => {
    if(saving.current || busy || personal.busy || !account.isCurrent())return
    if(navigationResolve.current){navigationCleanup.current=true;const resolve=navigationResolve.current;navigationResolve.current=null;resolve(true);return}
    try{clearRecovery()}catch{setError("The recovery draft could not be discarded. Keep this editor open and retry.");return}
    bypassWorkoutNavigationGuard(onClose)
  }
  const requestClose = () => {
    if (saving.current || busy || personal.busy || !account.isCurrent()) return
    // An uncertain provider write already has its own durable recovery record.
    // Ordinary unsaved drafts must be explicitly discarded before dismissal.
    if (hasDraft && !uncertain) setDiscardPending(true)
    else bypassWorkoutNavigationGuard(onClose)
  }
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy || uncertain || hasDraft) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [busy, uncertain, hasDraft])
  const blank = plannedValueDraft(null, sport)
  let values: Partial<WorkoutSummaryValues> = {}
  try {
    values = changedPlannedValues(draft, blank, sport)
  } catch {
    /* Invalid drafts remain editable. */
  }
  const preview: PlannedWorkout = {
    id: `draft:${creationId}`,
    title: metadata.name,
    sport: sportName,
    provider_type: nativeSport,
    display_variant: variant,
    date: metadata.date,
    workout_date: metadata.date,
    day: "",
    status: "upcoming",
    duration: "",
    goal: description,
    planned_values_edited: true,
    workout_summary: { planned: values, completed: null },
  }
  const files = useWorkoutFiles({
    model: structure
      ? {
          ...structure,
          name: metadata.name || defaultName,
          date: metadata.date,
          notes: description,
        }
      : {
          version: 1,
          name: metadata.name || defaultName,
          sport: nativeSport,
          ...(variant ? { variant } : {}),
          date: metadata.date,
          notes: description,
          poolLength: sport === "Swim" ? "25y" : "",
          steps: [],
        },
  })
  const startBuilder = () => {
    const base = {
      name: metadata.name.trim() || defaultName,
      sport: nativeSport,
      ...(variant ? { variant } : {}),
      date: metadata.date,
      description,
      values,
    }
    const model = structure
      ? { ...structure, name: base.name, date: base.date, notes: description }
      : ({
          version: 1,
          name: base.name,
          sport: nativeSport,
          ...(variant ? { variant } : {}),
          date: base.date,
          notes: description,
          poolLength: sport === "Swim" ? "25y" : "",
          steps: [],
        } as WorkoutModel)
    setBuilder(builderWorkoutModel(model))
  }
  const applyStructure = (model: WorkoutModel) => {
    setStructure(model)
    setMetadata((current) => ({
      ...current,
      name: model.name,
      date: model.date,
    }))
    setDescription(model.notes)
    const totals = workoutTotals(model)
    setDraft((current) => ({
      ...current,
      duration_seconds:
        totals.unknownTime || totals.open
          ? ""
          : formatPlannedValue(
              "duration_seconds",
              totals.seconds,
              workoutPresentationSport(model)
            ),
      distance_meters:
        totals.unknownDistance || !totals.distance
          ? ""
          : formatPlannedValue(
              "distance_meters",
              /swim/i.test(model.sport)
                ? totals.distance / 0.9144
                : totals.distance,
              workoutPresentationSport(model)
            ),
      average_speed: "",
      average_pace: "",
      average_speed_source: undefined,
      average_speed_exact: undefined,
      tss: totals.load == null ? "" : String(Math.round(totals.load)),
    }))
  }
  const save = async (
    close: boolean,
    built?: DesktopBuilderSubmission & { model: WorkoutModel }
  ) => {
    if (saving.current || personal.busy || !account.isCurrent()) return
    saving.current = true
    setBusy(true)
    setError("")
    let providerStarted = false
    try {
      await yieldForWorkoutFeedback()
      // Older clients stored certified rejections in the pending slot. Retire
      // only that explicitly rejected identity before constructing an edited retry.
      const prior = !uncertain ? readPendingWorkoutCreation(localStorage,scope) : null
      if(prior?.creationId === creationId && prior.reconcileOnly === false) {
        if(!clearPendingWorkoutCreation(localStorage,scope,creationId) || inspectPendingWorkoutCreation(localStorage,scope).status !== "empty")throw Object.assign(Error("The rejected draft could not be retired. Restore browser storage before retrying."),{status:409,code:"CREATION_STORAGE"})
      }
      // The builder shares this draft but owns its own loaded snapshot. Pick up
      // files added there before deciding whether personal data must migrate.
      const durableSave = /^(Swim|Ride|Run)$/.test(nativeSport) && !uncertain
      if (built && !uncertain && !durableSave) await personal.refresh()
      if(!account.ownsAccount())throw Error("The connected account changed. Reopen this workout.")
      const planned = submitted.current?.values || built?.values || changedPlannedValues(draft, blank, sport)
      const base = {
        name: built?.model.name || metadata.name.trim() || defaultName,
        sport: built?.model.sport || nativeSport,
        variant: built ? built.model.variant : variant,
        date: built?.model.date || metadata.date,
        description: built?.model.notes ?? description,
        values: planned,
      }
      const model =
        submitted.current?.model || built?.model ||
        (structure
          ? {
              ...structure,
              name: base.name,
              date: base.date,
              notes: description,
            }
          : (simpleWorkoutModel(base) as WorkoutModel))
      const input = submitted.current || {
        model,
        descriptionMode: "manual" as const,
        description: base.description,
        values: planned,
        time: built?.time ?? metadata.time,
        comment: built?.comment ?? comment,
        creationId,
      }
      submitted.current = input
      if(!submittedExtras.current)submittedExtras.current=structuredClone({personal:built?.personal || personal.value,recurrence:built && "recurrence" in built ? built.recurrence || null : recurrence})
      const retainedExtras=submittedExtras.current
      const repeatDraft = retainedExtras.recurrence
      if (repeatDraft)
        retainWorkoutSaveDraft(
          scope,
          `draft:${creationId}`,
          "recurrence",
          repeatDraft
        )
      if (!durableSave) await personal.save(`draft:${creationId}`, retainedExtras.personal)
      if(!account.ownsAccount())throw Error("The connected account changed. Reopen this workout.")
      const retainedInput={...input,creatorSnapshot:retainedExtras}
      if(!rememberPendingWorkoutCreation(localStorage, scope, retainedInput))throw Object.assign(Error("This browser could not retain the pending save. Allow browser storage before creating a workout."),{status:409,code:"CREATION_STORAGE"})
      providerStarted = true
      if(!account.ownsAccount())throw Error("The connected account changed. Reopen this workout.")
      // Pending recovery also contains local-only snapshots. Serialize only
      // the public request fields so a reload cannot change the provider body.
      const result = await createPlannedWorkout({
        model: input.model,
        values: input.values,
        time: input.time,
        comment: input.comment,
        creationId: input.creationId,
        ...(input.descriptionMode !== undefined ? {descriptionMode:input.descriptionMode} : {}),
        ...(input.description !== undefined ? {description:input.description} : {}),
        reconcileOnly: uncertain,
        ...(durableSave ? { personal: retainedExtras.personal, personalId: personal.id, recurrence: repeatDraft } : {}),
      })
      if(!account.ownsAccount())throw Error("The connected account changed. Reopen this workout.")
      let personalWarning = ""
      try {
        if (!durableSave) await personal.save(
          result.workout.id,
          retainedExtras.personal
        )
      } catch (reason) {
        if(!account.ownsAccount())throw reason
        personalWarning =
          "Workout saved. Personal fields or attachments still need to sync. Reopen creation and recheck the retained draft to finish saving them."
        toast.add({
          type: "info",
          title: "Personal fields need recovery",
          description: personalWarning,
          timeout: 10000,
        })
      }
      if(!account.ownsAccount())throw Error("The connected account changed. Reopen this workout.")
      let repeatWarning = ""
      if (repeatDraft && !durableSave) {
        try {
          await applyWorkoutRecurrence(result.workout.id, repeatDraft)
          if(!account.ownsAccount())throw Error("The connected account changed. Reopen this workout.")
          clearWorkoutSaveDraft(scope, `draft:${creationId}`, "recurrence")
          setRecurrence(null)
        } catch (reason) {
          if(!account.ownsAccount())throw reason
          repeatWarning = `Workout saved. Its repeat schedule still needs confirmation: ${reason instanceof Error ? reason.message : "recheck the retained draft."}`
          toast.add({
            type: "info",
            title: "Repeat schedule needs confirmation",
            description: repeatWarning,
            timeout: 10000,
          })
        }
      }
      try {
        if (!personalWarning && !repeatWarning)
          clearPendingWorkoutCreation(localStorage, scope, creationId)
      } catch {
        /* Optional storage. */
      }
      clearRejectedCreation(scope,creationId)
      // Dismiss only after provider confirmation. A failed Save & Close keeps
      // the same editor and draft visible; a retired popup cannot affect a new one.
      if (mounted.current && account.isCurrent())
        onSaved(
          result.workout,
          close,
          [personalWarning, repeatWarning, result.refreshWarning]
            .filter(Boolean)
            .join(" ") || undefined
        )
    } catch (reason) {
      const failure = reason as Error & { status?: number; code?: string }
      if (uncertain) {
        // An interrupted personal-field retry cannot resolve an earlier
        // unconfirmed provider creation. Keep its idempotent recovery request.
      } else if (
        providerStarted &&
        !(
          failure.status &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.code !== "CREATE_UNCONFIRMED"
        )
      )
        setUncertain(true)
      else {
        try {
          clearPendingWorkoutCreation(localStorage, scope, creationId)
          if (providerStarted && submitted.current)
            retainWorkoutSaveDraft(scope,"new-workout",rejectedCreationSection,{...submitted.current,reconcileOnly:false,creatorSnapshot:submittedExtras.current})
        } catch {
          /* Optional storage. */
        }
        submitted.current = null
        submittedExtras.current = null
        setUncertain(false)
      }
      setError(
        failure.message ||
          "The workout could not be saved. Your draft is retained."
      )
      // The builder must keep its recovery draft and display this failure,
      // instead of treating a handled creation error as a successful save.
      if (built) throw reason
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const profile = useMemo(() => {
    const segments = structure ? chartSegments(structure).segments : []
    const total = segments.reduce((sum, item) => sum + item.width, 0)
    const high = Math.max(
      1,
      ...segments.flatMap((item) => [item.start, item.end])
    )
    let left = 0
    return segments.map((item, index) => {
      const bar = {
        key: item.step.id + index,
        x: total ? (600 * left) / total : 0,
        width: total ? Math.max(0.5, (600 * item.width) / total - 1) : 0,
        height: (30 * Math.max(item.start, item.end, high * 0.2)) / high,
      }
      left += item.width
      return bar
    })
  }, [structure])
  if (builder)
    return (
      <WorkoutEditor
        date={builder.date}
        initialSport={nativeSport}
        initialModel={builder}
        initialWarnings={initialWarnings}
        externalCreationPending={uncertain}
        initialDesktopDraft={{
          values,
          time: metadata.time,
          comment,
          personal: personal.value,
          personalId: personal.id,
          recurrence,
        }}
        onApplyDraft={async (model, submission) => {
          if(uncertain){await save(submission?.close ?? false);return}
          applyStructure(model)
          if (submission) {
            setDraft(
              plannedValueDraft(
                submission.values,
                workoutPresentationSport(model)
              )
            )
            setMetadata({
              name: model.name,
              date: model.date,
              time: submission.time,
            })
            setComment(submission.comment)
            if (submission.personal) personal.setValue(submission.personal)
            if ("recurrence" in submission)
              setRecurrence(submission.recurrence || null)
            await save(submission.close, { ...submission, model })
          }
        }}
        onClose={() => {
          if (initialModel && !recovered) onClose()
          else setBuilder(null)
        }}
      />
    )
  const disabled = busy || uncertain || personal.busy
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent
          ref={dialog}
          initialFocus={() =>
            dialog.current?.querySelector<HTMLInputElement>(
              '[aria-label="Workout title"]'
            ) || false
          }
          showCloseButton={false}
          className={`desktop-workout-preview desktop-workout-create ${expanded ? "desktop-workout-dialog-expanded" : ""}`}
        >
          <DialogTitle className="sr-only">
            New {preview.sport.toLowerCase()} workout
          </DialogTitle>
          <DialogDescription className="sr-only">
            Enter planned values or build structured intervals, then save the
            workout.
          </DialogDescription>
          <DesktopWorkoutHeader
            workout={preview}
            isNew
            expanded={expanded}
            onToggleExpanded={() => setExpanded((value) => !value)}
            onUpload={files.upload}
            onExport={files.exportWorkout}
            recurrence={
              <WorkoutRecurrenceControl
                date={metadata.date}
                disabled={disabled}
                draft={recurrence}
                onDraftChange={setRecurrence}
              />
            }
            settings={
              <label className="desktop-workout-auto-calculate">
                <input
                  type="checkbox"
                  checked={autoCalculate}
                  disabled={disabled}
                  onChange={(event) =>
                    personal.setValue({
                      ...personal.value,
                      autoCalculate: event.target.checked,
                    })
                  }
                />
                Automatically calculate planned values
              </label>
            }
            actions={
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={startBuilder}
                >
                  Build Workout
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={files.upload}
                >
                  Upload activity
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={files.exportWorkout}
                >
                  Export workout
                </button>
              </>
            }
            metadata={metadata}
            onMetadataChange={(value) => {
              setError("")
              setMetadata(value)
            }}
            onSportChange={(next) => {
              setError("")
              const selection = workoutSelection(next)
              setSelectedSport(selection.sport)
              setSelectedVariant(selection.variant)
              setSelectionChanged(true)
              if (structure)
                setStructure({
                  ...structure,
                  ...selection,
                  variant: selection.variant,
                })
              setDraft(
                plannedValueDraft(
                  values,
                  workoutPresentationSport(selection),
                  sport
                )
              )
            }}
            busy={disabled}
            onClose={requestClose}
          />
          <section
            className="desktop-new-workout-build"
            aria-label="Workout structure"
          >
            <button type="button" disabled={disabled} onClick={startBuilder}>
              <BarChart3 size={19} />
              {hasWorkoutStructure(structure)
                ? "Edit Workout"
                : "Build Workout"}
            </button>
            {hasWorkoutStructure(structure) ? (
              <svg
                viewBox="0 0 600 36"
                preserveAspectRatio="none"
                aria-label="Planned workout profile"
              >
                {profile.map((bar) => (
                  <rect
                    key={bar.key}
                    x={bar.x}
                    y={34 - bar.height}
                    width={bar.width}
                    height={bar.height}
                  />
                ))}
              </svg>
            ) : (
              <div className="desktop-new-workout-outline" aria-hidden="true">
                <span>Warm up</span>
                <span>Main set</span>
                <span>Cool down</span>
              </div>
            )}
          </section>
          <div className="desktop-workout-dialog-body">
            <form
              id={`desktop-totals-${preview.id}`}
              onSubmit={(event) => {
                event.preventDefault()
                void save(false)
              }}
            >
              <div className="desktop-workout-details-shell">
                <WorkoutDetailNavigation />
                <div className="desktop-workout-details-grid">
                  <section
                    className="desktop-workout-totals"
                    aria-label="Planned and completed values"
                  >
                    <table>
                      <colgroup>
                        <col className="metric-label" />
                        <col />
                        <col />
                        <col className="metric-unit" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th />
                          <th scope="col">Planned</th>
                          <th scope="col">Completed</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {plannedValueRows(sport).map(
                          ({
                            key,
                            rowKey = key,
                            presentation,
                            label,
                            unit,
                            planned: allowPlanned = true,
                          }) => (
                            <tr key={rowKey}>
                              <th scope="row">
                                <label
                                  className={
                                    allowPlanned
                                      ? "desktop-editable-metric"
                                      : undefined
                                  }
                                  htmlFor={
                                    allowPlanned ? `new-${rowKey}` : undefined
                                  }
                                >
                                  {label}
                                </label>
                              </th>
                              <td>
                                {allowPlanned ? (
                                  <input
                                    id={`new-${rowKey}`}
                                    aria-label={`Planned ${label.toLowerCase()}`}
                                    value={plannedDraftValue(
                                      draft,
                                      key,
                                      sport,
                                      presentation
                                    )}
                                    disabled={
                                      disabled || key === "normalized_power"
                                    }
                                    onChange={(event) => {
                                      setError("")
                                      setDraft((current) =>
                                        updatePlannedValueDraft(
                                          current,
                                          key,
                                          event.target.value,
                                          sport,
                                          autoCalculate,
                                          presentation
                                        )
                                      )
                                    }}
                                    onBlur={() => {
                                      if (
                                        key === "duration_seconds" &&
                                        /^\d+:[0-5]\d$/.test(draft[key])
                                      )
                                        setDraft((current) => ({
                                          ...current,
                                          [key]: `0:${current[key]}`,
                                        }))
                                    }}
                                  />
                                ) : (
                                  <span
                                    aria-label={`Planned ${label.toLowerCase()}`}
                                  >
                                    —
                                  </span>
                                )}
                              </td>
                              <td>
                                <output
                                  aria-label={`Completed ${label.toLowerCase()}`}
                                  className="desktop-recorded-value"
                                />
                              </td>
                              <td>{unit}</td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                    <table
                      className="desktop-new-recorded-values"
                      aria-label="Recorded minimum average maximum"
                    >
                      <colgroup>
                        <col className="metric-label" />
                        <col />
                        <col />
                        <col />
                        <col className="metric-unit" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th />
                          <th>Min</th>
                          <th>Avg</th>
                          <th>Max</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {recordedValueRows(sport).map(({ label, unit }) => (
                          <tr key={label}>
                            <th>{label}</th>
                            {["minimum", "average", "maximum"].map((value) => (
                              <td key={value}>
                                <output
                                  aria-label={`Recorded ${value} ${label.toLowerCase()}`}
                                  className="desktop-recorded-value"
                                />
                              </td>
                            ))}
                            <td>{unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <WorkoutEquipment
                      value={personal.value}
                      onChange={personal.setValue}
                      scope={scope}
                      sport={sport}
                      disabled={disabled || sport === "Swim"}
                      options={personal.equipmentOptions}
                    />
                  </section>
                  <div className="desktop-workout-detail-text">
                    <section className="desktop-workout-description">
                      <WorkoutAttachments personal={personal} disabled={disabled || files.busy} />
                      <WorkoutDescriptionInput
                        aria-label="Workout description"
                        maxLength={12000}
                        disabled={disabled}
                        value={description}
                        onChange={(event) => {
                          setError("")
                          setDescription(event.target.value)
                        }}
                      />
                    </section>
                    <section className="desktop-planned-comments">
                      <h3>Post-activity Comments</h3>
                      <textarea
                        aria-label="New planned workout comment"
                        placeholder="Enter a new comment"
                        maxLength={2000}
                        disabled={disabled}
                        value={comment}
                        onChange={(event) => {
                          setError("")
                          setComment(event.target.value)
                        }}
                      />
                    </section>
                    <WorkoutPersonalNotes
                      value={personal.value}
                      onChange={personal.setValue}
                      disabled={disabled}
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>
          <footer className="desktop-workout-dialog-footer">
            <label className="desktop-workout-auto-calculate">
              <input
                type="checkbox"
                checked={autoCalculate}
                disabled={disabled}
                onChange={(event) =>
                  personal.setValue({
                    ...personal.value,
                    autoCalculate: event.target.checked,
                  })
                }
              />{" "}
              Automatically calculate planned values
            </label>
            {error && (
              <p role="alert" className="desktop-workout-save-error">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={busy || personal.busy}
              onClick={requestClose}
            >
              {uncertain ? "Close" : "Cancel"}
            </button>
            {uncertain && (
              <button
                type="button"
                disabled={busy || personal.busy}
                onClick={() => setDiscardPending(true)}
              >
                Discard draft
              </button>
            )}
            <button
              type="button"
              disabled={busy || personal.busy}
              onClick={() => void save(false)}
            >
              {busy ? "Saving…" : uncertain ? "Recheck save" : "Save"}
            </button>
            <button
              type="button"
              className="desktop-workout-save-close"
              disabled={busy || personal.busy}
              onClick={() => void save(true)}
            >
              {uncertain ? "Recheck & Close" : "Save & Close"}
            </button>
          </footer>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardPending} onOpenChange={onDiscardChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {uncertain
                ? "Discard this unconfirmed draft?"
                : "Discard unsaved changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {uncertain
                ? "The earlier request may already have reached Intervals.icu. Check the calendar before creating another copy."
                : "Discard this workout draft? Your unsaved changes will be lost."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || personal.busy}
              onClick={confirmDiscard}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {files.dialogs}
    </>
  )
}
