// Shared canonical revision input. Hashing is performed by node:crypto on the
// server and Web Crypto in the browser; the protected fields are identical.
export function workoutRevisionInput(event) {
  const fields = ["id","updated","name","description","type","category","start_date_local","end_date_local","calendar_id","uid","external_id","paired_activity_id","workout_doc","read_only","readonly","editable","color","tags","description_locale","hide_from_athlete","custom_metadata","indoor","commute","moving_time","distance","time_target","distance_target","load_target","icu_training_load","icu_intensity","joules","athlete_cannot_edit"];
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
  return JSON.stringify(stable(Object.fromEntries(fields.map(key => [key,event[key] ?? null]))));
}
