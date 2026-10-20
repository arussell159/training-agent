import { useEffect, useRef, useState } from "react"
import {
  loadWorkoutComments,
  clearWorkoutReads,
  type WorkoutComment,
} from "@/lib/workout-read-cache"
import { randomId } from "@/lib/random-id"
import {
  trainingCacheScope,
  queueWorkoutMutation,
  beginWorkoutSaveFeedback,
  saveWorkoutComment,
  type PlannedWorkout,
} from "@/lib/training-context"
import { desktopWorkoutDescription } from "@/lib/desktop-workout-description"
import { readWorkoutSaveDraft, retainWorkoutSaveDraft, clearWorkoutSaveDraft, validTextSaveDraft, type TextSaveDraft } from "@/lib/workout-save-drafts"

export function useWorkoutTextDraft(
  workout: PlannedWorkout,
  readOnly: boolean
) {
  const [scope] = useState(trainingCacheScope)
  const [recovered] = useState(() => readWorkoutSaveDraft<TextSaveDraft>(scope, workout.id, "text",validTextSaveDraft)?.value)
  const editable =
    !readOnly && /^(event:[1-9]\d*|activity:i?\d+)$/.test(workout.id)
  const type = workout.status === "completed" ? "post" : "pre"
  const original = desktopWorkoutDescription(workout)
  const [savedDescription, setSavedDescription] = useState(original)
  const [description, setDescription] = useState(recovered?.description ?? original)
  const baseline = useRef(original)
  useEffect(() => {
    if (baseline.current === original) return
    const previous = baseline.current
    baseline.current = original
    setDescription((draft) => (draft === previous ? original : draft))
    setSavedDescription(original)
  }, [original])
  const [comment, setComment] = useState(recovered?.comment || "")
  const [comments, setComments] = useState<WorkoutComment[]>([])
  const [creationId, setCreationId] = useState(() => recovered?.creationId || randomId())
  const [commentsError, setCommentsError] = useState("")
  const [commentsLoading, setCommentsLoading] = useState(editable)
  const [commentsNeedSync, setCommentsNeedSync] = useState(false)
  const [commentsVersion, setCommentsVersion] = useState(0)
  useEffect(() => {
    const saved = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id === workout.id)
        setCommentsVersion((value) => value + 1)
    }
    window.addEventListener("workout-editor-saved", saved)
    return () => window.removeEventListener("workout-editor-saved", saved)
  }, [workout.id])
  useEffect(() => {
    if (!editable) return
    const controller = new AbortController()
    setCommentsLoading(true)
    setCommentsError("")
    void loadWorkoutComments(workout.id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setCommentsNeedSync(Boolean(data.needsSync))
          setComments((previous) => [
            ...new Map<string, WorkoutComment>(
              [...data.comments, ...previous].map((item) => [item.id, item])
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
  }, [editable, workout.id, commentsVersion])
  const dirty =
    editable &&
    (description !== savedDescription ||
      Boolean(comment.trim()) ||
      commentsNeedSync)
  const retain = () => {
    if (dirty) retainWorkoutSaveDraft(scope, workout.id, "text", { description, comment, creationId })
  }
  const discardDraft = () => clearWorkoutSaveDraft(scope, workout.id, "text")
  const save = async (options: { feedback?: boolean } = {}) => {
    if (!editable || !dirty) return
    let token = retainWorkoutSaveDraft(scope, workout.id, "text", { description, comment, creationId })
    const feedback = beginWorkoutSaveFeedback(options.feedback !== false,workout.id)
    try {
      if (description !== savedDescription) {
        await queueWorkoutMutation(
          { type: "description", id: workout.id, description, descriptionMode: "manual" },
          true,
          { feedback: false }
        )
        setSavedDescription(description)
        // A later comment failure must not replay the confirmed description.
        token = retainWorkoutSaveDraft(scope, workout.id, "text", { comment, creationId })
        window.dispatchEvent(
          new CustomEvent("workout-description-updated", {
            detail: { id: workout.id, description },
          })
        )
      }
      if (comment.trim() || commentsNeedSync) {
        const result = await saveWorkoutComment({
          workoutId: workout.id,
          body: comment,
          type,
          creationId,
          syncOnly: !comment.trim(),
        })
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
    editable,
    type,
    description,
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
