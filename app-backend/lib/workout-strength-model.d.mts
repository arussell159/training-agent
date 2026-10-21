export type StrengthBlockKind = "single" | "circuit" | "warmup" | "cooldown" | "superset";
export type StrengthSubtype =
  | "Mobility"
  | "Functional Fitness"
  | "Yoga"
  | "Rock Climbing"
  | "Hybrid Strength"
  | "Stretching";
export type StrengthParameterKind =
  | "weight"
  | "weightPerSide"
  | "reps"
  | "repsPerSide"
  | "duration"
  | "distance"
  | "height"
  | "rpe"
  | "rir";
export type StrengthParameter = { id: string; kind: StrengthParameterKind; unit: string };
export type StrengthSet = { id: string; values: Record<string, number | null> };
export type StrengthExercise = {
  id: string;
  libraryExerciseId?: string;
  title: string;
  instructions: string;
  notes: string;
  parameters: StrengthParameter[];
  sets: StrengthSet[];
};
export type StrengthBlock = {
  id: string;
  kind: StrengthBlockKind;
  title: string;
  instructions: string;
  notes: string;
  timeSeconds: number | null;
  recordMode: "completion";
  exercises: StrengthExercise[];
};
export type StrengthPrescription = {
  version: 1;
  blocks: StrengthBlock[];
  subtype?: StrengthSubtype;
  startTimeAssigned?: boolean;
};
export const strengthBlockKinds: StrengthBlockKind[];
export const strengthSubtypes: readonly StrengthSubtype[];
export const STRENGTH_MARKER: string;
export const strengthParameterFields: {
  kind: StrengthParameterKind;
  label: string;
  units: string[];
  min: number;
  max: number;
  integer?: boolean;
}[];
export function validateStrengthPrescription(value: unknown): string[];
export function isStrengthPrescription(value: unknown): value is StrengthPrescription;
export function newStrengthExercise(title?: string): StrengthExercise;
export function newStrengthBlock(
  kind?: StrengthBlockKind,
  exercise?: StrengthExercise
): StrengthBlock;
export function addStrengthParameter(
  exercise: StrengthExercise,
  kind?: StrengthParameterKind,
  unit?: string
): StrengthExercise;
export function setStrengthValue(
  exercise: StrengthExercise,
  setId: string,
  parameterId: string,
  value: number | null
): StrengthExercise;
export function copyStrengthPrescription(value: StrengthPrescription): StrengthPrescription;
export function strengthTotals(value: StrengthPrescription): {
  exercises: number;
  sets: number;
  reps: number | null;
  volume: { lb: number; kg: number } | null;
  durationSeconds: null;
  tss: null;
  intensityFactor: null;
};
export function strengthPrescriptionText(value: StrengthPrescription): string;
