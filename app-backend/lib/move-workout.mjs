export async function moveTrainingPeaksWorkout({ workoutId, date, getSession, request }) {
  if (!/^\d+$/.test(String(workoutId))) throw new Error('TrainingPeaks workout ID is invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid workout date');
  const {token, athleteId} = await getSession();
  const path = `/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`;
  const existing = await request(path, token);
  const startTimePlanned = typeof existing.startTimePlanned === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(existing.startTimePlanned)
    ? date + existing.startTimePlanned.slice(10) : existing.startTimePlanned;
  await request(path, token, {method:'PUT', body:JSON.stringify({...existing, workoutDay:`${date}T00:00:00`, startTimePlanned, athleteId:Number(athleteId)})});
  const verified = await request(path, token);
  if (String(verified.workoutDay || '').slice(0, 10) !== date) throw new Error('TrainingPeaks did not confirm the new date. Refresh the calendar before trying again.');
  return {workoutId:String(workoutId), date, verified:true};
}
