export async function changeTrainingPeaksWorkout({workoutId, action, getSession, request}) {
  if (!/^\d+$/.test(String(workoutId)) || !['copy','delete'].includes(action)) throw new Error('Invalid workout action');
  const {token, athleteId} = await getSession();
  const collection = `/fitness/v6/athletes/${athleteId}/workouts`;
  const path = `${collection}/${workoutId}`;
  const original = await request(path, token);
  if (action === 'delete') {
    await request(path, token, {method:'DELETE'});
    try {
      await request(path, token);
    } catch (error) {
      if (error.status === 404) return {workoutId:String(workoutId), action, verified:true};
      throw error;
    }
    throw new Error('TrainingPeaks did not confirm the deletion. Refresh before trying again.');
  }
  const fields = ['title','workoutDay','workoutTypeValueId','description','coachComments','structure','startTimePlanned',
    ...Object.keys(original).filter(field => field.endsWith('Planned'))];
  const copy = Object.fromEntries([...new Set(fields)].filter(field => Object.hasOwn(original,field)).map(field => [field,original[field]]));
  const created = await request(collection, token, {method:'POST',body:JSON.stringify({...copy, athleteId:Number(athleteId), completed:false})});
  const id = created?.workoutId;
  if (!id || String(id) === String(workoutId)) throw new Error('TrainingPeaks did not return a new workout ID. Refresh before trying again.');
  const verified = await request(`${collection}/${id}`,token);
  if (verified.title !== original.title || String(verified.workoutDay).slice(0,10) !== String(original.workoutDay).slice(0,10)) throw new Error('TrainingPeaks did not confirm the copied workout. Refresh before trying again.');
  return {workoutId:String(id), action, verified:true};
}
