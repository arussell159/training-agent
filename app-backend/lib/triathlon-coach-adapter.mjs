import fs from 'node:fs/promises';

export const TRANSPORT_INSTRUCTIONS = `Runtime adapter: this deployment runs in the application's API chat, with TrainingPeaks replacing Intervals.icu. The preceding upstream instructions are the coaching policy. Platform-specific ChatGPT sign-in controls, subscriptions, builder privacy settings, absence of a backend/database, Intervals.icu OAuth scopes, rate limits and Cloudflare do not describe this deployment. Do not repeat those claims. Authentication is managed by this application's existing TrainingPeaks connection; never request credentials in chat. Tools use upstream operation names and return TrainingPeaks source fields with units. Do not treat TrainingPeaks fields as Intervals.icu fields or apply threshold_pace m/s conversion unless explicitly labelled m/s. Missing or unsupported fields are unavailable, not zero or fabricated data. There are no legacy coaching policies or fixed eight-day restrictions. Public upstream knowledge/manifest.csv is empty; no private GPT knowledge was imported. The tool schema defines actual capabilities. Writes require the upstream preview and explicit confirmation rules; unavailable writes cannot be claimed as applied.`;

export async function triathlonCoachTools() {
  const schema = JSON.parse(await fs.readFile(new URL('../vendor/open-triathlon-coach/action/intervals-oauth-action.json',import.meta.url),'utf8'));
  return Object.values(schema.paths).flatMap(path => Object.values(path)).filter(operation => operation.operationId).map(operation => ({
    type:'function',name:operation.operationId,description:`TrainingPeaks adapter: ${operation.summary}. Source fields and unavailable capabilities are reported explicitly.`,strict:false,
    parameters:{type:'object',properties:{...Object.fromEntries((operation.parameters || []).map(parameter => [parameter.name,parameter.schema])),...(operation.requestBody ? {body:operation.requestBody.content['application/json'].schema} : {})},required:[...(operation.parameters || []).filter(parameter => parameter.required).map(parameter => parameter.name),...(operation.requestBody?.required ? ['body'] : [])],additionalProperties:false},
  }));
}

export function createTrainingPeaksCoachAdapter(context, detailReader, rangeReader) {
  const sessions = [...new Map([...(context.history || context.workouts || []),...(context.planned || [])].map(workout => [String(workout.id),workout])).values()];
  const inRange = (items,args) => items.filter(item => {
    const date = String(item.workout_date || item.workoutDay || item.timeStamp || item.date || '').slice(0,10);
    return (!args.oldest || date >= args.oldest) && (!args.newest || date <= args.newest);
  });
  const wrap = data => ({source:'trainingpeaks',synced_at:context.synced_at,sync_error:context.sync_error || null,units:{duration_minutes:'minutes',totalTime:'decimal hours',totalTimePlanned:'decimal hours',power_watts:'watts',heart_rate:'bpm',distance:'source units; consult source distance unit',pace_seconds_per_unit:'seconds per source distance unit'},data});
  return async (name,args = {}) => {
    if (rangeReader && ['listActivities','listEvents','listWellness','getWellnessForDate'].includes(name) && ((args.oldest && args.newest) || args.date)) return wrap(await rangeReader(name,args));
    if (name === 'getAthlete' || name === 'getAthleteProfile') {
      const {phase,days_to_race,...athlete} = context.athlete || {};
      return wrap({...athlete,recorded_comments:context.comments || [],settings_provenance:'Existing application athlete profile; not newly inferred or independently verified TrainingPeaks thresholds.'});
    }
    if (name === 'listSportSettings' || name === 'getSportSettings') return wrap({zones:context.athlete?.zones || null,thresholds:context.athlete?.thresholds || null,requested_sport:args.id || null,note:'Recorded athlete settings only; no inferred thresholds.'});
    if (name === 'listActivities') return wrap(inRange(sessions.filter(workout => workout.status === 'completed' || workout.completed === true || Number(workout.completed_data?.duration_minutes) > 0),args).slice(-Math.min(Number(args.limit) || 100,500)));
    if (name === 'listEvents') return wrap(inRange(sessions,args));
    if (name === 'listWellness' || name === 'getWellnessForDate') {
      const range = name === 'getWellnessForDate' ? {oldest:args.date,newest:args.date} : args;
      return wrap({dated_measurements:inRange(context.wellness_history || [],range),performance:inRange(context.performance || [],range),session_recovery:inRange(sessions,range).filter(workout => workout.recovery).map(workout => ({date:workout.workout_date,...workout.recovery})),latest:context.wellness,latest_load:context.metrics,note:'Latest values are not necessarily measurements for the requested date. CTL/ATL are modelled load, not subjective fatigue.'});
    }
    if (name === 'listWorkouts') return wrap({workouts:context.library || [],note:'Locally saved workout library; not verified TrainingPeaks library discovery.'});
    if (name === 'createEvent') {
      const body = args.body || {};
      const sport = {Ride:2,VirtualRide:2,Run:3,VirtualRun:3,Swim:1}[body.type];
      if (body.category !== 'WORKOUT' || !sport) return {unavailable:'Only planned swim/bike/run workouts can be mapped; the event category or sport has no verified equivalent.'};
      return {status:'preview_only',requires_confirmation:true,not_applied:true,trainingpeaks_payload:{title:body.name,workoutDay:body.start_date_local,workoutTypeValueId:sport,description:body.description || '',totalTimePlanned:body.moving_time == null ? null : body.moving_time / 3600,tssPlanned:body.load_target ?? null},note:'Duration converted from seconds to decimal hours. Intervals.icu workout text is preserved as description, not claimed to be a TrainingPeaks structured workout. Chat write execution is not enabled.'};
    }
    if (name === 'listFolders') return wrap({folders:[],unavailable:'TrainingPeaks library folder discovery is not available through the connected integration.'});
    if (['getActivity','getActivityIntervals','getEvent'].includes(name)) {
      const id = String(args.id || args.eventId || '');
      const workout = sessions.find(item => String(item.id) === id);
      if (!workout && !detailReader) return {error:'Workout not found in the connected athlete snapshot'};
      const detail = detailReader ? await detailReader(id) : workout;
      if (name === 'getActivityIntervals') return wrap({structure:detail.structure || null,note:'Planned structure is not recorded interval telemetry.',source_workout:detail});
      return wrap(detail);
    }
    return {source:'trainingpeaks',unavailable:`${name} has no verified equivalent in the current TrainingPeaks integration. No data was invented and no change was applied.`};
  };
}
