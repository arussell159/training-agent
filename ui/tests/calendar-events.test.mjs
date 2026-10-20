import test from "node:test"
import assert from "node:assert/strict"
import { calendarAddTypes, notesFirst } from "../src/lib/calendar-events.ts"
import { canEditWorkout } from "../src/lib/workout-permissions.ts"
import { calendarDiscipline, prepareCalendarPaste, projectCalendarMove, rollbackCalendarMove, rollbackCalendarDeletion, applyVerifiedCalendarPair, readCalendarClipboard, writeCalendarClipboard, removeVerifiedCalendarPlans } from "../src/lib/calendar-interactions.ts"
import { calendarProfilePath } from "../src/lib/calendar-profile.ts"
import { builderBlock } from "../src/lib/desktop-workout-builder.ts"
import { projectOptimisticWorkout, rollbackOptimisticWorkout, clearOptimisticWorkout } from "../src/lib/optimistic-workout.ts"
import { desktopCalendarRecordedTotal, sameDesktopCalendarSport } from "../src/lib/desktop-calendar-summary.ts"

test("desktop week totals use recorded seconds before rounded fields and exclude planned-only prescriptions", () => {
  const workouts = [
    { status: "completed", actualDurationMinutes: 27, workout_summary: { planned: { duration_seconds: 3600, distance_meters: 9000 }, completed: { duration_seconds: 1609, distance_meters: 4345 } } },
    { status: "completed", actualDurationMinutes: 10, workout_summary: { planned: null, completed: { duration_seconds: 604, distance_meters: 0 } } },
    { status: "completed", actualDurationMinutes: 47, workout_summary: { planned: null, completed: { duration_seconds: 2816 } } },
    { status: "upcoming", workout_summary: { planned: { duration_seconds: 7200, distance_meters: 20000 }, completed: null } },
  ]
  assert.deepEqual(desktopCalendarRecordedTotal(workouts,"duration_seconds"),{value:5029,known:3,expected:3})
  assert.deepEqual(desktopCalendarRecordedTotal(workouts,"distance_meters"),{value:4345,known:2,expected:3})
  assert.deepEqual(desktopCalendarRecordedTotal(workouts,"work_kj"),{value:null,known:0,expected:3})
})

test("desktop recorded summaries keep empty weeks, explicit zero, missing values and legacy actuals distinct", () => {
  assert.deepEqual(desktopCalendarRecordedTotal([],"duration_seconds"),{value:0,known:0,expected:0})
  assert.deepEqual(desktopCalendarRecordedTotal([{status:"completed",actualDurationMinutes:90,workout_summary:{planned:{duration_seconds:5400},completed:{duration_seconds:null}}}],"duration_seconds"),{value:null,known:0,expected:1})
  assert.deepEqual(desktopCalendarRecordedTotal([{status:"completed",workout_summary:{planned:null,completed:{elevation_gain:0,work_kj:0}}}],"work_kj"),{value:0,known:1,expected:1})
  assert.deepEqual(desktopCalendarRecordedTotal([{status:"completed",actualDurationMinutes:1.5},{status:"completed",completed_data:{duration_minutes:0}}],"duration_seconds"),{value:90,known:2,expected:2})
  assert.equal(desktopCalendarRecordedTotal([{status:"completed",workout_summary:{planned:null,completed:{distance_meters:NaN}}}],"distance_meters").value,null)
})

test("desktop pairing accepts provider sport aliases without combining different Other disciplines", () => {
  for(const [first,second] of [["Ride","Bike"],["VirtualRide","Bike"],["TrailRun","Run"],["WeightTraining","Strength"]]) assert.equal(sameDesktopCalendarSport(first,second),true)
  for(const [first,second] of [["Run","Bike"],["Walk","Rowing"],["Yoga","Other"]]) assert.equal(sameDesktopCalendarSport(first,second),false)
})

test("edit controls require a provider event and preserve recorded activity protections", () => {
  assert.equal(canEditWorkout({ id: "event:123", status: "upcoming" }), true)
  for (const id of ["event:0", "event:-1", "event:preview-2026", "event:", "activity:123"]) {
    assert.equal(canEditWorkout({ id, status: "upcoming" }), false)
  }
  assert.equal(canEditWorkout({ id: "event:123", status: "completed", activity_id: "i456" }), false)
  assert.equal(canEditWorkout({ id: "event:123", status: "upcoming", activity_id: "i456" }), false)
})

test("desktop add choices map exactly to supported provider types", () => {
  assert.deepEqual(
    calendarAddTypes.map((type) => type.label),
    ["Swim", "Bike", "Run", "Sauna", "Strength", "Note"]
  )
  assert.equal(
    calendarAddTypes.find((type) => type.label === "Sauna").sport,
    "Other"
  )
  assert.equal(
    calendarAddTypes.find((type) => type.label === "Strength").sport,
    "WeightTraining"
  )
})
test("notes always precede the day's events while retaining workout and note order", () => {
  const events = [
    { id: 1, category: "WORKOUT" },
    { id: 2, category: "NOTE" },
    { id: 3, category: "RACE_A" },
    { id: 4, category: "NOTE" },
  ]
  assert.deepEqual(
    notesFirst(events).map((event) => event.id),
    [2, 4, 1, 3]
  )
  assert.equal(events[0].id, 1)
})

test("a failed move rolls back only its scheduling fields and retains intervening changes", () => {
  const original = {id:"event:1",title:"Run",sport:"Run",workout_date:"2026-10-17",day:"SAT",date:"Oct 17",status:"upcoming"};
  const before={planned:[original,{id:"event:2",title:"Bike",workout_date:"2026-10-18"}],history:[]};
  const optimistic=projectCalendarMove(before,"event:1","2026-10-20","2026-10-16");
  optimistic.planned[0].title="New title from another update";
  optimistic.planned[1].title="Unrelated change";
  optimistic.history.push({id:"activity:i3",status:"completed",workout_date:"2026-10-16"});
  const restored=rollbackCalendarMove(optimistic,before,"event:1","2026-10-20");
  assert.equal(restored.planned[0].workout_date,"2026-10-17");
  assert.equal(restored.planned[0].title,"New title from another update");
  assert.equal(restored.planned[1].title,"Unrelated change");
  assert.deepEqual(restored.history,optimistic.history);
  assert.equal(before.planned[0].workout_date,"2026-10-17");
});

test("failed move rollback cannot relocate a newly paired recording or overwrite a newer move", () => {
  const before={planned:[{id:"event:1",workout_date:"2026-10-17",status:"upcoming"}],history:[]};
  for (const updated of [
    {id:"event:1",workout_date:"2026-10-20",status:"completed",activity_id:"i3"},
    {id:"event:1",workout_date:"2026-10-21",status:"upcoming"},
  ]) {
    const current={planned:[updated],history:[]};
    assert.deepEqual(rollbackCalendarMove(current,before,"event:1","2026-10-20"),current);
  }
});

test("clipboard recovery retains immutable paste identities and partial progress per account", () => {
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const clipboard={kind:"day",mode:"copy",workoutIds:["event:1","event:2"],label:"Oct 17",attempt:{date:"2026-10-20",items:[{id:"event:1",creationId:"00000000-0000-4000-8000-000000000001"},{id:"event:2",creationId:"00000000-0000-4000-8000-000000000002"}],completed:1}};
  writeCalendarClipboard("a",clipboard,storage);
  assert.deepEqual(readCalendarClipboard("a",storage),clipboard);
  assert.equal(readCalendarClipboard("b",storage),null);
  const restored=readCalendarClipboard("a",storage);
  assert.deepEqual(restored.attempt.items.slice(restored.attempt.completed).map(item=>item.id),["event:2"]);
  writeCalendarClipboard("b",{...clipboard,mode:"cut"},storage);
  writeCalendarClipboard("a",null,storage);
  assert.equal(readCalendarClipboard("a",storage),null);
  assert.equal(readCalendarClipboard("b",storage).mode,"cut");
});

test("damaged clipboard data cannot replay invalid dates, duplicate sources or mismatched identities", () => {
  const base={kind:"workout",mode:"copy",workoutIds:["event:1"],label:"Run"};
  for (const value of [null,{}, {...base,workoutIds:["activity:i1"]},{...base,workoutIds:["event:1","event:1"]},{...base,attempt:{date:"2026-02-30",items:[],completed:0}},{...base,attempt:{date:"2026-10-20",items:[{id:"event:2",creationId:"00000000-0000-4000-8000-000000000001"}],completed:0}}]) {
    assert.equal(readCalendarClipboard("a",{getItem:()=>JSON.stringify(value)}),null);
  }
  assert.equal(readCalendarClipboard("a",{getItem:()=>"bad json"}),null);
  assert.throws(()=>writeCalendarClipboard("a",base,{setItem:()=>{throw Error("Storage full")}}),/Storage full/);
});

test("calendar summary consistently groups native and display sport names", () => {
  for (const name of ["Ride","VirtualRide","Bike","Mountain Bike","Gravel Cycling"]) assert.equal(calendarDiscipline(name),"bike");
  for (const name of ["Run","TrailRun","Virtual Run"]) assert.equal(calendarDiscipline(name),"run");
  for (const name of ["WeightTraining","Strength"]) assert.equal(calendarDiscipline(name),"strength");
  assert.equal(calendarDiscipline("Swim"),"swim");
  assert.equal(calendarDiscipline("Other"),"other");
});

test("lightweight calendar silhouettes retain relative durations, ramps and flush boundaries", () => {
  const model={version:1,name:"Profile",sport:"Ride",date:"2026-10-16",notes:"",poolLength:"",steps:[],thresholds:{ftp:250}};
  const ramp=builderBlock("Active",model,"%ftp","single")[0];
  ramp.target={kind:"power",unit:"%ftp",mode:"ramp",start:70,end:100};
  model.steps=[...builderBlock("Warm up",model,"%ftp","single"),ramp];
  const path=calendarProfilePath({editor_model:model});
  assert.ok(path.startsWith("M0,20L0.000,20"));
  assert.ok(path.endsWith("L1000,20Z"));
  assert.match(path,/L666\.667,/);
  assert.ok(!/NaN|Infinity/.test(path));
  assert.equal(calendarProfilePath({structure:"broken"}),null);
});

test("week copy and shift preserve relative dates across month and daylight-saving boundaries", () => {
  const source={kind:"week",mode:"copy",sourceStart:"2026-10-26",workoutDates:["2026-10-27","2026-11-01"],workoutIds:["event:1","event:2"],label:"Week of Oct 26"};
  const attempt=prepareCalendarPaste(source,"2026-11-02",()=>"00000000-0000-4000-8000-000000000001");
  assert.deepEqual(attempt.items.map(item=>item.date),["2026-11-03","2026-11-08"]);
  assert.equal(attempt.completed,0);
  assert.equal(source.workoutDates[0],"2026-10-27");
  const day=prepareCalendarPaste({...source,kind:"day"},"2026-11-02",()=>"00000000-0000-4000-8000-000000000001");
  assert.deepEqual(day.items.map(item=>item.date),["2026-11-02","2026-11-02"]);
});

test("week clipboard validation rejects dates outside its source week or altered destinations", () => {
  const source={kind:"week",mode:"cut",sourceStart:"2026-10-12",workoutDates:["2026-10-13"],workoutIds:["event:1"],label:"Week"};
  const attempt=prepareCalendarPaste(source,"2026-10-19",()=>"00000000-0000-4000-8000-000000000001");
  assert.ok(readCalendarClipboard("a",{getItem:()=>JSON.stringify({...source,attempt})}));
  assert.equal(readCalendarClipboard("a",{getItem:()=>JSON.stringify({...source,workoutDates:["2026-10-20"]})}),null);
  assert.equal(readCalendarClipboard("a",{getItem:()=>JSON.stringify({...source,attempt:{...attempt,items:[{...attempt.items[0],date:"2026-10-25"}]}})}),null);
});

test("verified deletion fallback only removes plans and preserves concurrent recordings", () => {
  const history = [
    { id: "event:1", status: "upcoming" },
    { id: "event:2", completed: true, activity_id: "i42" },
    { id: "activity:i43", status: "completed" },
    { week: "2026-10-12" },
  ];
  const context = { history, planned: [{ id: "event:3", status: "upcoming" }, { id: "event:4", activity_id: "i44" }] };
  const result = removeVerifiedCalendarPlans(context, ["event:1", "event:2", "event:3", "event:4"]);
  assert.deepEqual(result.history, history.slice(1));
  assert.deepEqual(result.planned, [context.planned[1]]);
  assert.equal(context.history.length, 4);
  assert.equal(context.planned.length, 2);
});

test("optimistic edits roll back only their fields while retaining intervening changes", () => {
  const before={athlete:{time_zone:"America/Chicago"},metrics:{},history:[],planned:[{id:"event:1",workout_date:"2099-10-17",title:"Run",status:"upcoming"},{id:"event:2",workout_date:"2099-10-18",title:"Bike"}]};
  const change={id:"event:1",operation:"move-1",patch:{workout_date:"2099-10-20"}};
  const staged=projectOptimisticWorkout(before,change);
  assert.equal(staged.planned[0].workout_date,"2099-10-20");
  assert.ok(staged.planned[0].app_pending_operation);
  staged.planned[0].title="New title";
  staged.planned[1].title="Unrelated edit";
  staged.history.push({id:"activity:i3",workout_date:"2020-10-01",status:"completed",activity_id:"i3"});
  const restored=rollbackOptimisticWorkout(staged,before,change);
  assert.equal(restored.planned[0].workout_date,"2099-10-17");
  assert.equal(restored.planned[0].title,"New title");
  assert.equal(restored.planned[1].title,"Unrelated edit");
  assert.equal(restored.history[0].activity_id,"i3");
  assert.equal(restored.planned[0].app_pending_operation,undefined);
});

test("optimistic deletion and rollback preserve a completion arriving during a write", () => {
  const plan={id:"event:1",workout_date:"2099-10-17",status:"upcoming"};
  const before={athlete:{},metrics:{},history:[],planned:[plan]};
  const change={id:plan.id,operation:"delete",remove:true};
  const deleted=projectOptimisticWorkout(before,change);
  assert.equal(deleted.planned.length,0);
  const complete={...plan,status:"completed",completed:true,activity_id:"i3",workout_date:"2020-10-01"};
  deleted.history.push(complete);
  const restored=rollbackOptimisticWorkout(deleted,before,change);
  assert.deepEqual(restored.history,[complete]);
  assert.equal(restored.planned.length,0);
  assert.equal(projectOptimisticWorkout(restored,change).history[0].activity_id,"i3");
});

test("provisional creations never become a real provider event and clear on confirmation or failure", () => {
  const before={athlete:{},metrics:{},history:[],planned:[]};
  const insert={id:"pending:creation-1",workout_date:"2099-10-17",title:"Run",status:"upcoming"};
  const change={id:insert.id,operation:"create-1",insert};
  const staged=projectOptimisticWorkout(before,change);
  assert.equal(staged.planned[0].app_pending_operation,"create-1");
  assert.equal(canEditWorkout(staged.planned[0]),false);
  staged.planned.push({...insert,id:"event:31",app_pending_operation:undefined});
  assert.deepEqual(clearOptimisticWorkout(staged,change).planned.map(row=>row.id),["event:31"]);
  assert.deepEqual(rollbackOptimisticWorkout(staged,before,change).planned.map(row=>row.id),["event:31"]);
});

test("provisional duration edits replace stale structured labels and roll them back on rejection",()=>{
  const row={id:"event:1",workout_date:"2099-10-17",status:"upcoming",duration:"27m",plannedDurationMinutes:27,planned_time_label:"0:27:00",workout_summary:{planned:{duration_seconds:1620},completed:null}};
  const before={athlete:{},metrics:{},history:[],planned:[row]};
  const change={id:row.id,operation:"totals",patch:{workout_summary:{planned:{duration_seconds:2100},completed:null}}};
  const staged=projectOptimisticWorkout(before,change);
  assert.equal(staged.planned[0].plannedDurationMinutes,35);
  assert.equal(staged.planned[0].planned_time_label,null);
  const restored=rollbackOptimisticWorkout(staged,before,change).planned[0];
  assert.equal(restored.planned_time_label,"0:27:00");
  assert.equal(restored.plannedDurationMinutes,27);
  assert.equal(restored.duration,"27m");
});

test("calendar-only historical plans delete immediately and partial failures restore only unconfirmed plans",()=>{
  const first={id:"event:1",workout_date:"2001-01-01",status:"upcoming"};
  const second={id:"event:2",workout_date:"2001-01-02",status:"upcoming"};
  const before={athlete:{},history:[first,second],planned:[]};
  const staged=removeVerifiedCalendarPlans(before,[first.id,second.id]);
  assert.equal(staged.history.length,0);
  staged.planned.push({id:"event:3",workout_date:"2099-01-01",title:"New concurrent plan"});
  const restored=rollbackCalendarDeletion(staged,before,[second.id]);
  assert.deepEqual(restored.history,[second]);
  assert.equal(restored.planned[0].title,"New concurrent plan");
  const paired={...first,status:"completed",activity_id:"i42"};
  staged.history.push(paired);
  assert.deepEqual(rollbackCalendarDeletion(staged,before,[first.id]).history,[paired]);
});

test("verified links preserve the recording date and remove only its standalone alias",()=>{
  const plan={id:"event:7",status:"upcoming",workout_date:"2001-01-01"};
  const ride={id:"activity:i42",activity_id:"i42",status:"completed",workout_date:"2001-01-02"};
  const other={id:"event:9",workout_date:"2099-01-01"};
  const context={athlete:{},history:[plan,ride],planned:[other]};
  const paired={...plan,...ride,id:plan.id};
  const result=applyVerifiedCalendarPair(context,plan.id,ride.id,paired,"2026-10-19");
  assert.deepEqual(result.history,[paired]);
  assert.deepEqual(result.planned,[other]);
  assert.throws(()=>applyVerifiedCalendarPair(context,plan.id,ride.id,{...paired,activity_id:"i99"},"2026-10-19"),/does not match/);
});
