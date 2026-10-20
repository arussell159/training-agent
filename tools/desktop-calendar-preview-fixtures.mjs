// A disposable provider double for browser verification. No credentials, disk
// persistence, Supabase access, or live Intervals/Garmin connection.
import {
  fixtureEvent,
  parseTestWorkout,
} from "../app-backend/lib/fixtures/workout-editor-fixtures.mjs";
import {
  loadWorkoutEditor,
  loadNewWorkoutEditor,
  createWorkoutEditor,
  saveWorkoutEditor,
} from "../app-backend/lib/workout-editor.mjs";
import {
  createCalendarNote,
  loadCalendarNote,
  saveCalendarNote,
} from "../app-backend/lib/calendar-notes.mjs";
import {
  changeIntervalsEvent,
  moveIntervalsEvent,
  mapIntervalsWorkout,
} from "../app-backend/lib/intervals.mjs";
import { updateWorkoutDescription } from "../app-backend/lib/workout-description.mjs";
import { copyCalendarWorkout } from "../app-backend/lib/calendar-workout-copy.mjs";
import { loadPlannedWorkoutMetrics, savePlannedWorkoutMetrics } from "../app-backend/lib/planned-workout-metrics.mjs";
import { loadProviderWorkoutComments, saveProviderWorkoutComment } from "../app-backend/lib/provider-workout-comments.mjs";
import { createMutationQueue, freshMutationQueue } from "../app-backend/lib/mutation-queue.mjs";
import { withDirectWorkoutWrite } from "../app-backend/lib/direct-workout-write.mjs";
import { pairClaimedIntervalsWorkout } from "../app-backend/lib/workout-pairing.mjs";
import {scheduleLibraryWorkout,scheduleCoachWorkouts} from "../app-backend/lib/workout-scheduling.mjs";
import {loadWorkoutRecurrence,saveWorkoutRecurrence} from "../app-backend/lib/workout-recurrence.mjs";
import { uploadWorkoutRecording, exportWorkoutFile } from "../app-backend/lib/workout-files.mjs";

export function createDesktopCalendarPreview(fixture, {loseCreateResponseOnce = false, loseCopyResponseOnce = false, rejectMoveOnce = false, staleWorkoutClaims = false,loseLibraryScheduleResponseOnce=false,loseCoachScheduleResponseOnce=false} = {}) {
  const events = new Map(),
    activities = new Map();
  let nextId = 9000,
    revision = 1;
  let comments = [];
  let creationResponseLost = false;
  let libraryScheduleResponseLost=false,coachScheduleResponseLost=false;
  let copyResponseLost = false, moveRejected = false;
  const copyRecords = new Map();
  let recurrenceState = {series:{}};
  const recurrenceStore = {
    read:async()=>structuredClone(recurrenceState),
    update:async change=>{const state=structuredClone(recurrenceState),result=change(state);recurrenceState=state;return structuredClone(result);},
  };
  const savedLibrary=new Map([[15,{...fixtureEvent("Run"),id:15,name:"Preview aerobic run",end_date_local:undefined}],[16,{...fixtureEvent("Ride"),id:16,name:"Preview endurance bike",end_date_local:undefined}]]);
  let coachProposal={id:"9fc8da63-e749-437d-8bb1-c9171c730abc",state:"ready",phase:"preview",createdAt:Date.now(),expiresAt:Date.now()+86400000,timeZone:"America/Chicago",runUrl:null,error:null,workouts:[{name:"Preview coach easy run",date:fixture.today,type:"Run",description:"- 1800s Z2 HR",duration_minutes:30,tss:22},{name:"Preview coach endurance bike",date:fixture.today,type:"Ride",description:"- 2700s 180w",duration_minutes:45,tss:38}]};
  let ledger = { ...freshMutationQueue(), imported: true };
  const store = { listSyncRecords: async () => [], getSyncRecord: async () => null, upsert: async () => {} };
  const queue = createMutationQueue({INTERVALS_API_KEY:"synthetic-only"}, store, {record:{
    read: async () => structuredClone(ledger),
    update: async change => { const next=structuredClone(ledger); const result=change(next); ledger=next; return structuredClone(result); },
  }});
  const copyRecord = (id) => ({
    read: async () => structuredClone(copyRecords.get(id) || {operation:null}),
    update: async (change) => { const state=structuredClone(copyRecords.get(id) || {operation:null}); const result=change(state); copyRecords.set(id,state); return structuredClone(result); },
  });
  const shift = (days) =>
    new Date(Date.parse(`${fixture.today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const weekday = new Date(`${fixture.today}T12:00:00Z`).getUTCDay();
  const monday = shift(-((weekday + 6) % 7)),
    sunday = new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  const weekDay = (offset) =>
    new Date(Date.parse(`${monday}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const add = (sport, date, name, actualMinutes) => {
    const event = {
      ...fixtureEvent(sport),
      id: nextId++,
      start_date_local: `${date}T00:00:00`,
      name,
      ...(sport === "Swim" ? { moving_time: 1800 } : {}),
    };
    if (actualMinutes != null) {
      const activity = {
        id: `i${event.id}`,
        type: sport,
        name,
        start_date_local: `${date}T07:00:00`,
        paired_event_id: event.id,
        moving_time: actualMinutes * 60,
        distance: sport === "Ride" ? actualMinutes * 420 : sport === "Swim" ? actualMinutes * 36 : actualMinutes * 170,
        icu_training_load: 40,
        average_heartrate: 142,
        max_heartrate: 168,
        average_cadence: sport === "Ride" ? 86 : 164,
        icu_average_watts: sport === "Ride" ? 185 : null,
        total_elevation_gain: sport === "Swim" ? 0 : 110,
        calories: actualMinutes * 9,
        file_type: "fit",
      };
      activities.set(activity.id, activity);
      event.paired_activity_id = activity.id;
    }
    events.set(event.id, event);
  };
  add("Ride", weekDay(0), "Completed bike — on target", 27);
  add("Swim", weekDay(1), "Completed swim — near target", 20);
  add("Run", fixture.today, "Completed run — short session", 5);
  add("Run", fixture.today, "Aerobic run — recorded route and laps", 52);
  add("Ride", fixture.today, "Threshold intervals — recorded power and route", 87);
  add("Ride", shift(1), "Editable bike workout", null);
  const missedRunId = `event:${nextId}`;
  add("Run", shift(-2), "Missed run — editable past workout", null);
  const missedSwimId = `event:${nextId}`;
  add("Swim", shift(-3), "Missed swim — editable past workout", null);
  if (staleWorkoutClaims) {
    const startedAt = Date.now() - 11 * 60_000;
    ledger.direct_claims[missedRunId] = {workoutId:missedRunId,token:"synthetic-abandoned",state:"unknown",startedAt,
      intent:{method:"PUT",path:`/athlete/0/events/${missedRunId.split(":")[1]}`,body:{start_date_local:`${shift(-1)}T00:00:00`}}};
    ledger.jobs.push({mutation:{operationId:"00000000-0000-4000-8000-000000000001",id:missedSwimId,type:"move",date:shift(-2)},state:"unknown",claim:null,sequence:1,created_at:new Date(startedAt).toISOString()});
  }
  add("Run", shift(1), "Editable run workout", null);
  add("Swim", shift(2), "Editable swim workout", null);
  const editableSwim = events.get(nextId - 1);
  editableSwim.description = editableSwim.description.replace("200y Z1 Pace", "200y Z1 Pace Press lap").replace("100y Z3 Pace", "100y Z3 Pace Press lap");
  editableSwim.workout_doc = parseTestWorkout(editableSwim.description);
  for (const step of [editableSwim.workout_doc.steps[0], editableSwim.workout_doc.steps[1].steps[0]]) {
    step.until_lap_press = true;
    delete step.press_lap;
  }
  add("Ride", fixture.today, "Linkable bike plan", null);
  activities.set("i9900", {id:"i9900",type:"Ride",name:"Recorded bike — ready to link",start_date_local:`${fixture.today}T08:00:00`,moving_time:2400,distance:18000,icu_training_load:35});
  events.set(nextId, {
    id: nextId++,
    category: "NOTE",
    name: "Race Week",
    description: "Notes stay above this day's workouts.",
    start_date_local: `${fixture.today}T00:00:00`,
  });

  const lookup = (id) => {
    const planned = /^event:\d+$/.test(id) ? events.get(Number(id.slice(6))) : null;
    if (planned) return mapIntervalsWorkout(planned, fixture.today, activities.get(planned.paired_activity_id));
    const activity = activities.get(id) || activities.get(String(id).replace(/^activity:/, ""));
    const event = activity && events.get(activity.paired_event_id);
    return activity ? { ...(event ? mapIntervalsWorkout(event, fixture.today, activity) : mapIntervalsWorkout(activity,fixture.today,null,true)), activity_revision: fixture.version } : fixture.lookup(id);
  };
  const analysis = (id) => fixture.analysisForWorkout(lookup(id));

  const request = async (path, options = {}) => {
    if(path.startsWith("/athlete/0/workouts/"))return structuredClone(savedLibrary.get(Number(path.split("/").at(-1))));
    const url = new URL(path, "http://fake-provider.invalid");
    if (url.pathname === "/athlete/0") return { id: "synthetic", sportSettings: fixture.context().athlete.sport_settings };
    if (url.pathname === "/athlete/0/events" && !options.method)
      return [...events.values()]
        .filter((event) => {
          const day = event.start_date_local.slice(0, 10);
          return day >= url.searchParams.get("oldest") && day <= url.searchParams.get("newest");
        })
        .map((event) => structuredClone(event));
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.pathname === "/athlete/0/events" && options.method === "POST") {
      const event = {
        ...body,
        id: nextId++,
        ...(body.category === "WORKOUT" ? { workout_doc: parseTestWorkout(body.description) } : {}),
      };
      events.set(event.id, event);
      revision++;
      return structuredClone(event);
    }
    const activityId = url.pathname.match(/^\/activity\/(i\d+)$/)?.[1];
    const id = activityId || Number(url.pathname.split("/").at(-1));
    const source = activityId ? activities : events;
    const event = source.get(id);
    if (!event) throw Object.assign(new Error("Synthetic event not found."), { status: 404 });
    if (options.method === "DELETE") {
      source.delete(id);
      revision++;
      return null;
    }
    if (options.method === "PUT") {
      const parsedWorkout = body.description != null && event.category === "WORKOUT"
        ? parseTestWorkout(body.description) : null;
      source.set(id, {
        ...event,
        ...body,
        updated: new Date().toISOString(),
        ...(parsedWorkout
          ? {
              workout_doc: parsedWorkout,
              moving_time: Object.hasOwn(body, "moving_time") ? body.moving_time : parsedWorkout.duration,
            }
          : {}),
      });
      if(activityId && body.paired_event_id && events.has(body.paired_event_id))
        events.set(body.paired_event_id,{...events.get(body.paired_event_id),paired_activity_id:activityId});
      revision++;
    }
    return structuredClone(source.get(id));
  };
  const context = (start, end, scope) => {
    const base = fixture.context(start, end, scope);
    const samples = [
      ...new Map(
        [...base.history, ...base.planned]
          .filter((item) => item.workout_date < monday || item.workout_date > sunday)
          .map((item) => [item.id, item])
      ).values(),
    ];
    const local = [...events.values()].map((event) =>
      ({ ...mapIntervalsWorkout(event, fixture.today, activities.get(event.paired_activity_id) || null), activity_revision: fixture.version })
    );
    const recordings = [...activities.values()].filter(activity=>!events.has(activity.paired_event_id)).map(activity=>mapIntervalsWorkout(activity,fixture.today,null,true));
    const sessions = [...samples, ...local, ...recordings].filter(
      (item) => !start || (item.workout_date >= start && item.workout_date <= end)
    );
    return {
      ...base,
      version: `synthetic-calendar-${fixture.version}-${revision}`,
      history: sessions.filter((item) => item.workout_date <= fixture.today),
      planned: sessions.filter((item) => item.workout_date >= fixture.today),
    };
  };
  const project = (result) => ({
    ...result,
    ...(result.event
      ? {
          workout: mapIntervalsWorkout(
            result.event,
            fixture.today,
            activities.get(result.event.paired_activity_id) || null
          ),
        }
      : {}),
    context: context(),
  });
  const canWrite = (api, method) =>
    method !== "GET" &&
    (/^workouts\/(editor|event(?::|%3A)\d+(?:\/(editor|copy|move|planned-values|recurrence))?)$/.test(api) ||
      /^calendar\/notes(?:\/event(?::|%3A)\d+)?$/.test(api) ||
      ["calendar/day-actions", "calendar/workout-description", "comments", "workouts/pair", "workout-files/upload", "workout-files/export"].includes(api) || /^workout-library\/(library(?::|%3A)[1-9]\d*)\/schedule$/.test(api) || /^coach\/calendar\/[a-f0-9-]{36}\/(confirm|decline)$/.test(api));
  const handle = async (api, method, input, url) => {
    if (api.startsWith("workout-files/") && method === "POST") {
      const fetchImpl = async (href, options = {}) => {
        const fileUrl = new URL(href);
        if (fileUrl.pathname.endsWith("/activities")) {
          const externalId = fileUrl.searchParams.get("external_id");
          let activity = [...activities.values()].find(item => item.external_id === externalId);
          if (!activity) {
            const event = events.get(Number(fileUrl.searchParams.get("paired_event_id")));
            activity = { id: `i${nextId++}`, icu_athlete_id: "synthetic", type: event?.type || "Run", name: "Uploaded preview recording",
              start_date_local: `${fixture.today}T08:00:00`, moving_time: 600, elapsed_time: 600, distance: 1609.344,
              external_id: externalId, paired_event_id: event?.id || null };
            activities.set(activity.id, activity);
            if (event) events.set(event.id, { ...event, paired_activity_id: activity.id });
            revision++;
          }
          return Response.json({ icu_athlete_id: "synthetic", activities: [{ id: activity.id }] });
        }
        if (/download(?:-workout)?\./.test(fileUrl.pathname))
          return new Response("Synthetic device export fixture", { headers: { "Content-Type": "application/octet-stream" } });
        return Response.json(await request(fileUrl.pathname.replace(/^\/api\/v1/, ""), options));
      };
      return api.endsWith("/upload")
        ? uploadWorkoutRecording({ INTERVALS_API_KEY: "synthetic" }, input, { fetchImpl, request })
        : exportWorkoutFile({ INTERVALS_API_KEY: "synthetic" }, input, { fetchImpl });
    }
    const recurrence=api.match(/^workouts\/(event(?::|%3A)\d+)\/recurrence$/);
    if(recurrence){
      const id=decodeURIComponent(recurrence[1]),options={store:recurrenceStore,copyRecordFor:copyRecord,today:fixture.today};
      if(method==="GET")return loadWorkoutRecurrence({},id,options);
      const result=await saveWorkoutRecurrence({},request,id,{...input,action:method==="DELETE"?"cancel":"schedule"},options);
      return {...result,context:context()};
    }
    if(api==="workout-library" && method==="GET")return {workouts:[...savedLibrary.values()].map(event=>({...mapIntervalsWorkout({...event,start_date_local:`${fixture.today}T00:00:00`},fixture.today),id:`library:${event.id}`,workout_date:undefined,date:"Saved workout",status:"upcoming"}))};
    const library=api.match(/^workout-library\/(library(?::|%3A)[1-9]\d*)\/schedule$/);
    if(library){
      const result=project(await scheduleLibraryWorkout({},request,decodeURIComponent(library[1]),input,{record:copyRecord(input.creationId)}));
      if(loseLibraryScheduleResponseOnce && !libraryScheduleResponseLost){libraryScheduleResponseLost=true;throw Object.assign(Error("The scheduling reply was lost. Recheck this same saved workout."),{status:502});}
      return result;
    }
    if(api==="coach/calendar" && method==="GET")return {proposals:[coachProposal]};
    if(api===`coach/calendar/${coachProposal.id}` && method==="GET")return coachProposal;
    if(api===`coach/calendar/${coachProposal.id}/decline`){coachProposal={...coachProposal,state:"declined"};return coachProposal;}
    if(api===`coach/calendar/${coachProposal.id}/confirm`){
      const result=await scheduleCoachWorkouts({},request,coachProposal,{recordFor:copyRecord});
      coachProposal={...coachProposal,transport:"direct",phase:"push",state:result.verified?"applied":"unknown",verified:result.verified,scheduledWorkouts:result.scheduledWorkouts,error:result.failures[0]?.error || null};
      if(loseCoachScheduleResponseOnce && !coachScheduleResponseLost){coachScheduleResponseLost=true;throw Object.assign(Error("The approval reply was lost. Check the same proposal's status."),{status:502});}
      return coachProposal;
    }
    if(api === "workouts/pair") {
      const result=await pairClaimedIntervalsWorkout((id,action)=>withDirectWorkoutWrite({},id,action,{queue,request,store}),input.plannedId,input.completedId);
      return {verified:true,plannedId:result.plannedId,completedId:result.completedId,workout:mapIntervalsWorkout(result.event,fixture.today,result.activity),context:context()};
    }
    if (api === "comments") {
      if (method === "GET") return loadProviderWorkoutComments(request,url.searchParams.get("workoutId"),comments);
      const result=await saveProviderWorkoutComment(request,input,comments);
      comments=[...comments.filter(item=>item.workout_id!==input.workoutId),...result.comments];
      return result;
    }
    const metrics = api.match(/^workouts\/(event(?::|%3A)\d+)\/planned-values$/);
    if (metrics) {
      const id = decodeURIComponent(metrics[1]);
      return method === "GET" ? project(await loadPlannedWorkoutMetrics(request, id)) : project(await savePlannedWorkoutMetrics(request, id, input));
    }
    if (api === "workouts/new/editor")
      return loadNewWorkoutEditor(request, url.searchParams.get("date"), {
        sport: url.searchParams.get("sport") || "Ride",
        name: url.searchParams.get("name") || "New workout",
      });
    if (api === "workouts/editor" && method === "POST") {
      const result = project(await createWorkoutEditor(request, input, "synthetic-calendar"));
      if (loseCreateResponseOnce && !creationResponseLost && !input.reconcileOnly) {
        creationResponseLost = true;
        throw Object.assign(Error("The save response was lost. Recheck this same draft to confirm it."), {status:502,code:"CREATE_UNCONFIRMED"});
      }
      return result;
    }
    const editor = api.match(/^workouts\/(event(?::|%3A)\d+)\/editor$/);
    if (editor) {
      const id = decodeURIComponent(editor[1]);
      return method === "GET"
        ? loadWorkoutEditor(request, id)
        : project(await saveWorkoutEditor(request, id, input, "synthetic-calendar"));
    }
    if (api === "calendar/notes" && method === "POST")
      return project(await createCalendarNote(request, input, "synthetic-calendar"));
    const note = api.match(/^calendar\/notes\/(event(?::|%3A)\d+)$/);
    if (note) {
      const id = decodeURIComponent(note[1]);
      return method === "GET"
        ? loadCalendarNote(request, id)
        : project(await saveCalendarNote(request, id, input));
    }
    const action = api.match(/^workouts\/(event(?::|%3A)\d+)(?:\/(copy|move))?$/);
    if (action) {
      const id = decodeURIComponent(action[1]);
      if (action[2] === "move" && rejectMoveOnce && !moveRejected) {moveRejected=true;throw Object.assign(Error("Synthetic move rejected before provider write."),{status:503});}
      const apply = claimed => action[2] === "move"
        ? moveIntervalsEvent(claimed, id, input.date)
        : changeIntervalsEvent(claimed, id, action[2] || "delete", {date:input.date});
      const result = project(action[2] === "copy"
        ? input.creationId ? await copyCalendarWorkout({},request,id,input,{record:copyRecord(input.creationId)}) : await apply(request)
        : await withDirectWorkoutWrite({},id,apply,{queue,request,store,replacePending:true}));
      if (action[2] === "copy" && loseCopyResponseOnce && !copyResponseLost) {copyResponseLost=true;throw Object.assign(Error("Synthetic paste response lost after provider verification. Resume the same paste."),{status:502});}
      return result;
    }
    if (api === "calendar/workout-description")
      return project(await updateWorkoutDescription(request, input.id, input.description, {descriptionMode:input.descriptionMode}));
    if (api === "calendar/day-actions") {
      const found = await request(`/athlete/0/events?oldest=${input.date}&newest=${input.date}`),
        results = [];
      const editable = found.filter(event=>['WORKOUT','NOTE'].includes(event.category) && !event.paired_activity_id && !event.read_only && !event.readonly && event.editable !== false && !event.athlete_cannot_edit);
      for (const event of editable)
        results.push(await changeIntervalsEvent(request, `event:${event.id}`, input.action));
      return { results, failures: [], total: editable.length, context: context() };
    }
    return undefined;
  };
  return {
    canWrite,
    handle,
    context,
    lookup,
    analysis,
    get version() {
      return `synthetic-calendar-${fixture.version}-${revision}`;
    },
  };
}
