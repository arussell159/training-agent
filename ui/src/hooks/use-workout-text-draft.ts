import { useEffect, useRef, useState } from "react"
import { useWorkoutAccountBoundary } from "./use-workout-account-boundary"
import {
  loadWorkoutComments,
  loadWorkoutEditor,
  clearWorkoutReads,
  type WorkoutComment,
} from "@/lib/workout-read-cache"
import { randomId } from "@/lib/random-id"
import {
  trainingCacheScope,
  queueWorkoutMutation,
  beginWorkoutSaveFeedback,
  saveWorkoutComment,
  writeWorkoutEditor,
  type PlannedWorkout,
} from "@/lib/training-context"
import { desktopWorkoutDescription } from "@/lib/desktop-workout-description"
import {
  readWorkoutSaveDraft,
  retainWorkoutSaveDraft,
  clearWorkoutSaveDraft,
  validTextSaveDraft,
  type TextSaveDraft,
} from "@/lib/workout-save-drafts"

export function useWorkoutTextDraft(
  workout: PlannedWorkout,
  readOnly: boolean
) {
  const { ownsAccount } = useWorkoutAccountBoundary(true)
  const requireCurrentAccount = () => {
    if (!ownsAccount())
      throw Error(
        "The connected account changed. Reopen the workout before saving."
      )
  }
  const [scope] = useState(trainingCacheScope)
  const [recovered] = useState(
    () =>
      readWorkoutSaveDraft<TextSaveDraft>(
        scope,
        workout.id,
        "text",
        validTextSaveDraft
      )?.value
  )
  const editable =
    !readOnly && /^(event:[1-9]\d*|app:[a-f0-9-]+|activity:i?\d+)$/.test(workout.id)
  const type = workout.status === "completed" ? "post" : "pre"
  const commentTargetId = workout.status === "completed" && workout.activity_id ? `activity:${workout.activity_id}` : workout.id
  const activityText = commentTargetId.startsWith("activity:")
  const original = desktopWorkoutDescription(workout)
  const [savedDescription, setSavedDescription] = useState(original)
  const [description, setDescription] = useState(
    recovered?.description ?? original
  )
  const baseline = useRef(original)
  useEffect(() => {
    // A provisional calendar projection is not a saved text baseline. Adopting
    // it would make a rejected write's rollback replace the user's dirty draft.
    if (activityText || workout.app_pending_operation || baseline.current === original) return
    const previous = baseline.current
    baseline.current = original
    setDescription((draft) => (draft === previous ? original : draft))
    setSavedDescription(original)
  }, [original, workout.app_pending_operation, activityText])
  const [comment, setComment] = useState(recovered?.comment || "")
  const [comments, setComments] = useState<WorkoutComment[]>([])
  const [creationId, setCreationId] = useState(
    () => recovered?.creationId || randomId()
  )
  const [commentsError, setCommentsError] = useState("")
  const [commentsLoading, setCommentsLoading] = useState(editable)
  const [commentsNeedSync, setCommentsNeedSync] = useState(false)
  const [commentsVersion, setCommentsVersion] = useState(0)
  const [completedEditableFields, setCompletedEditableFields] = useState<string[]>([])
  useEffect(() => {
    const saved = (event: Event) => {
      if ([workout.id,commentTargetId].includes((event as CustomEvent<{ id?: string }>).detail?.id || ""))
        setCommentsVersion((value) => value + 1)
    }
    window.addEventListener("workout-editor-saved", saved)
    return () => window.removeEventListener("workout-editor-saved", saved)
  }, [workout.id, commentTargetId])
  useEffect(() => {
    if (!editable) return
    const controller = new AbortController()
    setCommentsLoading(true)
    setCommentsError("")
    const read = activityText
      ? loadWorkoutEditor(`/api/workouts/${encodeURIComponent(commentTargetId)}/editor`,controller.signal).then(editor=>{
          if(!controller.signal.aborted){
            const nativeDescription=editor.manualDescription ?? editor.originalDescription
            setDescription(current=>current===baseline.current && !recovered ? nativeDescription : current)
            baseline.current=nativeDescription
            setSavedDescription(nativeDescription)
            setCompletedEditableFields(editor.completedEditableFields || [])
          }
          return {comments:(editor.comments || []).map(item=>({...item,workout_id:workout.id,type:"post",created_at:"created_at" in item ? String(item.created_at || "") : ""})),needsSync:false}
        })
      : loadWorkoutComments(commentTargetId, controller.signal)
    void read
      .then((data) => {
        if (!controller.signal.aborted) {
          setCommentsNeedSync(Boolean(data.needsSync))
          setComments((previous) => [
            ...new Map<string, WorkoutComment>(
              [...data.comments.map(item=>({...item,workout_id:workout.id})), ...previous].map((item) => [item.id, item])
            ).values(),
          ])
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setCommentsError(reason.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommentsLoading(false)
      })
    return () => controller.abort()
  }, [editable, workout.id, commentTargetId, commentsVersion, activityText, recovered])
  const dirty =
    editable &&
    (description !== savedDescription ||
      Boolean(comment.trim()) ||
      commentsNeedSync)
  const retain = () => {
    if (dirty)
      retainWorkoutSaveDraft(scope, workout.id, "text", {
        description,
        comment,
        creationId,
      })
  }
  const discardDraft = () => clearWorkoutSaveDraft(scope, workout.id, "text")
  const save = async (options: { feedback?: boolean } = {}) => {
    if (!editable || !dirty) return
    requireCurrentAccount()
    let token = retainWorkoutSaveDraft(scope, workout.id, "text", {
      description,
      comment,
      creationId,
    })
    const feedback = beginWorkoutSaveFeedback(
      options.feedback !== false,
      workout.id
    )
    try {
      if (workout.id.startsWith("activity:") || workout.activity_id && workout.status === "completed") {
        const target = workout.activity_id ? `activity:${workout.activity_id}` : workout.id
        const editor = await loadWorkoutEditor(`/api/workouts/${encodeURIComponent(target)}/editor`)
        requireCurrentAccount()
        if(description !== savedDescription && editor.originalDescription !== savedDescription)
          throw Error("The description changed in Intervals.icu. Your draft is retained; reopen it to review both versions.")
        await writeWorkoutEditor(target, {model:editor.model,revision:editor.revision,completedEditableFields:editor.completedEditableFields,...(description!==savedDescription ? {description,descriptionMode:"manual" as const} : {}),comment,commentId:creationId})
        requireCurrentAccount()
        clearWorkoutSaveDraft(scope,workout.id,"text",token)
        setSavedDescription(description)
        if(comment.trim())setComments(previous=>[...previous,{id:creationId,body:comment.trim(),type,workout_id:workout.id,created_at:new Date().toISOString()}])
        setCommentsNeedSync(false)
        setComment("")
        setCreationId(randomId())
        return
      }
      if (description !== savedDescription) {
        await queueWorkoutMutation(
          {
            type: "description",
            id: workout.id,
            description,
            descriptionMode: "manual",
          },
          true,
          { feedback: false }
        )
        requireCurrentAccount()
        setSavedDescription(description)
        // A later comment failure must not replay the confirmed description.
        token = retainWorkoutSaveDraft(scope, workout.id, "text", {
          comment,
          creationId,
        })
        window.dispatchEvent(
          new CustomEvent("workout-description-updated", {
            detail: { id: workout.id, description },
          })
        )
      }
      if (comment.trim() || commentsNeedSync) {
        requireCurrentAccount()
        const result = await saveWorkoutComment({
          workoutId: workout.id,
          body: comment,
          type,
          creationId,
          syncOnly: !comment.trim(),
        })
        requireCurrentAccount()
        setComments(
          result.comments ||
            (result.id
              ? [result, ...comments.filter((item) => item.id !== result.id)]
              : comments)
        )
        clearWorkoutReads()
        setCommentsNeedSync(false)
        setComment("")
        setCreationId(randomId())
      }
      clearWorkoutSaveDraft(scope, workout.id, "text", token)
      feedback.confirm()
    } catch (error) {
      feedback.fail(error)
      throw error
    }
  }
  return {
    creationId,
    acceptCommitted() {
      clearWorkoutSaveDraft(scope, workout.id, "text")
      setSavedDescription(description)
      baseline.current = description
      if (comment.trim()) setComments(previous => [...previous.filter(item => item.id !== creationId), {id:creationId,body:comment.trim(),workout_id:workout.id,type,created_at:new Date().toISOString()}])
      setCommentsNeedSync(false)
      setComment("")
      setCreationId(randomId())
    },
    editable,
    type,
    description,
    savedDescription,
    completedEditableFields,
    setDescription,
    comment,
    setComment,
    comments,
    commentsError,
    commentsLoading,
    dirty,
    retain,
    discardDraft,
    save,
  }
}

export type WorkoutTextDraft = ReturnType<typeof useWorkoutTextDraft>
