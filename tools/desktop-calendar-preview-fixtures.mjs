// A disposable provider double for browser verification. No credentials, disk
// persistence, Supabase access, or live Intervals/Garmin connection.
import { createHash } from "node:crypto";
import { recordPreviewProviderWrite } from './desktop-provider-write-ledger.mjs';
import { validDate as validPreviewDate } from "./desktop-preview-fixtures.mjs";
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
  createIntervalsRaceEvent,
} from "../app-backend/lib/intervals.mjs";
import { publicSettings } from "../app-backend/lib/settings-store.mjs";
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
import { createProviderWorkoutMetadata, providerWorkoutDescription } from "../app-backend/lib/provider-workout-metadata.mjs";
import {createCalendarWellnessService,projectCalendarWellness} from "../app-backend/lib/calendar-wellness.mjs";
import {createCalendarAnnotationsService} from "../app-backend/lib/calendar-annotations.mjs";
import {createCalendarEntryTransferService} from "../app-backend/lib/calendar-entry-transfer.mjs";
import {createStrengthExerciseLibrary,strengthLibraryAccount} from "../app-backend/lib/strength-exercise-library.mjs";
import {annotationOverlapsRange} from "../app-backend/lib/calendar-annotations-model.mjs";
import {createRaceEventDetailsService} from "../app-backend/lib/race-event-details.mjs";
import {raceEventKey} from "../app-backend/lib/race-event-details-model.mjs";
import {generateWorkoutDraft} from "../app-backend/lib/workout-generator.mjs";
import {createWorkoutTemplateService,workoutTemplateAccount} from "../app-backend/lib/workout-template.mjs";
import { serializeWorkout } from "../app-backend/lib/workout-editor-model.mjs";
import { withPlannedValues } from "../app-backend/lib/planned-workout-values.mjs";
import { newStrengthExercise, newStrengthBlock, addStrengthParameter, setStrengthValue } from "../app-backend/lib/workout-strength-model.mjs";
import { downloadActivityBundle } from "../app-backend/lib/activity-bundle.mjs";

export function createDesktopCalendarPreview(fixture, {loseCreateResponseOnce = false, loseCopyResponseOnce = false, rejectMoveOnce = false, staleWorkoutClaims = false,loseLibraryScheduleResponseOnce=false,loseCoachScheduleResponseOnce=false,loseMetricsResponseOnce=false,loseAnnotationResponseOnce=false} = {}) {
  const previewConfig = { INTERVALS_API_KEY: "synthetic-only", CALENDAR_SUMMARY_OPEN: "true" };
  let trainingPreferences = {};
  let nextProviderFailure = null;
  const events = new Map(),
    activities = new Map();
  const editorRecords = new Map(), appRecords = new Map(), providerWrites = [];
  const wellnessRecords=new Map((fixture.context().wellness_history || []).map(row=>[row.date || row.id,{...structuredClone(row),id:row.date || row.id}]));
  const wellnessMetadata=new Map();
  const annotationMetadata=new Map();
  const annotationRecord=(key,initial)=>({read:async()=>structuredClone(annotationMetadata.get(key) || initial()),update:async change=>{const row=structuredClone(annotationMetadata.get(key) || initial()),result=change(row);annotationMetadata.set(key,row);return result;}});
  let annotationResponseLost=false;
  let metricsResponseLost=false;
  const metadata = createProviderWorkoutMetadata({ record: (key, fresh) => ({
    read: async () => structuredClone(editorRecords.get(key) || fresh()),
    update: async (change) => {
      const state = structuredClone(editorRecords.get(key) || fresh()), result = change(state);
      editorRecords.set(key, state);
      return structuredClone(result);
    },
  }) });
  const appRecord = (value, kind = "events") => {
    if (!value) return value;
    const saved = appRecords.get(`${kind}:${value.id}`);
    return saved && providerWorkoutDescription(saved.description) === value.description
      ? { ...value, description: saved.description } : value;
  };
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
  const templateFolders=[{id:1,name:'My Library',type:'FOLDER',athlete_id:'synthetic',visibility:'PRIVATE',canEdit:true,read_only_workouts:false},{id:2,name:'Strength Library',type:'FOLDER',athlete_id:'synthetic',visibility:'PRIVATE',canEdit:true,read_only_workouts:false},{id:3,name:'Public Library',type:'FOLDER',athlete_id:'synthetic',visibility:'PUBLIC',canEdit:true},{id:4,name:'Foreign Library',type:'FOLDER',athlete_id:'another-synthetic',visibility:'PRIVATE',canEdit:true},{id:5,name:'Read-only Library',type:'FOLDER',athlete_id:'synthetic',visibility:'PRIVATE',canEdit:false}];
  let templateActor='A',templateReadOnly=false,templateNativeFailure=null;
  const templateRecords=new Map();
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

  // Append only: existing calendar seed IDs stay stable. These records are
  // read-only test inputs, not simulated exercise results or running streams.
  let strengthExercise = addStrengthParameter(newStrengthExercise("Fixture Air Squat"), "weight", "lb");
  for (const parameter of strengthExercise.parameters)
    strengthExercise = setStrengthValue(strengthExercise, strengthExercise.sets[0].id, parameter.id, parameter.kind === "reps" ? 8 : 50);
  const strengthId = nextId++, strengthActivityId = `i${strengthId}`,
    strengthModel = {version:1,name:"Completed Strength — paired prescription",sport:"WeightTraining",date:fixture.today,notes:"Prescribed session only; completed exercise results are unavailable.",poolLength:"",steps:[],strength:{version:1,subtype:"Yoga",blocks:[newStrengthBlock("single",strengthExercise)]}},
    strengthDescription = withPlannedValues(serializeWorkout(strengthModel), {duration_seconds:1200,tss:20,intensity_factor:0.55}),
    strengthNativeDescription = providerWorkoutDescription(strengthDescription),
    strengthEvent = {id:strengthId,category:"WORKOUT",type:"WeightTraining",name:strengthModel.name,start_date_local:`${fixture.today}T00:00:00`,description:strengthNativeDescription,moving_time:1200,time_target:1200,icu_training_load:20,icu_intensity:55,paired_activity_id:strengthActivityId},
    strengthActivity = {id:strengthActivityId,type:"WeightTraining",name:strengthModel.name,start_date_local:`${fixture.today}T09:00:00`,description:"Recorded session, with no recorded set results.",moving_time:1500,icu_training_load:31,icu_intensity:72,paired_event_id:strengthId,device_name:"Synthetic Strength Recorder"},
    providerStrengthId = `i${nextId++}`;
  events.set(strengthId,strengthEvent);
  activities.set(strengthActivityId,strengthActivity);
  activities.set(providerStrengthId,{id:providerStrengthId,type:"WeightTraining",name:"Completed Strength — provider only",start_date_local:`${fixture.today}T11:00:00`,description:"Provider-only session with no exercise prescription.",moving_time:900,icu_training_load:0,icu_intensity:0,device_name:"Synthetic Strength Recorder"});
  // Seed the same private sidecar layout that the existing metadata adapter
  // reads. The raw provider record above contains human-readable text only.
  const seedHash = text => createHash("sha256").update(text).digest("hex"),
    strengthDigest=seedHash(strengthDescription),strengthVisible=seedHash(strengthNativeDescription);
  editorRecords.set(`text:${strengthDigest}`,{text:strengthDescription});
  editorRecords.set("index",{entries:{[seedHash(`events:${strengthId}`)]:{[strengthVisible]:strengthDigest}}});
  appRecords.set(`events:${strengthId}`,{...strengthEvent,description:strengthDescription});
  const completedStrengthIds=new Set([strengthActivityId,providerStrengthId]);

  const lookup = (id) => {
    const planned = /^event:\d+$/.test(id) ? events.get(Number(id.slice(6))) : null;
    if (planned) return mapIntervalsWorkout(appRecord(planned), fixture.today, appRecord(activities.get(planned.paired_activity_id), "activity"));
    const activity = activities.get(id) || activities.get(String(id).replace(/^activity:/, ""));
    const event = activity && events.get(activity.paired_event_id);
    return activity ? { ...(event ? mapIntervalsWorkout(appRecord(event), fixture.today, appRecord(activity, "activity")) : mapIntervalsWorkout(appRecord(activity, "activity"),fixture.today,null,true)), activity_revision: fixture.version } : fixture.lookup(id);
  };
  const analysis = (id) => fixture.analysisForWorkout(lookup(id));

  const providerRequest = async (path, options = {}) => {
    recordPreviewProviderWrite(providerWrites,path,options);
    // Current native Event.category enum from https://intervals.icu/api/v1/docs.
    // SharedEvent's separate RACE category must not pass this Event transport.
    if(options.body && /^\/athlete\/0\/events(?:\/[1-9]\d*)?$/.test(path) && ["POST","PUT"].includes(options.method)) {
      const category=JSON.parse(options.body).category;
      if(category!==undefined && !["WORKOUT","RACE_A","RACE_B","RACE_C","NOTE","PLAN","HOLIDAY","SICK","INJURED","SET_EFTP","FITNESS_DAYS","SEASON_START","TARGET","SET_FITNESS"].includes(category))throw Object.assign(Error("Unsupported native Event.category"),{status:422});
    }
    if(nextProviderFailure && nextProviderFailure.method===options.method && /^\/athlete\/0\/events(?:\/[1-9]\d*)?$/.test(path)) {
      const failure=nextProviderFailure;nextProviderFailure=null;
      throw Object.assign(Error('The synthetic provider rejected this write before changing the event.'),{status:failure.status,code:'SYNTHETIC_PROVIDER_REJECTED'});
    }
    const url = new URL(path, "http://fake-provider.invalid");
    if (url.pathname === "/athlete/0") return { id: "synthetic", sportSettings: fixture.context().athlete.sport_settings };
    if(url.pathname==='/athlete/0/folders' && !options.method)return structuredClone(templateFolders);
    if(url.pathname==='/athlete/0/workouts') {
      if(!options.method)return structuredClone([...savedLibrary.values()]);
      if(options.method!=='POST')throw Object.assign(Error('Unsupported synthetic template mutation.'),{status:405});
      if(templateNativeFailure==='before'){templateNativeFailure=null;throw Object.assign(Error('Synthetic provider denied the template before commit.'),{status:403});}
      const body=JSON.parse(options.body),folder=templateFolders.find(row=>row.id===body.folder_id);
      if(!folder || folder.athlete_id!=='synthetic' || folder.visibility!=='PRIVATE' || folder.canEdit!==true || folder.read_only_workouts===true)throw Object.assign(Error('Synthetic native folder is not writable.'),{status:403});
      const saved={...body,id:nextId++,workout_doc:parseTestWorkout(body.description)};savedLibrary.set(saved.id,saved);revision++;
      if(templateNativeFailure==='after'){templateNativeFailure=null;throw Error('Synthetic native template reply lost after commit.');}
      return structuredClone(saved);
    }
    if(url.pathname.startsWith('/athlete/0/workouts/')) {
      if(options.method)throw Object.assign(Error('Template changes require an explicit synthetic fixture hook.'),{status:405});
      const saved=savedLibrary.get(Number(url.pathname.split('/').at(-1)));
      if(!saved)throw Object.assign(Error('Synthetic saved workout not found.'),{status:404});
      return structuredClone(saved);
    }
    if (url.pathname === "/athlete/0/events" && !options.method)
      return [...events.values()]
        .filter((event) => {
          const day = event.start_date_local.slice(0, 10);
          return day <= url.searchParams.get("newest") && (event.end_date_local ? event.end_date_local.slice(0,10)>url.searchParams.get("oldest") : day>=url.searchParams.get("oldest"));
        })
        .map((event) => structuredClone(event));
    const body = options.body ? JSON.parse(options.body) : {};
    const wellnessDate=url.pathname.match(/^\/athlete\/0\/wellness\/(\d{4}-\d{2}-\d{2})$/)?.[1];
    if(wellnessDate){
      if(options.method==="PUT"){
        wellnessRecords.set(wellnessDate,{...(wellnessRecords.get(wellnessDate) || {id:wellnessDate}),...body,id:wellnessDate,updated:new Date().toISOString()});revision++;
      }
      const row=wellnessRecords.get(wellnessDate);
      if(!row)throw Object.assign(Error("Synthetic wellness record not found."),{status:404});
      return structuredClone(row);
    }
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
    const isolatedActivity=activityId && fixture.nativeActivity?.(activityId);
    if(isolatedActivity){
      if(options.method && options.method!=='GET')throw Object.assign(Error('This isolated synthetic recording is read-only.'),{status:403});
      return isolatedActivity;
    }
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
      const parsedWorkout = body.description != null && event.category === "WORKOUT" && !completedStrengthIds.has(event.paired_activity_id)
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
  const metadataRequest = metadata.wrap(providerRequest);
  const request = async (path, options) => {
    const result = await metadataRequest(path, options);
    const kind = path.startsWith("/activity/") ? "activity" : path.includes("/workouts") ? "workouts" : "events";
    for (const value of Array.isArray(result) ? result : [result])
      if (value?.id != null && typeof value.description === "string") appRecords.set(`${kind}:${value.id}`, value);
    return result;
  };
  const wellnessService=createCalendarWellnessService({request,record:(key,initial)=>({
    read:async()=>structuredClone(wellnessMetadata.get(key) || initial()),
    update:async change=>{const row=structuredClone(wellnessMetadata.get(key) || initial()),result=change(row);wellnessMetadata.set(key,row);return result;},
  })});
  const annotationService=createCalendarAnnotationsService({request,record:annotationRecord});
  const raceDetailsRecords=new Map();
  const raceDetailsRecord=(key,initial)=>({
    read:async()=>structuredClone(raceDetailsRecords.get(key) ?? initial()),
    update:async change=>{const row=structuredClone(raceDetailsRecords.get(key) ?? initial()),result=change(row);raceDetailsRecords.set(key,row);return result;},
  });
  const raceDetailsService=createRaceEventDetailsService({request,record:raceDetailsRecord});
  const transferRecords=new Map();
  const transferRecord=(key,initial)=>({
    read:async()=>structuredClone(transferRecords.get(key) ?? initial()),
    update:async change=>{const row=structuredClone(transferRecords.get(key) ?? initial()),result=change(row);transferRecords.set(key,row);return result;},
  });
  const strengthCatalogs=new Map();
  const templateService=(actor={id:`synthetic-template-actor-${templateActor}`,origin:'http://localhost',readOnly:templateReadOnly})=>createWorkoutTemplateService({request,accountScope:workoutTemplateAccount({...previewConfig,SETTINGS_SCOPE:'synthetic-desktop'},actor),readOnly:actor.readOnly,record:(key,initial)=>({read:async()=>structuredClone(templateRecords.get(key) ?? initial()),update:async change=>{const state=structuredClone(templateRecords.get(key) ?? initial()),result=change(state);templateRecords.set(key,state);return structuredClone(result);}})});
  let strengthActor='A',strengthReadOnly=false,strengthFailure=null;
  const strengthLibrary=()=>{
    const accountScope=strengthLibraryAccount({SETTINGS_SCOPE:'synthetic-desktop'},{id:`synthetic-strength-actor-${strengthActor}`,origin:'http://localhost',readOnly:strengthReadOnly});
    return createStrengthExerciseLibrary({accountScope,readOnly:strengthReadOnly,record:initial=>({
      read:async()=>structuredClone(strengthCatalogs.get(accountScope) ?? initial()),
      update:async change=>{
        if(strengthFailure==='before'){strengthFailure=null;throw Object.assign(Error('The synthetic catalog rejected this write before saving.'),{status:400,code:'STRENGTH_LIBRARY_REJECTED'});}
        const state=structuredClone(strengthCatalogs.get(accountScope) ?? initial()),result=change(state);strengthCatalogs.set(accountScope,state);
        if(strengthFailure==='after'){strengthFailure=null;throw Error('Synthetic catalog confirmation was lost after commit.');}
        return result;
      },
    })});
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
      ({ ...mapIntervalsWorkout(appRecord(event), fixture.today, appRecord(activities.get(event.paired_activity_id), "activity") || null), activity_revision: fixture.version })
    );
    const recordings = [...activities.values()].filter(activity=>!events.has(activity.paired_event_id)).map(activity=>mapIntervalsWorkout(appRecord(activity, "activity"),fixture.today,null,true));
    const sessions = [...samples, ...local, ...recordings].filter(
      (item) => !start || (item.calendar_annotation_key?annotationOverlapsRange(item,start,end):item.workout_date >= start && item.workout_date <= end)
    );
    return {
      ...base,
      training_preferences: structuredClone(trainingPreferences),
      version: `synthetic-calendar-${fixture.version}-${revision}`,
      history: sessions.filter((item) => item.workout_date <= fixture.today),
      planned: sessions.filter((item) => item.calendar_annotation_key?annotationOverlapsRange(item,fixture.today,end || '9999-12-31'):item.workout_date >= fixture.today),
      wellness_history:[...new Map([...(base.wellness_history || []),...wellnessRecords.values()].map(row=>[row.date || row.id,{...row,date:row.date || row.id}])).values()].filter(row=>!start || (row.date>=start && row.date<=end)).sort((a,b)=>a.date.localeCompare(b.date)),
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
    (/^workouts\/(generate|editor|event(?::|%3A)\d+(?:\/(editor|copy|move|planned-values|recurrence))?)$/.test(api) ||
      (/^calendar\/entry-transfer\/event(?::|%3A)[1-9]\d*$/.test(api) && method === "POST") ||
      (api === "preview/provider-permissions" && method === "POST") ||
      (api === "preview/provider-failure" && method === "POST") ||
      (api === "preview/strength-library-state" && method === "POST") ||
      (api === "preview/workout-template-state" && method === "POST") ||
      (/^workouts\/event(?::|%3A)[1-9]\d*\/save-template$/.test(api) && method === "POST") ||
      (/^strength-exercises(?:\/exercise(?::|%3A)[A-Za-z0-9_-]{16,80})?$/.test(api) && (api==='strength-exercises'?method==='POST':['PUT','DELETE'].includes(method))) ||
      /^calendar\/(?:notes|annotations)(?:\/event(?::|%3A)\d+)?$/.test(api) ||
      ["calendar/day-actions", "calendar/workout-description", "comments", "workouts/pair", "workout-files/upload", "workout-files/export"].includes(api) || (["race-events","calendar/metrics","training-preferences"].includes(api) && method === "POST") || (/^race-events\/(event(?::|%3A)[1-9]\d*)$/.test(api) && method === "PUT") || /^workout-library\/(library(?::|%3A)[1-9]\d*)\/schedule$/.test(api) || /^coach\/calendar\/[a-f0-9-]{36}\/(confirm|decline)$/.test(api));
  const handle = async (api, method, input, url) => {
    const strengthView=api.match(/^activities\/(i\d+)\/(summary|analysis|route)$/);
    if(method==="GET" && strengthView && completedStrengthIds.has(strengthView[1])){
      const bundle=await downloadActivityBundle(async path=>path.includes("/streams")?[]:providerRequest(path),strengthView[1],async()=>null);
      return strengthView[2]==="route"?{points:bundle.route}:bundle[strengthView[2]];
    }
    if(api==='preview/workout-template-state' && method==='POST') {
      const allowed=['actor','readOnly','nativeFailure','folder','template','deleteTemplateId','corruptTemplateId'];
      if(!input || !Object.keys(input).length || Object.keys(input).some(key=>!allowed.includes(key)) || (input.actor!==undefined && !['A','B'].includes(input.actor)) || (input.readOnly!==undefined && typeof input.readOnly!=='boolean') || (input.nativeFailure!==undefined && ![null,'before','after'].includes(input.nativeFailure)))throw Object.assign(Error('Choose valid synthetic template state.'),{status:400});
      if(input.actor!==undefined)templateActor=input.actor;
      if(input.readOnly!==undefined)templateReadOnly=input.readOnly;
      if(input.nativeFailure!==undefined)templateNativeFailure=input.nativeFailure;
      if(input.folder!==undefined){const patch=input.folder;if(!patch || Object.keys(patch).some(key=>!['id','name','visibility','canEdit','owner'].includes(key)) || !Number.isInteger(patch.id) || (patch.name!==undefined && (typeof patch.name!=='string' || !patch.name.trim() || patch.name.length>1000)) || (patch.visibility!==undefined && !['PRIVATE','PUBLIC'].includes(patch.visibility)) || (patch.canEdit!==undefined && typeof patch.canEdit!=='boolean') || (patch.owner!==undefined && !['self','other'].includes(patch.owner)))throw Object.assign(Error('Choose a valid synthetic folder change.'),{status:400});const row=templateFolders.find(row=>row.id===patch.id);if(!row)throw Object.assign(Error('Synthetic folder not found.'),{status:404});for(const key of ['name','visibility','canEdit'])if(Object.hasOwn(patch,key))row[key]=patch[key];if(patch.owner!==undefined)row.athlete_id=patch.owner==='self'?'synthetic':'another-synthetic';}
      const ownTemplate=id=>{if(!/^library:[1-9]\d*$/.test(id || ''))throw Object.assign(Error('Choose a synthetic template identity.'),{status:400});const row=savedLibrary.get(Number(id.slice(8)));if(!row?.tags?.some(tag=>/^training-agent-template-[a-f0-9]{64}$/.test(tag)))throw Object.assign(Error('Only a newly created synthetic template can change.'),{status:403});return row;};
      if(input.template!==undefined){const patch=input.template;if(!patch || Object.keys(patch).some(key=>!['id','name','description'].includes(key)) || (patch.name!==undefined && (typeof patch.name!=='string' || !patch.name.trim() || patch.name.length>128)) || (patch.description!==undefined && (typeof patch.description!=='string' || patch.description.length>30000)))throw Object.assign(Error('Choose a valid synthetic template change.'),{status:400});const row=ownTemplate(patch.id);for(const key of ['name','description'])if(Object.hasOwn(patch,key))row[key]=patch[key];}
      if(input.corruptTemplateId!==undefined){const row=ownTemplate(input.corruptTemplateId),key=row.tags.find(tag=>tag.startsWith('training-agent-template-')).slice('training-agent-template-'.length);for(const entry of templateRecords.keys())if(entry.endsWith('/'+key))templateRecords.set(entry,{version:1,operation:{corrupt:true}});}
      if(input.deleteTemplateId!==undefined){const row=ownTemplate(input.deleteTemplateId);savedLibrary.delete(row.id);}
      return {...await templateService().listFolders(),actor:templateActor,nativeFailureArmed:templateNativeFailure!==null};
    }
    if(api==='workout-library/folders' && method==='GET'){if(url && [...url.searchParams].length)throw Object.assign(Error('Choose valid template parameters.'),{status:400,code:'TEMPLATE_INVALID'});return templateService().listFolders();}
    const templateSave=api.match(/^workouts\/(event(?::|%3A)[1-9]\d*)\/save-template$/i);
    if(templateSave){if(method!=='POST')throw Object.assign(Error('Use template POST.'),{status:405});if(url && [...url.searchParams].length)throw Object.assign(Error('Choose valid template parameters.'),{status:400,code:'TEMPLATE_INVALID'});return templateService().save(decodeURIComponent(templateSave[1]),input);}
    const templateInspection=api.match(/^workout-template-operations\/([0-9a-f-]{36})$/i);
    if(templateInspection && method==='GET'){if([...url.searchParams.keys()].some(key=>key!=='accountScope') || url.searchParams.getAll('accountScope').length!==1)throw Object.assign(Error('Choose valid template inspection parameters.'),{status:400,code:'TEMPLATE_INVALID'});return templateService().inspect(templateInspection[1],url.searchParams.get('accountScope'));}
    if(api==='preview/strength-library-state' && method==='POST') {
      if(!input || !Object.keys(input).length || Object.keys(input).some(key=>!['actor','readOnly','failNextWrite'].includes(key)) || (input.actor!==undefined && !['A','B'].includes(input.actor)) || (input.readOnly!==undefined && typeof input.readOnly!=='boolean') || (input.failNextWrite!==undefined && ![null,'before','after'].includes(input.failNextWrite)))throw Object.assign(Error('Choose valid synthetic exercise library state.'),{status:400});
      if(input.actor!==undefined)strengthActor=input.actor;
      if(input.readOnly!==undefined)strengthReadOnly=input.readOnly;
      if(input.failNextWrite!==undefined)strengthFailure=input.failNextWrite;
      return {accountScope:(await strengthLibrary().list()).accountScope,readOnly:strengthReadOnly,actor:strengthActor,failureArmed:strengthFailure!==null};
    }
    const strengthRoute=/^strength-exercises(?:\/(exercise(?::|%3A)[A-Za-z0-9_-]{16,80})(\/history)?)?$/.exec(api);
    if(strengthRoute) {
      const service=strengthLibrary(),id=strengthRoute[1]?decodeURIComponent(strengthRoute[1]):null;
      if(strengthRoute[2]){if(method!=='GET')throw Object.assign(Error('History is read-only.'),{status:405});return service.history(id,context());}
      if(method==='GET') {
        if([...(url?.searchParams.keys() || [])].some(key=>!['query','muscleGroup','owner'].includes(key)))throw Object.assign(Error('Choose a supported library filter.'),{status:400,code:'STRENGTH_LIBRARY_INVALID'});
        return id?service.load(id):service.list(Object.fromEntries(url?.searchParams || []));
      }
      if(method==='POST'&&!id)return service.create(input);
      if(method==='PUT'&&id)return service.update(id,input);
      if(method==='DELETE'&&id)return service.delete(id,input);
      throw Object.assign(Error('Unsupported exercise library method.'),{status:405});
    }
    if(api === 'preview/provider-failure' && method === 'POST') {
      if(!input || Object.keys(input).some(key=>!['method','status'].includes(key)) || !['POST','PUT'].includes(input.method) || ![400,403].includes(input.status))throw Object.assign(Error('Choose a definite synthetic provider rejection.'),{status:400});
      nextProviderFailure={method:input.method,status:input.status};
      return {...nextProviderFailure,armed:true};
    }
    if(api === 'preview/provider-permissions' && method === 'POST') {
      if(!input || Object.keys(input).some(key=>!['id','readOnly'].includes(key)) || !/^event:[1-9]\d*$/.test(input.id || '') || typeof input.readOnly !== 'boolean')throw Object.assign(Error('Choose a synthetic event permission.'),{status:400});
      const event=events.get(Number(input.id.slice(6)));
      if(!event)throw Object.assign(Error('Synthetic event not found.'),{status:404});
      event.read_only=input.readOnly;revision++;
      return {id:input.id,readOnly:event.read_only};
    }
    if (api === "training-preferences" && ["GET", "POST"].includes(method)) {
      if (method === "POST") {
        const preferences = input?.training_preferences;
        if (!preferences || typeof preferences !== "object" || Array.isArray(preferences) || !Object.keys(preferences).length || Object.keys(preferences).some(key => !/^desktopDashboard(?::[^\u0000-\u001f]{1,256})?$/.test(key))) throw Object.assign(Error("Synthetic preview permits scoped dashboard preferences only."), {status:400});
        const next = structuredClone(trainingPreferences);
        delete next.updated_at;
        for (const [key, value] of Object.entries(preferences)) {
          if (value === null) delete next[key];
          else if (typeof value !== "object" || Array.isArray(value)) throw Object.assign(Error("A dashboard preferences object is required."), {status:400});
          else next[key] = structuredClone(value);
        }
        if (Object.keys(next).length > 64 || JSON.stringify(next).length > 256000) throw Object.assign(Error("Synthetic dashboard preferences are too large."), {status:413});
        trainingPreferences = Object.keys(next).length ? { ...next, updated_at: new Date().toISOString() } : {};
      }
      return {training_preferences: structuredClone(trainingPreferences)};
    }
    const transferRoute=/^calendar\/entry-transfer\/(event(?::|%3A)[1-9]\d*)$/.exec(api);
    if(transferRoute && method==='POST') {
      const id=decodeURIComponent(transferRoute[1]);
      const apply=claimed=>createCalendarEntryTransferService({annotations:createCalendarAnnotationsService({request:claimed,record:annotationRecord}),events:createRaceEventDetailsService({request:claimed,record:raceDetailsRecord}),record:transferRecord}).transfer(id,input);
      const saved=input?.action==='move'?await withDirectWorkoutWrite({},id,apply,{queue,request,recoverPending:true}):await apply(request);
      const {event,providerEvent,...result}=saved;
      if(input.kind==='event') {
        result.event=event;
        const decorated=await raceDetailsService.hydrateContext({history:[mapIntervalsWorkout(providerEvent,fixture.today)],planned:[]});
        result.workout=decorated.history[0];
      }
      return {...result,context:context()};
    }
    const annotationRoute=/^calendar\/annotations(?:\/(event(?::|%3A)[1-9]\d*))?$/.exec(api);
    if(annotationRoute){
      const id=annotationRoute[1]?decodeURIComponent(annotationRoute[1]):null;
      if(method==='GET')return id?annotationService.load(id):annotationService.list(url.searchParams.get('start'),url.searchParams.get('end'));
      const apply=claimed=>{const service=createCalendarAnnotationsService({request:claimed,record:annotationRecord});return method==='DELETE'?service.delete(id,input):id?service.update(id,input):service.create(input);};
      const saved=id?await withDirectWorkoutWrite({},id,apply,{queue,request,recoverPending:true}):await apply(request);
      const {event,...result}=saved;
      if(loseAnnotationResponseOnce&&!annotationResponseLost){annotationResponseLost=true;throw Object.assign(Error('The calendar annotation reply was lost. Recheck the same draft.'),{status:502,code:'ANNOTATION_UNCONFIRMED'});}
      return {...result,context:context()};
    }
    if(api==="calendar/metrics") {
      if(method==="GET")return wellnessService.load(url.searchParams.get("date"));
      if(method!=="POST")return undefined;
      const {providerRecord,...row}=await wellnessService.save(input);
      const savedContext=projectCalendarWellness(context(),row.date,providerRecord,row);
      if(loseMetricsResponseOnce&&!metricsResponseLost){metricsResponseLost=true;throw Object.assign(Error("The metrics reply was lost. Retry this same saved draft."),{status:502,code:"METRICS_WRITE_UNCONFIRMED"});}
      return {...row,context:savedContext};
    }
    if(["training-context","training-updates"].includes(api)&&method==="GET") {
      const scope=url.searchParams.get("scope"),start=url.searchParams.get("start"),end=url.searchParams.get("end");
      if(scope==="range"&&(!validPreviewDate(start)||!validPreviewDate(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>370)) throw Object.assign(Error("Invalid preview date range"),{status:400});
      const saved=await wellnessService.hydrateContext(scope==="range"?context(start,end,"range"):context(),scope==="range"?{start,end}:undefined);
      return api==="training-updates"?{unchanged:false,version:context().version,context:saved}:saved;
    }
    if (api === "config" && ["GET", "POST"].includes(method)) {
      if (method === "POST") {
        const keys = Object.keys(input || {});
        if (!keys.length || keys.some(key => !["CALENDAR_SUMMARY_OPEN", "METRICS_LAYOUT"].includes(key)))
          throw Object.assign(Error("Only disposable calendar summary and metrics-layout preferences are supported."), {status:400});
        if (keys.some(key => typeof input[key] !== "string" || !input[key].trim()))
          throw Object.assign(Error("Settings values must be non-empty text."), {status:400});
        if (keys.includes("CALENDAR_SUMMARY_OPEN") && !["true", "false"].includes(input.CALENDAR_SUMMARY_OPEN))
          throw Object.assign(Error("Invalid calendar summary preference."), {status:400});
        if (keys.includes("METRICS_LAYOUT")) {
          let layout;
          try {layout=JSON.parse(input.METRICS_LAYOUT);} catch {throw Object.assign(Error("Invalid metrics layout."),{status:400});}
          if (!layout || !Array.isArray(layout.graphs) || layout.graphs.length !== 3 || !layout.graphs.every(value=>typeof value==="string") || !Array.isArray(layout.cards) || !layout.cards.every(value=>typeof value==="string"))
            throw Object.assign(Error("Invalid metrics layout."),{status:400});
        }
        Object.assign(previewConfig, input);
      }
      return {...publicSettings(previewConfig),localPreview:true,readOnly:false};
    }
    if (api === "race-events" && method === "POST") {
      if(Object.hasOwn(input,"eventType")) {
        const result=await raceDetailsService.create(input);
        return {event:result.event,verified:true,context:await raceDetailsService.hydrateContext(context()),plan:null};
      }
      const name=String(input.name || "").trim(),date=input.date,priority=String(input.priority || "").toUpperCase();
      const externalId=`training-agent-settings-race:${createHash("sha256").update(`${priority}|${date}|${name}`).digest("hex").slice(0,24)}`;
      const saved=await createIntervalsRaceEvent(request,{name,date,priority,externalId});
      return {event:{id:String(saved.id),name:saved.name,date,priority},context:context(),plan:null};
    }
    const raceDetailsMatch=api.match(/^race-events\/(event(?::|%3A)[1-9]\d*)$/);
    if(raceDetailsMatch && method==="GET")return {event:await raceDetailsService.load(decodeURIComponent(raceDetailsMatch[1]))};
    if(raceDetailsMatch && method==="PUT") {
      const result=await raceDetailsService.update(decodeURIComponent(raceDetailsMatch[1]),input);
      return {event:result.event,verified:true,context:await raceDetailsService.hydrateContext(context()),plan:null};
    }
    if (api === "race-events" && method === "GET") {
      const indexed=await raceDetailsService.hydrateContext({history:[...events.values()].map(event=>({id:`event:${event.id}`,category:event.category})),planned:[]});
      const appEventIds=new Set(indexed.history.filter(event=>event.calendar_event_key).map(event=>event.id));
      const created=[...events.values()].filter(event=>/^RACE(?:_[ABC])?$/.test(event.category) || raceEventKey(event.external_id) || appEventIds.has(`event:${event.id}`)).map(event=>({id:String(event.id),name:event.name,date:event.start_date_local.slice(0,10),priority:event.category.match(/^RACE_([ABC])$/)?.[1] || ""}));
      return {events:[...new Map([...(fixture.events || []),...created].map(event=>[event.id,event])).values()].sort((a,b)=>a.date.localeCompare(b.date))};
    }
    if (api === "preview/provider-records" && method === "GET")
      return { events: structuredClone([...events.values()]), activities: structuredClone([...activities.values()]), wellnessRecords:structuredClone([...wellnessRecords.values()]), libraryWorkouts:structuredClone([...savedLibrary.values()]), writes: structuredClone(providerWrites) };
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
    if(api==="workout-library" && method==="GET")return templateService().listTemplates();
    const library=api.match(/^workout-library\/(library(?::|%3A)[1-9]\d*)\/schedule$/);
    if(library){
      const result=project(await scheduleLibraryWorkout({},templateService().wrapLibraryReads(request),decodeURIComponent(library[1]),input,{record:copyRecord(input.creationId)}));
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
    if (api === "workouts/generate" && method === "POST") {
      // Disposable mock Responses transport, real generation validation/model path.
      // This fixture never contacts OpenAI or mutates the synthetic provider.
      const step=(label,role,amount,low,high)=>{const rpe={warmup:[1,3],active:[7,8],recovery:[2,3],cooldown:[1,2]}[role];return {label,role,amount,low:input.intensity==="RPE"?rpe[0]:low,high:input.intensity==="RPE"?(high===null?null:rpe[1]):high,notes:"",effort:""};};
      const range=input.target==="range",amounts=input.length==="duration"?[300,120,60]:[1000,400,200];
      return generateWorkoutDraft({openaiKey:"synthetic-only",model:"synthetic-generator"},input,{fetchImpl:async()=>Response.json({status:"completed",output:[{type:"message",role:"assistant",content:[{type:"output_text",text:JSON.stringify({name:"Synthetic generated workout",instructions:"Editable synthetic workout draft.",segments:[{repetitions:1,steps:[step("Warm up","warmup",amounts[0],55,range?65:null)]},{repetitions:3,steps:[step("Work","active",amounts[1],95,range?105:null),step("Recovery","recovery",amounts[2],45,range?55:null)]},{repetitions:1,steps:[step("Cool down","cooldown",amounts[0],45,range?55:null)]}]})}]}]})});
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
        ? loadCalendarNote(request, id,{assertNotAppEvent:raceDetailsService.assertNotAppEvent})
        : project(await saveCalendarNote(request, id, input,{assertNotAppEvent:raceDetailsService.assertNotAppEvent}));
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
      const indexed=await raceDetailsService.hydrateContext({history:found.map(event=>({id:`event:${event.id}`,category:event.category})),planned:[]});
      const protectedEvents=new Set(indexed.history.filter(event=>event.calendar_event_key).map(event=>event.id));
      const editable = found.filter(event=>['WORKOUT','NOTE'].includes(event.category) && !raceEventKey(event.external_id) && !protectedEvents.has(`event:${event.id}`) && !event.paired_activity_id && !event.read_only && !event.readonly && event.editable !== false && !event.athlete_cannot_edit);
      for (const event of editable)
        results.push(await changeIntervalsEvent(request, `event:${event.id}`, input.action));
      return { results, failures: [], total: editable.length, context: context() };
    }
    return undefined;
  };
  return {
    canWrite,
    handle:async(...args)=>{
      const result=await handle(...args);
      if(result?.context)return {...result,context:await raceDetailsService.hydrateContext(await annotationService.hydrateContext(result.context))};
      if(result?.history&&result?.planned)return raceDetailsService.hydrateContext(await annotationService.hydrateContext(result));
      return result;
    },
    context,
    lookup,
    analysis,
    templateService,
    request,
    get version() {
      return `synthetic-calendar-${fixture.version}-${revision}`;
    },
  };
}
