import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

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
      if (saved && saved.revision === revision && Object.hasOwn(saved,'data')) return saved.encoding === 'gzip-json-v1' ? JSON.parse(gunzipSync(Buffer.from(saved.data,'base64')).toString('utf8')) : saved.data;
      const data = await download();
      if (store.ready) {
        const json=JSON.stringify(data);
        await write(id,kind,json.length>65536 ? {revision,encoding:'gzip-json-v1',data:gzipSync(json).toString('base64'),saved_at:new Date().toISOString()} : {revision,data,saved_at:new Date().toISOString()});
      }
      return data;
    },
  };
}

export function mergeTrainingSnapshot(previous, incoming, range) {
  if (!previous) return incoming;
  // A normal full sync covers a rolling provider window, not the whole archive.
  range ||= incoming.cached_ranges?.[0];
  if (!range) return incoming;
  const merge = (oldRows=[],newRows=[]) => [...new Map([
    ...oldRows.filter(w=>w.workout_date < range.start || w.workout_date > range.end),
    ...newRows,
  ].map(w=>[String(w.id),w])).values()].sort((a,b)=>a.workout_date.localeCompare(b.workout_date));
  const wellness = new Map([...(previous.wellness_history || []),...(incoming.wellness_history || [])].map(w=>[w.date,w]));
  const performance=new Map([...(previous.performance || []),...(incoming.performance || [])].map(w=>[w.workoutDay,w]));
  return {...previous,...incoming,cached_ranges:[...new Map([...(previous.cached_ranges || []),...(incoming.cached_ranges || [])].map(r=>[`${r.start}:${r.end}`,r])).values()],history:merge(previous.history,incoming.history),planned:merge(previous.planned,incoming.planned),wellness_history:[...wellness.values()].sort((a,b)=>a.date.localeCompare(b.date)),performance:[...performance.values()].sort((a,b)=>a.workoutDay.localeCompare(b.workoutDay))};
}

export function snapshotCoversRange(snapshot, range) {
  if (!range) return true;
  return (snapshot.cached_ranges || []).some(saved=>saved.start<=range.start && saved.end>=range.end);
}
