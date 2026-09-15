export const DEFINITION_MARKER='\n\nIntervals.icu device definition:\n';
export async function updateWorkoutDescription(request,id,description){
 if(typeof description!=='string' || description.length>30000)throw Error('Description must be text under 30,000 characters');
 const match=String(id).match(/^(event|activity):(i?\d+)$/);if(!match || match[1]==='event'&&!/^\d+$/.test(match[2]))throw Error('Invalid Intervals.icu workout');
 const path=match[1]==='event'?`/athlete/0/events/${match[2]}`:`/activity/${match[2]}`;
 const existing=await request(path);let suffix='';
 if(match[1]==='event'){
  const original=String(existing.description || ''),index=original.indexOf(DEFINITION_MARKER);
  if(index>=0)suffix=original.slice(index);
  else if(existing.workout_doc?.steps?.length)suffix=DEFINITION_MARKER+original;
 }
 const providerText=description+suffix;
 await request(path,{method:'PUT',body:JSON.stringify({description:providerText})});
 const verified=await request(path);
 if(verified.description!==providerText)throw Error('Intervals.icu did not confirm the description. Refresh before retrying.');
 if(existing.workout_doc?.steps?.length && !verified.workout_doc?.steps?.length)throw Error('Description saved but the workout structure needs verification. Refresh before making another change.');
 return {id,description,verified:true};
}
