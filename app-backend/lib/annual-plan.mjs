import { randomUUID } from "node:crypto";

export const ANNUAL_PLAN_PHASES = [
  "Not Set",
  "Preparation",
  "Base 1",
  "Base 2",
  "Base 3",
  "Build 1",
  "Build 2",
  "Peak",
  "Race",
  "Transition",
];

export const SEASON_SOURCE = {
  source_id: "bourdon-load-monitoring-2017",
  passage_id: "multidisciplinary-monitoring",
  title: "Monitoring Athlete Training Loads: Consensus Statement",
  url: "https://pubmed.ncbi.nlm.nih.gov/28463642/",
  claim: "load_management",
  application:
    "Weekly targets use the athlete’s recorded training, event dates, recovery cycle, and availability together; no single load metric is treated as a complete readiness decision.",
};

const DAY = 86_400_000;
const iso = (date) => new Date(date).toISOString().slice(0, 10);
const date = (value) => new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
const shift = (value, days) => iso(date(value).getTime() + days * DAY);
const monday = (value) => {
  const current = date(value);
  current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
  return iso(current);
};
const sunday = (value) => shift(monday(value), 6);
const finite = (value) =>
  value === "" || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function seasonWeekCount(startDate, endDate) {
  return Math.floor((date(monday(endDate)) - date(monday(startDate))) / (7 * DAY)) + 1;
}

export function normalizeEvent(event = {}) {
  if (!event.name?.trim()) throw new Error("Every event needs a name.");
  const eventDate = iso(date(event.date));
  const priority = ["A", "B", "C"].includes(event.priority) ? event.priority : null;
  return {
    id: String(event.id || randomUUID()),
    name: String(event.name).trim(),
    date: eventDate,
    sport: String(event.sport || "Triathlon"),
    distance: String(event.distance || ""),
    priority,
    goal: String(event.goal || ""),
    targetCtl: finite(event.targetCtl),
    source: event.source || "annual-plan",
  };
}

function validateSettings(settings) {
  const startDate = monday(settings.startDate);
  const endDate = sunday(settings.endDate);
  const count = seasonWeekCount(startDate, endDate);
  if (count < 4 || count > 104)
    throw new Error("Plan range must be between 4 and 104 Monday–Sunday weeks.");
  const mode = settings.mode === "manual" ? "manual" : "automatic";
  const methodology = ["hours", "tss", "target_ctl"].includes(settings.methodology)
    ? settings.methodology
    : "hours";
  const cycle = Number(settings.recoveryCycle) === 3 ? 3 : 4;
  const events = (settings.events || [])
    .map(normalizeEvent)
    .filter((event) => event.date >= startDate && event.date <= endDate);
  if (
    mode === "automatic" &&
    methodology === "target_ctl" &&
    !events.some((event) => event.priority === "A" && event.targetCtl != null)
  ) {
    throw new Error("Target CTL planning requires a CTL target on at least one A-priority event.");
  }
  const baseline = finite(settings.baseline);
  return {
    ...settings,
    startDate,
    endDate,
    mode,
    methodology,
    recoveryCycle: cycle,
    events,
    baseline,
  };
}

function nearestEvent(events, weekStart) {
  return (
    events
      .filter((event) => event.date >= weekStart)
      .sort((a, b) => a.date.localeCompare(b.date) || a.priority.localeCompare(b.priority))[0] ||
    null
  );
}

function aRaceDistance(weekStart, events) {
  const weekTime = date(weekStart).getTime();
  const races = events
    .filter((event) => event.priority === "A")
    .map((event) => ({
      event,
      weeks: Math.floor((date(monday(event.date)) - weekTime) / (7 * DAY)),
    }));
  return (
    races
      .filter((item) => item.weeks < 0 && item.weeks >= -2)
      .sort((a, b) => b.weeks - a.weeks)[0] ||
    races.filter((item) => item.weeks >= 0).sort((a, b) => a.weeks - b.weeks)[0] ||
    races.sort((a, b) => b.weeks - a.weeks)[0] ||
    null
  );
}

function phaseForWeek(_index, weekStart, settings) {
  const { events, recoveryCycle } = settings;
  const race = aRaceDistance(weekStart, events);
  if (!race) return { phase: "Not Set", phaseWeek: null, recovery: false };
  const delta = race.weeks;
  let phase = "Preparation";
  if (delta === 0) phase = "Race";
  else if (delta < 0 && delta >= -2) phase = "Transition";
  else if (delta > 0 && delta <= 2) phase = "Peak";
  else if (delta <= 2 + recoveryCycle) phase = "Build 2";
  else if (delta <= 2 + recoveryCycle * 2) phase = "Build 1";
  else if (delta <= 2 + recoveryCycle * 3) phase = "Base 3";
  else if (delta <= 2 + recoveryCycle * 4) phase = "Base 2";
  else if (delta <= 2 + recoveryCycle * 5) phase = "Base 1";
  return { phase, phaseWeek: null, recovery: false };
}

const phaseFactor = {
  "Not Set": 0,
  Preparation: 0.72,
  "Base 1": 0.82,
  "Base 2": 0.92,
  "Base 3": 1,
  "Build 1": 1.06,
  "Build 2": 1.12,
  Peak: 0.82,
  Race: 0.48,
  Transition: 0.42,
};

function weekTarget(index, total, phase, recovery, settings, currentFitness) {
  if (settings.mode === "manual") return { targetHours: null, targetTss: null };
  if (settings.methodology !== "target_ctl" && !(settings.baseline > 0))
    return { targetHours: null, targetTss: null };
  const progression = 0.88 + 0.22 * (index / Math.max(1, total - 1));
  const factor = (phaseFactor[phase] ?? 0.75) * progression * (recovery ? 0.72 : 1);
  if (settings.methodology === "hours")
    return { targetHours: Math.round(settings.baseline * factor * 4) / 4, targetTss: null };
  if (settings.methodology === "tss")
    return { targetHours: null, targetTss: Math.round(settings.baseline * factor) };
  const race = aRaceDistance(shift(settings.startDate, index * 7), settings.events);
  const startCtl = finite(currentFitness) ?? 0;
  const targetCtl = race?.event.targetCtl ?? startCtl;
  const progress = clamp(index / Math.max(1, total - 1), 0, 1);
  const ctlPath = startCtl + (targetCtl - startCtl) * progress;
  return { targetHours: null, targetTss: Math.round(Math.max(0, ctlPath * 7 * factor)) };
}

function availabilityHours(availability = {}) {
  const values = Object.values(availability)
    .map(finite)
    .filter((value) => value != null && value >= 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / 60 : null;
}

function projections(weeks, currentFitness, currentFatigue) {
  let ctl = finite(currentFitness);
  let atl = finite(currentFatigue);
  return weeks.map((week) => {
    if (week.targetTss == null || ctl == null || atl == null)
      return {
        ...week,
        projectedCtl: null,
        projectedAtl: null,
        projectedTsb: null,
        rampRate: null,
      };
    const previousCtl = ctl;
    const daily = week.targetTss / 6;
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const load = dayIndex === 6 ? 0 : daily;
      ctl += (load - ctl) * (1 - Math.exp(-1 / 42));
      atl += (load - atl) * (1 - Math.exp(-1 / 7));
    }
    return {
      ...week,
      projectedCtl: Math.round(ctl * 10) / 10,
      projectedAtl: Math.round(atl * 10) / 10,
      projectedTsb: Math.round((ctl - atl) * 10) / 10,
      rampRate: Math.round((ctl - previousCtl) * 10) / 10,
    };
  });
}

export function generateAnnualPlan(input = {}, athlete = {}) {
  const settings = validateSettings(input);
  if (
    settings.mode === "automatic" &&
    settings.methodology === "target_ctl" &&
    finite(athlete.fitness) == null
  )
    throw new Error(
      "Current CTL is unavailable. Sync athlete fitness or choose hours/TSS planning."
    );
  const total = seasonWeekCount(settings.startDate, settings.endDate);
  const availableHours = availabilityHours(settings.availability);
  let weeks = Array.from({ length: total }, (_, index) => {
    const startDate = shift(settings.startDate, index * 7);
    const endDate = shift(startDate, 6);
    const phase =
      settings.mode === "manual"
        ? { phase: "Not Set", phaseWeek: null, recovery: false }
        : phaseForWeek(index, startDate, settings);
    const event = nearestEvent(settings.events, startDate);
    const weeksToEvent = event
      ? Math.max(0, Math.floor((date(monday(event.date)) - date(startDate)) / (7 * DAY)))
      : null;
    return {
      id: `${startDate}`,
      startDate,
      endDate,
      ...phase,
      targetHours: null,
      completedHours: null,
      targetTss: null,
      weeksToEvent,
      countdownEventId: event?.id || null,
      locked: false,
      manual: false,
      notes: "",
      focus: "",
      limiters: "",
      restrictions: "",
      recoveryStatus: "",
      allocation: { swim: 0, bike: 0, run: 0, strength: 0 },
    };
  });
  let previousPhase = null,
    phaseWeek = 0;
  weeks = weeks.map((week, index) => {
    if (week.phase !== previousPhase) {
      previousPhase = week.phase;
      phaseWeek = 1;
    } else phaseWeek++;
    const numbered = !["Not Set", "Race"].includes(week.phase);
    const recovery =
      ["Base 1", "Base 2", "Base 3", "Build 1", "Build 2"].includes(week.phase) &&
      phaseWeek === settings.recoveryCycle;
    return {
      ...week,
      phaseWeek: numbered ? phaseWeek : null,
      recovery,
      ...weekTarget(index, total, week.phase, recovery, settings, athlete.fitness),
    };
  });
  weeks = projections(weeks, athlete.fitness, athlete.fatigue);
  const conflicts = [];
  if (availableHours != null)
    for (const week of weeks)
      if (week.targetHours != null && week.targetHours > availableHours + 0.01) {
        conflicts.push({
          weekId: week.id,
          message: `${week.targetHours.toFixed(1)} h exceeds the recorded ${availableHours.toFixed(1)} h weekly availability.`,
        });
      }
  const aEvents = settings.events
    .filter((event) => event.priority === "A")
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < aEvents.length; index++) {
    const gap = Math.round((date(aEvents[index].date) - date(aEvents[index - 1].date)) / DAY);
    if (gap < 21)
      conflicts.push({
        weekId: monday(aEvents[index].date),
        message: `A races “${aEvents[index - 1].name}” and “${aEvents[index].name}” are only ${gap} days apart; a full peak and transition cannot fit between them.`,
      });
  }
  const now = new Date().toISOString();
  return {
    id: String(settings.id || randomUUID()),
    name: String(settings.name || `Season ${settings.startDate.slice(0, 4)}`),
    startDate: settings.startDate,
    endDate: settings.endDate,
    mode: settings.mode,
    methodology: settings.methodology,
    recoveryCycle: settings.recoveryCycle,
    baseline: settings.baseline,
    background: String(settings.background || ""),
    currentFitness: String(settings.currentFitness || ""),
    availability: settings.availability || {},
    events: settings.events,
    weeks,
    conflicts,
    assumptions: [
      "Weeks run Monday through Sunday in the athlete’s local calendar.",
      settings.methodology === "hours"
        ? "Hours targets are phase multipliers applied to the entered average weekly hours."
        : "TSS projections distribute weekly load across six equal-load days and one zero-load day for modeling only.",
      "A races drive Peak and Race blocks; B and C events are shown but do not receive an automatic full peak.",
      "Phase generation is a transparent application rule, not a reproduction of TrainingPeaks’ unpublished algorithm.",
    ],
    source: SEASON_SOURCE,
    createdAt: settings.createdAt || now,
    updatedAt: now,
    revision: Number(settings.revision || 0),
    revisionHistory: settings.revisionHistory || [],
    isDraft: Boolean(settings.isDraft),
  };
}

export function mergeRegeneratedPlan(existing, generated, selectedWeekIds = null) {
  const selected = selectedWeekIds?.length ? new Set(selectedWeekIds) : null;
  const old = new Map((existing?.weeks || []).map((week) => [week.id, week]));
  return {
    ...generated,
    id: existing.id,
    createdAt: existing.createdAt,
    revision: existing.revision,
    revisionHistory: existing.revisionHistory,
    weeks: generated.weeks.map((week) => {
      const prior = old.get(week.id);
      if (!prior) return week;
      if ((selected && !selected.has(week.id)) || prior.locked || prior.manual) return prior;
      return {
        ...week,
        notes: prior.notes,
        focus: prior.focus,
        limiters: prior.limiters,
        restrictions: prior.restrictions,
        recoveryStatus: prior.recoveryStatus,
        allocation: prior.allocation,
      };
    }),
  };
}

export function recordPlanRevision(plan, reason = "Saved changes") {
  const now = new Date().toISOString();
  const snapshot = {
    revision: Number(plan.revision || 0),
    savedAt: plan.updatedAt || now,
    reason,
    weeks: (plan.weeks || []).map(
      ({
        id,
        phase,
        phaseWeek,
        recovery,
        targetHours,
        completedHours,
        targetTss,
        locked,
        manual,
        notes,
      }) => ({
        id,
        phase,
        phaseWeek,
        recovery,
        targetHours,
        completedHours,
        targetTss,
        locked,
        manual,
        notes,
      })
    ),
    events: plan.events || [],
  };
  return {
    ...plan,
    revision: Number(plan.revision || 0) + 1,
    updatedAt: now,
    revisionHistory: [snapshot, ...(plan.revisionHistory || [])].slice(0, 25),
  };
}

export function duplicateAnnualPlan(plan) {
  const now = new Date().toISOString();
  return {
    ...structuredClone(plan),
    id: randomUUID(),
    name: `${plan.name} copy`,
    isDraft: true,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    revisionHistory: [],
  };
}
