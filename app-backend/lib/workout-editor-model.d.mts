export type Role = "warmup" | "active" | "recovery" | "rest" | "cooldown" | "other";
export type Target =
  | { kind: "none"; unit?: never; mode?: never; value?: never; start?: never; end?: never }
  | {
      kind: "power" | "pace" | "hr";
      unit: string;
      mode: "single" | "range" | "ramp";
      value?: number;
      start?: number;
      end?: number;
    };
export type Step = {
  id: string;
  kind: "step";
  label: string;
  notes: string;
  role: Role;
  end: { kind: "time" | "distance" | "lap"; value: number; unit: string; pressLap?: boolean };
  target: Target;
  cadence: { start: number; end: number } | null;
};
export type Repeat = {
  id: string;
  kind: "repeat";
  label: string;
  notes: string;
  repetitions: number;
  sets: number;
  steps: WorkoutNode[];
  recovery: Step | null;
  finalRecovery: boolean;
  setRecovery: Step | null;
};
export type WorkoutNode = Step | Repeat;
export type WorkoutModel = {
  version: 1;
  name: string;
  sport: string;
  date: string;
  notes: string;
  poolLength: string;
  steps: WorkoutNode[];
  thresholds?: { ftp?: number | null; pace?: number | null };
};
export type ImportResult = {
  model: WorkoutModel;
  issues: string[];
  warnings: string[];
  originalDescription: string;
  reviewRequired: boolean;
  ambiguousSwim: boolean;
};
export const DEFINITION_MARKER: string;
export const roles: Role[];
export const roleNames: Record<Role, string>;
export const distanceFactors: Record<string, number>;
export const paceFactors: Record<string, number>;
export const targetUnits: Record<string, string[]>;
export const templateNames: string[];
export function uid(): string;
export function clone<T>(value: T): T;
export function round(value: number, digits?: number): number;
export function clock(value: number): string;
export function defaultTarget(sport: string): Target;
export function newStep(sport: string, role?: Role): Step;
export function newRepeat(steps: WorkoutNode[]): Repeat;
export function copyNodes(nodes: WorkoutNode[]): WorkoutNode[];
export function walkNodes(
  nodes: WorkoutNode[],
  fn: (node: WorkoutNode, parent: Repeat | null) => void,
  parent?: Repeat | null
): void;
export function findNode(nodes: WorkoutNode[], id: string): WorkoutNode | undefined;
export function updateNodes(
  nodes: WorkoutNode[],
  ids: string[],
  change: (node: WorkoutNode) => WorkoutNode
): WorkoutNode[];
export function removeNodes(nodes: WorkoutNode[], ids: string[]): WorkoutNode[];
export function insertNodes(
  nodes: WorkoutNode[],
  parentId: string | null,
  index: number,
  added: WorkoutNode[]
): WorkoutNode[];
export function moveNode(
  nodes: WorkoutNode[],
  id: string,
  parentId: string | null,
  index: number
): WorkoutNode[];
export function expandSteps(
  nodes: WorkoutNode[],
  limit?: number
): { step: Step; group: string | null; iteration: number }[];
export function validateWorkout(model: WorkoutModel): string[];
export function convertTarget(target: Target, unit: string, ftp?: number | null): Target;
export function targetLabel(target: Target): string;
export function stepLabel(node: WorkoutNode): string;
export function stepMetrics(
  step: Step,
  thresholds?: WorkoutModel["thresholds"]
): { seconds: number | null; distance: number | null; estimated: boolean; open: boolean };
export function workoutTotals(model: WorkoutModel): {
  seconds: number;
  distance: number;
  work: number;
  recovery: number;
  rest: number;
  unknownTime: boolean;
  unknownDistance: boolean;
  estimated: boolean;
  open: boolean;
  load: number | null;
  executedSteps: number;
  repetitions: number;
};
export function chartSegments(model: WorkoutModel): {
  segments: {
    step: Step;
    group: string | null;
    iteration: number;
    index: number;
    width: number;
    estimated: boolean;
    start: number;
    end: number;
  }[];
  axis: string;
  estimated: boolean;
  placeholder: boolean;
};
export function nativeWorkoutText(model: WorkoutModel): string;
export function workoutOutline(model: WorkoutModel): string;
export function serializeWorkout(model: WorkoutModel): string;
export function readableDescription(description: string): string;
export function readEditorModel(description: string): WorkoutModel | null;
export function importWorkout(event: Record<string, unknown>): ImportResult;
export function verifyParsedWorkout(model: WorkoutModel, event: Record<string, unknown>): string[];
export function makeTemplate(name: string, sport: string): WorkoutNode[];
