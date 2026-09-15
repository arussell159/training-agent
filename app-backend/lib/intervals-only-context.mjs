// One-time cleanup boundary, not a rolling "today" filter: newly completed
// workouts must not disappear later just because they have no FIT recording.
const FIT_CLEANUP_BEFORE='2026-09-15';

export function intervalsOnlyContext(context){
  const keep=w=>{
    const id=String(w.id || '');
    // Legacy cached standalone activities retain file metadata in raw. A planned
    // event needs metadata from its paired recording, never from its own payload.
    const fileType=w.activity_file_type ?? (id.startsWith('activity:') ? w.raw?.file_type : null);
    if (!/^(activity|event):/.test(id) || w.read_only || w.source==='trainingpeaks-archive') return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(w.workout_date || '')) && w.workout_date>=FIT_CLEANUP_BEFORE) return true;
    return Boolean(w.activity_id || id.startsWith('activity:')) && String(fileType || '').toLowerCase()==='fit';
  };
  return {...context,history:(context.history || []).filter(keep),planned:(context.planned || []).filter(keep),workouts:(context.workouts || context.history || []).filter(keep)};
}
