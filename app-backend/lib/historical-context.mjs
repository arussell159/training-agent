// Preserve the previous provider's archive without treating it as a writable calendar.
export function mergeHistoricalContext(context, archive, today) {
  if (!archive || archive.source !== "trainingpeaks") return context;
  const current = [...(context.history || []), ...(context.planned || [])];
  const signature = (w) =>
    `${w.workout_date}|${String(w.sport).toLowerCase()}|${String(w.title).trim().toLowerCase()}`;
  const seen = new Set(current.map(signature));
  const ids = new Set();
  const historical = [...(archive.history || []), ...(archive.planned || [])]
    .filter((w) => w.workout_date && w.workout_date <= today)
    .filter((w) => {
      if (ids.has(String(w.id)) || seen.has(signature(w))) return false;
      ids.add(String(w.id));
      return true;
    })
    .map((w) => ({
      ...w,
      id: `tp-history:${w.id}`,
      source: "trainingpeaks-archive",
      read_only: true,
    }));
  const history = [...(context.history || []), ...historical].sort((a, b) =>
    a.workout_date.localeCompare(b.workout_date)
  );
  const wellness = new Map();
  for (const row of [...(archive.wellness_history || []), ...(context.wellness_history || [])]) {
    const date = String(row.date || row.timeStamp || row.id || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const defined = Object.fromEntries(Object.entries(row).filter(([, value]) => value != null));
    wellness.set(date, { ...wellness.get(date), ...defined, date });
  }
  return {
    ...context,
    history,
    workouts: history,
    wellness_history: [...wellness.values()].sort((a, b) => a.date.localeCompare(b.date)),
    historical_source: "trainingpeaks-archive",
    source: context.source === "not-connected" ? "trainingpeaks-archive" : context.source,
  };
}
