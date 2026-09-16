import {createHash} from 'node:crypto';

export function providerConnection(config) {
  return createHash('sha256').update(`${config.SETTINGS_SCOPE || 'default'}:${config.INTERVALS_API_KEY || ''}`).digest('hex');
}

// Separate archive records from ready training snapshots. These records are not
// subject to the 90-day workout_context pruning policy; service-role access only.
export function createCompletedWorkoutStore(config, store) {
  const connection = providerConnection(config);
  const recordId = (id, kind) => `completed:v1:${connection}:${id}:${kind}`;
  async function write(id, kind, cursor) {
    await store.upsert('sync_state', [{athlete_id:recordId(id,kind),status:'archived',cursor,updated_at:new Date().toISOString()}]);
  }
  async function metadata(id) { return store.getSyncRecord(recordId(id,'metadata')); }
  return {
    ready:store.ready,
    async saveWorkouts(context) {
      if (!store.ready) return;
      const workouts = [...new Map([...(context.history || []),...(context.planned || [])].filter(w=>w.completed && w.activity_id).map(w=>[String(w.activity_id),w])).values()];
      const rows = workouts.map(workout => {
        const actual = workout.raw_activity || workout.completed_data || {};
        const revision = createHash('sha256').update(JSON.stringify(actual)).digest('hex');
        return {athlete_id:recordId(String(workout.activity_id),'metadata'),status:'archived',cursor:{revision,workout,activity:actual},updated_at:new Date().toISOString()};
      });
      if (rows.length) await store.upsert('sync_state', rows);
    },
    async load(id, kind, download, {force=false} = {}) {
      const meta = store.ready ? await metadata(id) : null;
      const revision = meta?.revision || '';
      const saved = store.ready && !force ? await store.getSyncRecord(recordId(id,kind)) : null;
      if (saved && saved.revision === revision && Object.hasOwn(saved,'data')) return saved.data;
      const data = await download();
      if (store.ready) await write(id,kind,{revision,data,saved_at:new Date().toISOString()});
      return data;
    },
  };
}

export function mergeTrainingSnapshot(previous, incoming, range) {
  if (!previous || !range) return incoming;
  const merge = (oldRows=[],newRows=[]) => [...new Map([
    ...oldRows.filter(w=>w.workout_date < range.start || w.workout_date > range.end),
    ...newRows,
  ].map(w=>[String(w.id),w])).values()].sort((a,b)=>a.workout_date.localeCompare(b.workout_date));
  const wellness = new Map([...(previous.wellness_history || []),...(incoming.wellness_history || [])].map(w=>[w.date,w]));
  return {...previous,...incoming,cached_ranges:[...(previous.cached_ranges || []),...(incoming.cached_ranges || [])],history:merge(previous.history,incoming.history),planned:merge(previous.planned,incoming.planned),wellness_history:[...wellness.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}

export function snapshotCoversRange(snapshot, range) {
  if (!range) return true;
  return (snapshot.cached_ranges || []).some(saved=>saved.start<=range.start && saved.end>=range.end);
}
