import { createElement } from "react"
import { PageSkeleton } from "../components/loading-layouts"
import { WorkoutAnalysisSkeleton, Analysis360Skeleton } from "../components/workout-analysis-skeleton"
import { preloadable } from "./preloadable"
import { prefetchWorkoutRecording } from "./activity-analysis"
import { prefetchWorkoutValues } from "./workout-read-cache"
import type { PlannedWorkout } from "./training-context"

export const workoutDetailRoute = preloadable(() => import("../components/workout-detail-page").then(module => ({ default: module.WorkoutDetailPage })), () => createElement(PageSkeleton, {page:"Workout"}))
export const workoutAnalysisRoute = preloadable(() => import("../components/workout-analysis").then(module => ({ default: module.WorkoutAnalysis })), () => createElement(WorkoutAnalysisSkeleton))
export const workoutAnalysis360Route = preloadable(() => import("../components/workout-analysis-360").then(module => ({ default: module.WorkoutAnalysis360 })), () => createElement(Analysis360Skeleton))
export function prepareWorkout(workout: PlannedWorkout, recording = false) {
  if (workout.app_pending_operation) return
  prefetchWorkoutValues(workout)
  if (recording && (workout.activity_id || workout.id.startsWith("activity:"))) {
    prefetchWorkoutRecording(workout)
    void workoutAnalysisRoute.preload().catch(() => {})
  }
}
