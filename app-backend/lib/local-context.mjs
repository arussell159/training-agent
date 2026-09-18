import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDurableState, writeDurableState } from "./durable-state.mjs";
import { createAnnualPlanStore } from "./annual-plan-store.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = path.join(root, "local-data.json");
let writeQueue = Promise.resolve();
const annualPlanStore = createAnnualPlanStore();

function seed() {
  return {
    athlete: { id: "default", time_zone: "America/Chicago" },
    metrics: {},
    history: [],
    planned: [],
    comments: [],
    library: [],
    training_preferences: {},
    updated_at: new Date().toISOString(),
  };
}

async function readData() {
  try {
    const data = await readDurableState("APP_DATA", dataPath, seed);
    data.athlete = { id: "default", time_zone: "America/Chicago", ...(data.athlete || {}) };
    // Training load metrics are owned exclusively by Intervals, never seeded
    // or restored from application preferences / legacy TrainingPeaks data.
    data.metrics = { ...data.metrics, fitness: null, fatigue: null, form: null };
    data.history = [];
    data.planned = [];
    data.workouts = [];
    data.training_preferences =
      data.training_preferences && typeof data.training_preferences === "object"
        ? data.training_preferences
        : {};
    return data;
  } catch (error) {
    // Local development must remain usable when Supabase is temporarily
    // unreachable. The JSON file is a read-only recovery snapshot here.
    try {
      const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
      data.athlete = { id: "default", time_zone: "America/Chicago", ...(data.athlete || {}) };
      data.metrics = { ...data.metrics, fitness: null, fatigue: null, form: null };
      data.history = [];
      data.planned = [];
      data.workouts = [];
      data.training_preferences =
        data.training_preferences && typeof data.training_preferences === "object"
          ? data.training_preferences
          : {};
      return data;
    } catch {
      throw new Error(`Database state unavailable: ${error.message}`);
    }
  }
}

async function mutateData(mutator) {
  const operation = writeQueue.then(async () => {
    const data = await readData();
    const result = await mutator(data);
    data.updated_at = new Date().toISOString();
    await writeDurableState("APP_DATA", data, dataPath);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function legacyAnnualPlanState(data) {
  const plans = Array.isArray(data.annual_plans) ? data.annual_plans : [];
  const activeId = data.active_annual_plan_id || plans[0]?.id || null;
  return { plans, activeId };
}

function sameJson(a, b) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    return value;
  };
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function samePlanState(a, b) {
  if (a.activeId !== b.activeId || a.plans.length !== b.plans.length) return false;
  return a.plans.every((plan) =>
    b.plans.some((candidate) => candidate.id === plan.id && sameJson(candidate, plan))
  );
}

async function readAnnualPlanState(data) {
  const legacy = legacyAnnualPlanState(data);
  try {
    const stored = await annualPlanStore.readAll();
    if (!stored.plans.length && legacy.plans.length) {
      return await annualPlanStore.replaceFromLegacy(legacy.plans, legacy.activeId);
    }
    if (!stored.plans.length && !legacy.plans.length) return stored;

    // Once populated, the dedicated table is authoritative. Keep APP_DATA as a
    // synchronized recovery copy so existing app semantics and rollback remain intact.
    if (!samePlanState(stored, legacy)) {
      await mutateData((current) => {
        current.annual_plans = structuredClone(stored.plans);
        current.active_annual_plan_id = stored.activeId;
        return true;
      });
    }
    return stored;
  } catch {
    // Zero-downtime fallback: any dedicated-store problem leaves the existing
    // encrypted APP_DATA path fully functional.
    return legacy;
  }
}

export async function readLocalContext() {
  const data = await readData();
  const annual = await readAnnualPlanState(data);
  // Only expose current app data; historical records remain in storage.
  return Object.fromEntries(
    [
      "athlete",
      "metrics",
      "history",
      "planned",
      "workouts",
      "library",
      "training_preferences",
      "updated_at",
    ]
      .map((key) => [key, data[key]])
      .concat([
        ["annual_plans", annual.plans],
        ["active_annual_plan_id", annual.activeId],
        [
          "comments",
          (data.comments || []).filter((comment) => ["pre", "post"].includes(comment.type)),
        ],
      ])
  );
}

export async function updateTrainingPreferences(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences))
    throw new Error("Valid training preferences are required");
  return mutateData((data) => {
    const next = { ...(data.training_preferences || {}) };
    delete next.updated_at;
    for (const [key, value] of Object.entries(preferences)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    data.training_preferences = Object.keys(next).length
      ? { ...next, updated_at: new Date().toISOString() }
      : {};
    return data.training_preferences;
  });
}

export async function listAnnualPlans() {
  const data = await readData();
  return (await readAnnualPlanState(data)).plans;
}

export async function saveAnnualPlanRecord(plan) {
  if (!plan?.id || !plan?.name || !Array.isArray(plan.weeks))
    throw new Error("A valid annual plan is required.");

  // Preserve the original APP_DATA behavior first. If the dedicated table is
  // unavailable, the application remains fully functional on the legacy path.
  const state = await mutateData((data) => {
    data.annual_plans = Array.isArray(data.annual_plans) ? data.annual_plans : [];
    const index = data.annual_plans.findIndex((item) => item.id === plan.id);
    if (index >= 0) data.annual_plans[index] = plan;
    else data.annual_plans.unshift(plan);
    data.active_annual_plan_id = plan.id;
    return {
      saved: plan,
      plans: structuredClone(data.annual_plans),
      activeId: data.active_annual_plan_id,
    };
  });

  try {
    await annualPlanStore.replaceFromLegacy(state.plans, state.activeId);
  } catch {
    // The encrypted recovery copy is authoritative until the dedicated store
    // succeeds on a later read/save.
  }
  return state.saved;
}

export async function deleteAnnualPlanRecord(id) {
  const state = await mutateData((data) => {
    data.annual_plans = (Array.isArray(data.annual_plans) ? data.annual_plans : []).filter(
      (plan) => plan.id !== id
    );
    if (data.active_annual_plan_id === id)
      data.active_annual_plan_id = data.annual_plans[0]?.id || null;
    return {
      plans: structuredClone(data.annual_plans),
      activeId: data.active_annual_plan_id || null,
    };
  });
  try {
    await annualPlanStore.replaceFromLegacy(state.plans, state.activeId);
  } catch {
    // Legacy APP_DATA remains the recovery source if the dedicated store is unavailable.
  }
  return true;
}

export async function addLocalComment(workoutId, body) {
  return mutateData((data) => {
    const comment = {
      id: "comment-" + Date.now(),
      workout_id: workoutId,
      type: "post",
      body,
      created_at: new Date().toISOString(),
    };
    data.comments = [comment, ...(data.comments || [])];
    return comment;
  });
}
