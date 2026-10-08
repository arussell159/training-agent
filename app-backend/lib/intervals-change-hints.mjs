import { validDate } from "./intervals.mjs";
const isDate = (value) => {
  try {
    return Boolean(validDate(value));
  } catch {
    return false;
  }
};

// Store only enough information to locate affected days. Webhook values are
// never authoritative: fetching the API prevents out-of-order resurrection.
export function changeHint(event) {
  const activity = event?.activity;
  if (!/^ACTIVITY_(UPLOADED|ANALYZED|UPDATED|DELETED|ACHIEVEMENTS)$/.test(event?.type || ""))
    return { full: true };
  const id = String(activity?.id || event.activity_id || "");
  const date = String(activity?.start_date_local || "").slice(0, 10);
  return { id, ...(isDate(date) ? { date } : {}) };
}

export function changedTrainingRange(saved, hints) {
  if (!saved || !hints?.length || hints.some((h) => h.full)) return null;
  const workouts = [...(saved.history || []), ...(saved.planned || [])];
  const dates = [];
  for (const hint of hints) {
    const previous = workouts.find((w) => String(w.activity_id) === hint.id)?.workout_date;
    const known = [hint.date, previous].filter(isDate);
    if (!known.length) return null;
    dates.push(...known);
  }
  dates.sort();
  const shift = (date, n) =>
    new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return { start: shift(dates[0], -1), end: shift(dates.at(-1), 1) };
}
