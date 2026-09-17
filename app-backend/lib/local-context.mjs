import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDurableState, writeDurableState } from "./durable-state.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = path.join(root, "local-data.json");
let writeQueue = Promise.resolve();

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

export async function readLocalContext() {
  const data = await readData();
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
      "annual_plans",
      "active_annual_plan_id",
      "updated_at",
    ]
      .map((key) => [key, data[key]])
      .concat([
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
  return Array.isArray(data.annual_plans) ? data.annual_plans : [];
}

export async function saveAnnualPlanRecord(plan) {
  if (!plan?.id || !plan?.name || !Array.isArray(plan.weeks))
    throw new Error("A valid annual plan is required.");
  return mutateData((data) => {
    data.annual_plans = Array.isArray(data.annual_plans) ? data.annual_plans : [];
    const index = data.annual_plans.findIndex((item) => item.id === plan.id);
    if (index >= 0) data.annual_plans[index] = plan;
    else data.annual_plans.unshift(plan);
    data.active_annual_plan_id = plan.id;
    return plan;
  });
}

export async function deleteAnnualPlanRecord(id) {
  return mutateData((data) => {
    data.annual_plans = (Array.isArray(data.annual_plans) ? data.annual_plans : []).filter(
      (plan) => plan.id !== id
    );
    if (data.active_annual_plan_id === id)
      data.active_annual_plan_id = data.annual_plans[0]?.id || null;
    return true;
  });
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
