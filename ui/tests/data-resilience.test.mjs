// Every fetch is replaced with an in-memory fixture. No live API/database calls.
import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      return {
        url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      }
    if (
      specifier.startsWith(".") &&
      context.parentURL &&
      !/\.[a-z]+$/.test(specifier)
    ) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(url)))
        return { url: url.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = new EventTarget()
globalThis.fetch = () => {
  throw Error("Unexpected network request")
}
const { setApiAuthenticated } = await import("../src/lib/api-client.ts")
const training = await import("../src/lib/training-context.ts")
const nutrition = await import("../src/lib/nutrition.ts")
const workoutReads = await import("../src/lib/workout-read-cache.ts")
const foodReads = await import("../src/lib/nutrition-read-cache.ts")
const workspaceReads = await import("../src/lib/workspace-reads.ts")
const pageSnapshots = await import("../src/lib/page-snapshots.ts")
const { projectNutritionChange } = await import("../src/lib/nutrition-optimistic.ts")
const { askCoach } = await import("../src/lib/coach-client.ts")
const { waitForSection11Export, syncSection11Export, section11ExportPending } =
  await import("../src/lib/section11-export.ts")
const { validatedTrainingContext, validatedTrainingWorkout, validatedLibraryWorkout } =
  await import("../src/lib/training-context-validation.ts")
const {plannedDistanceLabel}=await import("../src/lib/workout-distance.ts")
const {createDesktopPreviewFixtures}=await import('../../tools/desktop-preview-fixtures.mjs')
test('isolated pace source drillthrough passes the actual strict workout response validator with recorded duration and exact source identity',()=>{
  const fixture=createDesktopPreviewFixtures(new Date('2026-10-20T12:00:00Z'))
  for(const [id,sport,distance] of [['i700000001','Run',1600],['i700000002','Swim',400]]){
    const workout=validatedTrainingWorkout(fixture.lookup(id))
    assert.equal(workout.id,`activity:${id}`)
    assert.equal(workout.activity_id,id)
    assert.equal(workout.sport,sport)
    assert.equal(workout.duration,'6m 40s')
    assert.equal(workout.completed,true)
    assert.equal(workout.duration_seconds,400)
    assert.equal(workout.workout_summary.completed.duration_seconds,400)
    assert.equal(workout.workout_summary.completed.distance_meters,distance)
    assert.equal(fixture.analysis(id).duration,400)
    const malformed={...workout};delete malformed.duration
    assert.throws(()=>validatedTrainingWorkout(malformed),/incomplete/)
  }
})
test('isolated HR source drillthrough meets the same actual strict workout response contract without inventing planned totals',()=>{
  const fixture=createDesktopPreviewFixtures(new Date('2026-10-20T12:00:00Z'))
  for(const [id,sport,seconds] of [['i710000004','Other',300],['i710000001','Run',600]]){
    const workout=validatedTrainingWorkout(fixture.lookup(id))
    assert.equal(workout.id,`activity:${id}`)
    assert.equal(workout.activity_id,id)
    assert.equal(workout.sport,sport)
    assert.equal(typeof workout.duration,'string')
    assert.equal(workout.workout_summary.planned,null)
    assert.equal(workout.workout_summary.completed.duration_seconds,seconds)
    assert.equal(fixture.analysis(id).duration,seconds)
  }
})
const flush = () => new Promise((resolve) => setImmediate(resolve))
test('cadence raw-source Summary records satisfy the actual strict workout validator and preserve native identity without planned totals',()=>{
  const fixture=createDesktopPreviewFixtures(new Date('2026-10-20T12:00:00Z'))
  for(const [id,sport,seconds] of [['i720000001','Bike',5400],['i720000002','Run',600],['i720000004','Walk',60]]){
    const workout=validatedTrainingWorkout(fixture.lookup(id))
    assert.equal(workout.id,`activity:${id}`)
    assert.equal(workout.activity_id,id)
    assert.equal(workout.sport,sport)
    assert.equal(typeof workout.duration,'string')
    assert.equal(workout.workout_summary.planned,null)
    assert.equal(workout.workout_summary.completed.duration_seconds,seconds)
    assert.equal(fixture.analysis(id).duration,seconds)
  }
})
test('duration velocity source Summary records pass the actual workout contract with recorded speed and physical distance, separate from distance pace',()=>{
  const fixture=createDesktopPreviewFixtures(new Date('2026-10-20T12:00:00Z'))
  for(const [id,sport,seconds,speed] of [['i740000001','Bike',5400,12],['i740000002','Run',600,4],['i740000003','Swim',1800,1],['i740000004','Walk',60,0]]){
    const workout=validatedTrainingWorkout(fixture.lookup(id))
    assert.equal(workout.id,`activity:${id}`)
    assert.equal(workout.activity_id,id)
    assert.equal(workout.sport,sport)
    assert.equal(workout.workout_summary.planned,null)
    assert.equal(workout.workout_summary.completed.duration_seconds,seconds)
    assert.equal(workout.workout_summary.completed.distance_meters,seconds*speed)
    const analysis=fixture.analysis(id)
    assert.equal(analysis.duration,seconds)
    assert.ok(analysis.points.every(point=>point.speed===speed))
  }
})
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  })
const workout = (id, date = "2026-10-06") => ({
  id,
  workout_date: date,
  date,
  day: "Today",
  sport: "Run",
  title: id,
  duration: "20m",
  goal: "Easy",
  status: "today",
})
const context = (version = "one", patch = {}) => ({
  athlete: { name: version, time_zone: "America/Chicago" },
  metrics: {},
  history: [],
  planned: [workout(version)],
  cache_scope: "fixture",
  version,
  ...patch,
})

const calendarRows = () => [...new Map([...training.cachedTrainingContext().history, ...training.cachedTrainingContext().planned].map(row => [row.id || row, row])).values()]
// These direct-transport regressions exercise recovery of pre-outbox requests.
// New local transaction/reload/offline behavior is verified in the browser's IDB harness.
const saveInput = (id, date = "2001-10-06") => ({model:{version:1,name:`Run ${id}`,sport:"Run",date,notes:"Easy",poolLength:"",steps:[]},values:{duration_seconds:2700},time:"06:30",comment:"",creationId:id,reconcileOnly:true})

const coachProposal=()=>({id:"9fc8da63-e749-437d-8bb1-c9171c730abc",state:"ready",phase:"preview",createdAt:1,expiresAt:9999999999999,timeZone:"America/Chicago",error:null,runUrl:null,workouts:[{name:"Coach run",type:"Run",date:"2099-10-20",description:"- 30m Z2 HR",duration_minutes:30,tss:20},{name:"Coach bike",type:"Ride",date:"2099-10-21",description:"- 45m 180w",duration_minutes:45,tss:40}]})
const coachReceipt=(proposal,indexes=[0,1],applied=true)=>({...proposal,state:applied?"applied":"unknown",phase:"push",transport:"direct",verified:applied,error:applied?null:"Recheck remaining workout",scheduledWorkouts:indexes.map(index=>({index,workout:{...workout(`event:${700+index}`,proposal.workouts[index].date),title:proposal.workouts[index].name}}))})

test("a new duration-based run immediately displays its entered distance before confirmation",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{history:[],planned:[]}))
  let reply;globalThis.fetch=()=>new Promise(resolve=>reply=resolve)
  const input={...saveInput("displayed-run","2099-10-20"),values:{duration_seconds:1890,distance_meters:3*1609.344,average_speed:1609.344/630}}
  const pending=training.createPlannedWorkout(input);await flush()
  const projected=calendarRows()[0]
  assert.equal(projected.workout_summary.planned.duration_seconds,1890)
  assert.equal(projected.plannedDurationMinutes,31.5)
  assert.equal(plannedDistanceLabel(projected),"~3.00 mi")
  reply(json({verified:true,workout:{...projected,id:"event:9901",app_pending_operation:undefined}}));await pending
  assert.equal(calendarRows().length,1)
  assert.equal(calendarRows()[0].id,"event:9901")
  assert.equal(training.trainingMutationState().busy,false)
});

test("library scheduling projects immediately and emits only one provider-confirmed toast",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{planned:[],history:[]}))
  const source={...workout("library:15"),workout_date:undefined,title:"Saved easy run",activity_id:"must-not-copy",status:"completed",workout_summary:{planned:{duration_seconds:2700},completed:{duration_seconds:2800}}}
  let finish,body;const events=[],listen=e=>events.push(e.detail);window.addEventListener("training-write-feedback",listen)
  globalThis.fetch=(_,options)=>{body=JSON.parse(options.body);return new Promise(resolve=>finish=resolve)}
  try{
    const promise=training.scheduleLibraryWorkout(source,"2099-10-22","same-library-attempt");await flush()
    const projected=calendarRows()[0];assert.equal(projected.title,source.title);assert.equal(projected.workout_date,"2099-10-22");assert.equal(projected.activity_id,undefined);assert.equal(projected.workout_summary.completed,null);assert.deepEqual(events,[])
    assert.deepEqual(body,{date:"2099-10-22",creationId:"same-library-attempt",reconcileOnly:false})
    finish(json({verified:true,workout:{...workout("event:600","2099-10-22"),title:source.title}}));await promise
    assert.deepEqual(calendarRows().map(row=>row.id),["event:600"]);assert.deepEqual(events.map(e=>e.state),["success"])
  }finally{window.removeEventListener("training-write-feedback",listen)}
})
test("rejected library scheduling removes only its unconfirmed card and preserves the existing calendar",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{planned:[workout("event:99","2099-10-20")]}))
  globalThis.fetch=async()=>json({verified:false,error:"Provider rejected scheduling"})
  await assert.rejects(training.scheduleLibraryWorkout(workout("library:15"),"2099-10-22","same"),/Provider rejected/)
  assert.deepEqual(calendarRows().map(row=>row.id),["event:99"])
})

test("unavailable private template prescriptions cannot dispatch scheduling or insert a provisional calendar card",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("metadata-guard",{planned:[workout("event:99","2099-10-20")]}))
  const before=JSON.stringify(training.cachedTrainingContext());let calls=0
  globalThis.fetch=async()=>{calls++;throw Error("Unavailable templates must not dispatch")}
  for(const flags of [{structure_read_only:true},{structure_read_only:true,template_metadata_error:"The private template prescription is unavailable. Reload before scheduling."}]){
    await assert.rejects(training.scheduleLibraryWorkout({...workout("library:15"),...flags},"2099-10-22","blocked"),/private template prescription is unavailable/)
  }
  assert.equal(calls,0);assert.equal(JSON.stringify(training.cachedTrainingContext()),before)
})

test("library validation retains a safe unavailable row but rejects malformed or contradictory metadata status",()=>{
  const source={...workout("library:15"),workout_date:undefined,structure_read_only:true,template_metadata_error:"The private template prescription is unavailable. Reload before scheduling."}
  const safe=validatedLibraryWorkout(source)
  assert.equal(safe.id,source.id);assert.equal(safe.template_metadata_error,source.template_metadata_error);assert.equal(safe.structure_read_only,true)
  for(const extra of [{structure_read_only:"true"},{structure_read_only:false},{template_metadata_error:""},{template_metadata_error:{}},{template_metadata_error:"x".repeat(1001)}])assert.throws(()=>validatedLibraryWorkout({...source,...extra}),/invalid prescription status/)
  const ordinary=validatedLibraryWorkout({...workout("library:16"),workout_date:undefined})
  assert.equal(ordinary.structure_read_only,undefined);assert.equal(ordinary.template_metadata_error,undefined)
})

test("unavailable source metadata does not prevent a read-only recheck of an earlier scheduling identity",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("metadata-recheck",{planned:[],history:[]}))
  let calls=0,body
  globalThis.fetch=async(_,options)=>{calls++;body=JSON.parse(options.body);return json({verified:true,workout:workout("event:600","2099-10-22")})}
  const id="e5c5efae-55ad-4a76-af84-112f8c7f1479"
  await training.scheduleLibraryWorkout({...workout("library:15"),structure_read_only:true,template_metadata_error:"The private template prescription is unavailable. Reload before scheduling."},"2099-10-22",id,true)
  assert.equal(calls,1);assert.deepEqual(body,{date:"2099-10-22",creationId:id,reconcileOnly:true});assert.deepEqual(calendarRows().map(row=>row.id),["event:600"])
})
test("undated library deep links share library reads and explicit retry bypasses malformed cached data",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  let calls=0;const source={...workout("library:15"),workout_date:undefined}
  globalThis.fetch=async()=>{calls++;return json({workouts:[source]})}
  assert.equal((await workoutReads.loadLibraryWorkout(source.id)).id,source.id);assert.equal((await workoutReads.loadLibraryWorkout(source.id)).workout_date,undefined);assert.equal(calls,1)
  globalThis.fetch=async()=>json({workouts:[{...source,sport:null}]})
  await assert.rejects(workoutReads.loadLibraryWorkout(source.id,undefined,true))
  globalThis.fetch=async()=>json({workouts:[source]})
  assert.equal((await workoutReads.loadLibraryWorkout(source.id,undefined,true)).id,source.id)
})
test("opening the calendar during scheduling retains pending cards without a stale snapshot request",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{planned:[],history:[]}))
  let finish,calls=0;globalThis.fetch=()=>{calls++;return new Promise(resolve=>finish=resolve)}
  const pending=training.scheduleLibraryWorkout(workout("library:15"),"2099-10-22","navigation");await flush()
  const loaded=await training.loadFullTrainingContext(true,true)
  assert.equal(calls,1);assert.ok(loaded.planned.some(row=>row.id==="pending:navigation"))
  finish(json({verified:true,workout:workout("event:500","2099-10-22")}));await pending
  assert.equal(calendarRows()[0].id,"event:500")
})
test("coach approval adds all provisional cards immediately, coalesces duplicate clicks, and confirms once",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{planned:[],history:[]}))
  const proposal=coachProposal(),events=[],listen=e=>events.push(e.detail);window.addEventListener("training-write-feedback",listen)
  let finish,calls=0;globalThis.fetch=()=>{calls++;return new Promise(resolve=>finish=resolve)}
  try{
    const first=training.confirmCoachWorkouts(proposal),second=training.confirmCoachWorkouts(proposal);assert.equal(first,second);await flush()
    assert.equal(calendarRows().length,2);assert.ok(calendarRows().every(row=>row.app_pending_operation));assert.equal(events.length,0);assert.equal(calls,1)
    const receipt=coachReceipt(proposal);finish(json(receipt));await first
    assert.deepEqual(calendarRows().map(row=>row.id).sort(),["event:700","event:701"]);assert.deepEqual(events.map(e=>e.state),["success"])
    training.acceptCoachSchedulingReceipt(receipt);assert.equal(events.length,1)
  }finally{window.removeEventListener("training-write-feedback",listen)}
})
test("partial coach success retains confirmed cards and retry doesn't project another copy of them",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{planned:[],history:[]}))
  const proposal=coachProposal(),partial=coachReceipt(proposal,[0],false)
  globalThis.fetch=async()=>json(partial)
  await assert.rejects(training.confirmCoachWorkouts(proposal),error=>error.proposal.state==="unknown")
  assert.deepEqual(calendarRows().map(row=>row.id),["event:700"])
  let finish;globalThis.fetch=()=>new Promise(resolve=>finish=resolve)
  const next=training.confirmCoachWorkouts({...partial,scheduledWorkouts:[]});await flush()
  assert.equal(calendarRows().length,2);assert.equal(calendarRows().filter(row=>row.title==="Coach run").length,1)
  finish(json(coachReceipt(proposal)));await next
  assert.deepEqual(calendarRows().map(row=>row.id).sort(),["event:700","event:701"])
})
test("a late coach status receipt restores a lost reply and notifies only once",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{planned:[],history:[]}))
  const events=[],listen=e=>events.push(e.detail);window.addEventListener("training-write-feedback",listen)
  try{const receipt=coachReceipt(coachProposal());training.acceptCoachSchedulingReceipt(receipt);training.acceptCoachSchedulingReceipt(receipt);assert.deepEqual(calendarRows().map(row=>row.id).sort(),["event:700","event:701"]);assert.deepEqual(events.map(e=>e.state),["success"])}finally{window.removeEventListener("training-write-feedback",listen)}
})
test("malformed coach receipts cannot acknowledge another plan or duplicate provider IDs",async()=>{
  for(const changed of [receipt=>({...receipt,workouts:[{...receipt.workouts[0],date:"2099-11-01"},receipt.workouts[1]]}),receipt=>({...receipt,scheduledWorkouts:[receipt.scheduledWorkouts[0],{...receipt.scheduledWorkouts[1],workout:receipt.scheduledWorkouts[0].workout}]})]){
    window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true);training.rememberLiveTrainingContext(context("saved",{planned:[],history:[]}))
    const proposal=coachProposal();globalThis.fetch=async()=>json(changed(coachReceipt(proposal)))
    await assert.rejects(training.confirmCoachWorkouts(proposal));assert.equal(calendarRows().length,0)
  }
})
test("library and coach scheduling time out stalled bodies, abort transport, and never replay writes",async(t)=>{
  t.mock.timers.enable({apis:["setTimeout"]})
  for(const [write,timeout] of [[()=>training.scheduleLibraryWorkout(workout("library:15"),"2099-10-22","same"),90000],[()=>training.confirmCoachWorkouts(coachProposal()),240000]]){
    window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true);training.rememberLiveTrainingContext(context("saved",{planned:[],history:[]}))
    let calls=0,signal;globalThis.fetch=async(_,options)=>{calls++;signal=options.signal;return new Response(new ReadableStream({start(){}}))}
    const promise=write();const rejected=assert.rejects(promise,{name:"TimeoutError"});await flush();t.mock.timers.tick(timeout);await rejected
    assert.equal(calls,1);assert.ok(signal.aborted);assert.equal(calendarRows().length,0);assert.equal(training.trainingMutationState().busy,false)
  }
})

test("creation on an archived date replaces its provisional card and preserves unrelated history", async () => {
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  const history=[{workout_date:"2001-10-01",recovery:{hrv:50}},{workout_date:"2001-10-02",recovery:{hrv:52}},workout("event:11","2001-10-04")]
  training.rememberLiveTrainingContext(context("saved",{history,planned:[]}))
  let reply;const feedback=[];const listen=e=>feedback.push(e.detail)
  window.addEventListener("training-write-feedback",listen)
  try {
    globalThis.fetch=()=>new Promise(resolve=>{reply=resolve})
    const pending=training.createPlannedWorkout(saveInput("archived-draft"));await flush()
    assert.ok(calendarRows().find(row=>row.id==="pending:archived-draft")?.app_pending_operation)
    assert.deepEqual(feedback,[])
    const saved=workout("event:22","2001-10-06")
    reply(json({verified:true,workout:saved,context:context("bounded",{history:[],planned:[],context_scope:"full",display_range:{start:"2026-10-01",end:"2026-11-01"}})}))
    await pending
    assert.ok(!calendarRows().some(row=>row.id?.startsWith("pending:")))
    assert.equal(calendarRows().filter(row=>row.id==="event:22").length,1)
    assert.ok(calendarRows().some(row=>row.id==="event:11"))
    assert.equal(calendarRows().filter(row=>!row.id).length,2)
    assert.deepEqual(feedback.map(item=>item.state),["success"])
  } finally {window.removeEventListener("training-write-feedback",listen)}
})

test("out of order create confirmations retain both workouts despite older bounded snapshots",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  const before=context("saved",{history:[],planned:[]});training.rememberLiveTrainingContext(before)
  const replies=[];globalThis.fetch=()=>new Promise(resolve=>replies.push(resolve))
  const a=training.createPlannedWorkout(saveInput("draft-a")),b=training.createPlannedWorkout(saveInput("draft-b"));await flush()
  const first=workout("event:101","2001-10-06"),second=workout("event:102","2099-10-07")
  replies[1](json({verified:true,workout:second,context:context("stale-b",{history:[],planned:[second]})}));await b
  assert.ok(calendarRows().some(row=>row.id==="pending:draft-a"))
  replies[0](json({verified:true,workout:first,context:context("stale-a",{history:[first],planned:[]})}));await a
  assert.deepEqual(calendarRows().map(row=>row.id).sort(),["event:101","event:102"])
  assert.ok(!training.trainingMutationState().busy)
})

test("older verified saves cannot overwrite newer local edits to the same workout",()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{planned:[workout("event:1","2099-10-06")]}))
  const first=training.beginOptimisticWorkoutWrite({id:"event:1",patch:{title:"First"}})
  const second=training.beginOptimisticWorkoutWrite({id:"event:1",patch:{title:"Second"}})
  try {
    assert.equal(first.commit({...workout("event:1","2099-10-06"),title:"First"}).applied,false)
    first.confirm()
    assert.equal(calendarRows()[0].title,"Second")
    assert.equal(second.commit({...workout("event:1","2099-10-06"),title:"Second"}).applied,true)
    second.confirm();assert.equal(calendarRows()[0].title,"Second")
    assert.ok(!calendarRows()[0].app_pending_operation)
  } finally {first.finish();second.finish()}
})

test("archived workout edits update immediately, and rejection rolls back only that edit",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("saved",{history:[],planned:[workout("event:7","2099-10-06")]}))
  const old=workout("event:6","2001-10-06");training.rememberWorkoutForEditing(old)
  let reply;globalThis.fetch=()=>new Promise(resolve=>{reply=resolve})
  const pending=training.savePlannedWorkoutValues(old.id,{duration_seconds:3600},"revision",{name:"Longer",date:"2099-10-08"})
  const rejected=assert.rejects(pending,/Rejected/);await flush()
  const projected=calendarRows().find(row=>row.id===old.id)
  assert.equal(projected.title,"Longer");assert.equal(projected.workout_date,"2099-10-08");assert.equal(projected.plannedDurationMinutes,60)
  reply(new Response(JSON.stringify({error:"Rejected"}),{status:409}));await rejected
  const restored=calendarRows().find(row=>row.id===old.id)
  assert.equal(restored.title,old.title);assert.equal(restored.workout_date,old.workout_date)
  assert.equal(restored.planned_values_edited,undefined)
  assert.ok(calendarRows().some(row=>row.id==="event:7"))
})

test("editing planned totals retains a paired recording, even if the response omits its context",async()=>{
  for(const withContext of [true,false]){
    window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
    const recorded={...workout("event:8","2001-10-06"),status:"completed",activity_id:"i800",actualDurationMinutes:72,distance_meters:30000,workout_summary:{planned:{duration_seconds:3600},completed:{duration_seconds:4320,distance_meters:30000,tss:81}}}
    training.rememberLiveTrainingContext(context("saved",{history:[recorded],planned:[]}))
    const plan={...workout("event:8","2099-10-08"),workout_summary:{planned:{duration_seconds:5400},completed:null},planned_workout_date:"2099-10-08"}
    globalThis.fetch=async()=>json({verified:true,workout:plan,revision:"after",...(withContext?{context:context("bounded",{history:[],planned:[plan]})}:{})})
    const result=await training.savePlannedWorkoutValues(recorded.id,{duration_seconds:5400},"before",{date:"2099-10-08"})
    assert.equal(result.workout.activity_id,"i800");assert.equal(result.workout.workout_date,"2001-10-06")
    assert.equal(result.workout.actualDurationMinutes,72);assert.equal(result.workout.workout_summary.completed.tss,81)
    assert.equal(result.workout.workout_summary.planned.duration_seconds,5400)
    assert.equal(calendarRows().filter(row=>row.id===recorded.id).length,1)
  }
})

test("compound summary, description, and comment saves emit one terminal confirmation",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  const target=workout("event:50","2099-10-06");training.rememberLiveTrainingContext(context("saved",{planned:[target]}))
  const notifications=[],listen=e=>notifications.push(e.detail);window.addEventListener("training-write-feedback",listen)
  const replies=[];globalThis.fetch=async(_,options)=>{
    const body=JSON.parse(options.body);replies.push(body)
    return json(body.workoutId?{verified:true,id:"comment:1",workout_id:target.id,body:body.body.trim(),type:body.type}:{verified:true,workout:{...target,workout_summary:{planned:body.values || {},completed:null}},revision:"next"})
  }
  try {
    const feedback=training.beginWorkoutSaveFeedback()
    await training.savePlannedWorkoutValues(target.id,{duration_seconds:2700},"old",{}, {feedback:false})
    await training.queueWorkoutMutation({type:"description",id:target.id,description:"Relaxed run"},true,{feedback:false})
    assert.equal(notifications.length,0)
    await training.saveWorkoutComment({workoutId:target.id,body:" Felt good ",type:"pre",creationId:"comment-draft",syncOnly:false})
    feedback.confirm();feedback.confirm()
    assert.deepEqual(notifications.map(item=>item.state),["success"])
    assert.equal(replies.length,3)
    assert.equal(calendarRows()[0].editable_description,"Relaxed run")
  } finally {window.removeEventListener("training-write-feedback",listen)}
})

test("failed compound comment saves retain already confirmed planned values and emit only an error",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  const target=workout("event:51","2099-10-06");training.rememberLiveTrainingContext(context("saved",{planned:[target]}))
  const notifications=[],listen=e=>notifications.push(e.detail);window.addEventListener("training-write-feedback",listen)
  try {
    const feedback=training.beginWorkoutSaveFeedback()
    globalThis.fetch=async()=>json({verified:true,revision:"next",workout:{...target,workout_summary:{planned:{tss:60},completed:null}}})
    await training.savePlannedWorkoutValues(target.id,{tss:60},"old",{}, {feedback:false})
    globalThis.fetch=async()=>json({verified:false,error:"Comment rejected"})
    try{await training.saveWorkoutComment({workoutId:target.id,body:"Retry me",type:"pre",creationId:"same-draft",syncOnly:false})}catch(error){feedback.fail(error)}
    assert.deepEqual(notifications.map(item=>item.state),["error"])
    assert.equal(calendarRows()[0].workout_summary.planned.tss,60)
    assert.equal(training.trainingMutationState().busy,false)
  } finally {window.removeEventListener("training-write-feedback",listen)}
})

test("editor and comment responses must identify the workout and confirm provider persistence",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  const model=saveInput("model").model
  for(const reply of [{verified:false,revision:"r",workout:workout("event:1")},{verified:true,workout:workout("event:1")},{verified:true,revision:"r",workout:workout("event:2")}]){
    globalThis.fetch=async()=>json(reply)
    await assert.rejects(training.writeWorkoutEditor("event:1",{model,reconcileOnly:true}),/verify|match/)
  }
  const input={workoutId:"event:1",body:"Draft",type:"pre",creationId:"comment",syncOnly:false}
  for(const reply of [{verified:true,id:"c",workout_id:"event:2",body:"Draft",type:"pre"},{verified:true,id:"c",workout_id:"event:1",body:"Different",type:"pre"},{verified:true,id:"c",workout_id:"event:1",body:"Draft",type:"post"}]){
    globalThis.fetch=async()=>json(reply)
    await assert.rejects(training.saveWorkoutComment(input),/could not be confirmed/)
  }
})

test("editor and comment writes bound stalled bodies, abort transport, and never replay writes",async(t)=>{
  t.mock.timers.enable({apis:["setTimeout"]})
  for(const [write,timeout] of [[()=>training.writeWorkoutEditor("event:1",{model:saveInput("edit").model,reconcileOnly:true}),65000],[()=>training.writeWorkoutEditor(null,{...saveInput("create")}),90000],[()=>training.saveWorkoutComment({workoutId:"event:1",body:"Draft",type:"pre",creationId:"same",syncOnly:false}),65000]]){
    window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
    let calls=0,signal;globalThis.fetch=async(_,options)=>{calls++;signal=options.signal;return new Response(new ReadableStream({start(){}}))}
    const promise=write();const rejected=assert.rejects(promise,{name:"TimeoutError"});await flush()
    t.mock.timers.tick(timeout);await rejected
    assert.ok(signal.aborted);assert.equal(calls,1);assert.equal(training.trainingMutationState().busy,false)
  }
})

test("session changes cancel pending editor writes and suppress late save notifications",async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true)
  const messages=[],listen=e=>messages.push(e.detail);window.addEventListener("training-write-feedback",listen)
  try {
    const feedback=training.beginWorkoutSaveFeedback();const stage=training.beginOptimisticWorkoutWrite({id:"event:1",patch:{title:"Old session"}})
    let reply;globalThis.fetch=()=>new Promise(resolve=>{reply=resolve})
    const pending=training.writeWorkoutEditor("event:1",{model:saveInput("old-session").model,reconcileOnly:true});const rejected=assert.rejects(pending,{name:"AbortError"});await flush()
    window.dispatchEvent(new Event("app-auth-required"));await rejected
    feedback.confirm();stage.fail(Error("Old request"));stage.finish()
    reply(json({verified:true,workout:workout("event:1"),revision:"old"}));await flush()
    assert.equal(messages.length,0);assert.equal(training.trainingMutationState().busy,false)
  } finally {window.removeEventListener("training-write-feedback",listen)}
})

test("workspace navigation shares overlapping reads and reuses the bounded session cache", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  let calls = 0
  globalThis.fetch = async () => { calls++; return json({reports: [{id: "saved-report"}]}) }
  const [a,b] = await Promise.all([workspaceReads.loadWorkspaceRead("/api/coach/reports/catalog"), workspaceReads.loadWorkspaceRead("/api/coach/reports/catalog")])
  assert.equal(calls, 1); assert.deepEqual(a,b)
  await workspaceReads.loadWorkspaceRead("/api/coach/reports/catalog")
  assert.equal(calls, 1)
  window.dispatchEvent(new Event("training-mutation-started"))
  await workspaceReads.loadWorkspaceRead("/api/coach/reports/catalog")
  assert.equal(calls, 2)
})

test("template refresh invalidates stale library reads and snapshots without publishing a calendar context", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  const source=workout("event:18")
  training.rememberTrainingContext(context("source-unchanged",{planned:[source]}),"full")
  const before=structuredClone(training.cachedTrainingContext())
  pageSnapshots.writePageSnapshot("library",["old-template"],pageSnapshots.pageSnapshotRevision())
  pageSnapshots.writePageSnapshot("coach",["unrelated"],pageSnapshots.pageSnapshotRevision())
  const staleRevision=pageSnapshots.pageSnapshotRevision()
  let finishOld,calls=0,contextEvents=0,libraryEvents=0,freshRead
  globalThis.fetch=async()=>++calls===1?new Promise(resolve=>{finishOld=resolve}):json({workouts:[{id:"library:2"}]})
  const old=workspaceReads.loadWorkspaceRead("/api/workout-library");await flush()
  window.__workspaceStartupRequests={"/api/workout-library":Promise.resolve(json({workouts:[{id:"library:999"}]})),"/api/annual-plans":Promise.resolve(json({plans:[]}))}
  const onContext=()=>contextEvents++
  const onLibrary=()=>{libraryEvents++;freshRead=workspaceReads.loadWorkspaceRead("/api/workout-library")}
  window.addEventListener("training-context-updated",onContext);window.addEventListener("workout-library-updated",onLibrary)
  try {
    workspaceReads.notifyWorkoutLibraryChanged()
    assert.equal((await freshRead).workouts[0].id,"library:2")
    assert.equal(calls,2);assert.equal(contextEvents,0);assert.equal(libraryEvents,1)
    assert.deepEqual(training.cachedTrainingContext(),before)
    assert.equal(window.__workspaceStartupRequests["/api/workout-library"],undefined)
    assert.ok(window.__workspaceStartupRequests["/api/annual-plans"])
    assert.equal(pageSnapshots.pageSnapshotFresh("library"),false)
    assert.deepEqual(pageSnapshots.readPageSnapshot("library"),["old-template"])
    assert.equal(pageSnapshots.pageSnapshotFresh("coach"),true)
    pageSnapshots.writePageSnapshot("library",["late-old-template"],staleRevision)
    assert.deepEqual(pageSnapshots.readPageSnapshot("library"),["old-template"])
    finishOld(json({workouts:[{id:"library:1"}]}));await old
    assert.equal((await workspaceReads.loadWorkspaceRead("/api/workout-library")).workouts[0].id,"library:2")
    assert.equal(calls,2)
  } finally {
    window.removeEventListener("training-context-updated",onContext);window.removeEventListener("workout-library-updated",onLibrary)
    delete window.__workspaceStartupRequests
  }
})

test("workspace reads consume protected startup responses once without another database request", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  window.__workspaceStartupRequests = {"/api/annual-plans": Promise.resolve(json({plans: [{id: "plan"}]}))}
  globalThis.fetch = () => { throw Error("Duplicate startup request") }
  const result = await workspaceReads.loadWorkspaceRead("/api/annual-plans")
  assert.equal(result.plans[0].id, "plan")
  assert.equal(window.__workspaceStartupRequests["/api/annual-plans"], undefined)
})

test("logout prevents cached workspace data and a late startup response from entering the next session", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  let finish
  window.__workspaceStartupRequests = {"/api/workout-library": new Promise(resolve => { finish = resolve })}
  const pending = workspaceReads.loadWorkspaceRead("/api/workout-library")
  const rejected = assert.rejects(pending)
  await flush(); setApiAuthenticated(false); window.dispatchEvent(new Event("app-auth-required"))
  finish(json({workouts: [{id: "private-old-session"}]})); await rejected
  assert.throws(() => workspaceReads.loadWorkspaceRead("/api/workout-library"), /Sign in/)
  setApiAuthenticated(true, true)
  globalThis.fetch = async () => json({workouts: []})
  assert.deepEqual((await workspaceReads.loadWorkspaceRead("/api/workout-library")).workouts, [])
})

test("invalid workspace results are retryable and closing one view leaves another reader alive", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  globalThis.fetch = async () => json({events: null})
  await assert.rejects(workspaceReads.loadWorkspaceRead("/api/race-events"), /incomplete/)
  let finish
  globalThis.fetch = () => new Promise(resolve => { finish = resolve })
  const controller = new AbortController()
  const abandoned = workspaceReads.loadWorkspaceRead("/api/race-events", controller.signal)
  const rejected = assert.rejects(abandoned)
  const active = workspaceReads.loadWorkspaceRead("/api/race-events")
  await flush(); controller.abort(); await rejected
  finish(json({events: [{id: "race"}]}))
  assert.equal((await active).events[0].id, "race")
})

test("a workspace read after a write never joins or caches the older transport", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  let finishOld, calls = 0
  globalThis.fetch = async () => {
    if (++calls === 1) return new Promise(resolve => { finishOld = resolve })
    return json({plans: [{id:"new-plan"}]})
  }
  const old = workspaceReads.loadWorkspaceRead("/api/annual-plans")
  await flush()
  window.dispatchEvent(new Event("annual-plan-updated"))
  const fresh = await workspaceReads.loadWorkspaceRead("/api/annual-plans")
  assert.equal(calls, 2); assert.equal(fresh.plans[0].id, "new-plan")
  finishOld(json({plans: [{id:"old-plan"}]})); await old
  assert.equal((await workspaceReads.loadWorkspaceRead("/api/annual-plans")).plans[0].id,"new-plan")
  assert.equal(calls, 2)
})

test("prepared planned values share a read and invalidate before a provider mutation", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  let calls = 0
  globalThis.fetch = async () => { calls++; return json({ revision: `revision-${calls}`, workout: workout("event:18") }) }
  const [first, second] = await Promise.all([workoutReads.loadWorkoutValues("event:18"), workoutReads.loadWorkoutValues("event:18")])
  assert.equal(calls, 1); assert.equal(first.revision, second.revision)
  assert.equal(workoutReads.cachedWorkoutValues("event:18").revision, "revision-1")
  window.dispatchEvent(new Event("training-mutation-started"))
  assert.equal(workoutReads.cachedWorkoutValues("event:18"), undefined)
  assert.equal((await workoutReads.loadWorkoutValues("event:18")).revision, "revision-2")
})

test("logout aborts prepared workout reads and prevents a late private response being cached", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  let finish
  globalThis.fetch = () => new Promise(resolve => { finish = resolve })
  const read = workoutReads.loadWorkoutValues("event:19")
  const rejected = assert.rejects(read)
  await flush(); window.dispatchEvent(new Event("app-auth-required"))
  finish(json({ revision: "old-session", workout: workout("event:19") }))
  await rejected; await flush()
  assert.equal(workoutReads.cachedWorkoutValues("event:19"), undefined)
})

test("food searches reuse confirmed results, while retry and library edits require new reads", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  let calls = 0
  globalThis.fetch = async url => { calls++; return json(String(url).includes("search") ? { products: [] } : { revision: calls, items: [] }) }
  await foodReads.searchFoods("banana"); await foodReads.searchFoods("banana")
  assert.equal(calls, 1)
  await foodReads.searchFoods("banana", undefined, 1)
  assert.equal(calls, 2)
  await foodReads.loadFoodLibrary(); await foodReads.loadFoodLibrary()
  assert.equal(calls, 3)
  window.dispatchEvent(new Event("food-library-updated"))
  await foodReads.loadFoodLibrary()
  assert.equal(calls, 4)
})

test("incomplete workout reads never poison the preview cache", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  globalThis.fetch = async () => json({ revision: "wrong-event", workout: workout("event:22") })
  await assert.rejects(workoutReads.loadWorkoutValues("event:21"), /could not be loaded/)
  assert.equal(workoutReads.cachedWorkoutValues("event:21"), undefined)
  globalThis.fetch = async () => json({ revision: "valid", workout: workout("event:21") })
  assert.equal((await workoutReads.loadWorkoutValues("event:21")).revision, "valid")
})

test("legacy creation reconciliation remains provisional until provider verification",async()=>{
 window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true);
 const before=context("new-summary",{history:[],planned:[]});training.rememberLiveTrainingContext(before);
 const input={model:{version:1,name:"Easy run",sport:"Run",date:"2026-10-17",notes:"Easy",poolLength:"",steps:[]},values:{duration_seconds:2700},time:"06:30",comment:"Relaxed effort",creationId:"ac264d2c-cbef-494a-846d-22fc082544cb",reconcileOnly:true};
 let reply,body;
 globalThis.fetch=async(_,options)=>{body=JSON.parse(options.body);return await new Promise(resolve=>{reply=resolve})};
 const pending=training.createPlannedWorkout(input);await flush();
 assert.deepEqual(body,input);
 const provisional=[...training.cachedTrainingContext().planned,...training.cachedTrainingContext().history].find(w=>w.id===`pending:${input.creationId}`);
 assert.ok(provisional.app_pending_operation);
 assert.equal(provisional.title,"Easy run");
 assert.ok(![...training.cachedTrainingContext().planned,...training.cachedTrainingContext().history].some(w=>w.id==="event:31"));
 const saved={...workout("event:31","2026-10-17"),title:"Easy run",workout_summary:{planned:{duration_seconds:2700},completed:null}};
 reply(json({verified:true,workout:saved}));
 assert.equal((await pending).workout.id,"event:31");
 assert.ok([...training.cachedTrainingContext().history,...training.cachedTrainingContext().planned].some(w=>w.id==="event:31"));
 assert.ok(![...training.cachedTrainingContext().history,...training.cachedTrainingContext().planned].some(w=>w.id.startsWith("pending:")));
 globalThis.fetch=async()=>json({verified:false,workout:workout("event:32")});
 await assert.rejects(training.createPlannedWorkout({...input,reconcileOnly:true}));
 assert.ok(![...training.cachedTrainingContext().history,...training.cachedTrainingContext().planned].some(w=>w.id==="event:32"));
});

test("mobile and desktop moves update locally immediately but await provider confirmation", async () => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  const chicagoToday = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
  const tomorrow = new Date(chicagoToday + "T12:00:00Z")
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const target = tomorrow.toISOString().slice(0,10)
  const original = context("move-test", { planned: [workout("event:12")] })
  training.rememberLiveTrainingContext(original)
  let reply,
    path,
    body,
    finished = false
  globalThis.fetch = async (url, options) => {
    path = url
    body = JSON.parse(options.body)
    return await new Promise((resolve) => {
      reply = resolve
    })
  }
  const save = training
    .moveWorkoutDate("event:12", target)
    .then((result) => {
      finished = true
      return result
    })
  await flush()
  assert.match(decodeURIComponent(new URL(path,"http://localhost").searchParams.get("__api_route")), /workouts\/event:12\/move/)
  assert.deepEqual(body, { date: target })
  assert.equal(finished, false)
  assert.equal(
    training.cachedTrainingContext().planned[0].workout_date,
    target
  )
  assert.ok(training.cachedTrainingContext().planned[0].app_pending_operation)
  reply(
    json({
      verified: true,
      context: context("moved", {
        planned: [workout("event:12", target)],
      }),
    })
  )
  await save
  assert.equal(
    training.cachedTrainingContext().planned[0].workout_date,
    target
  )
})

test("the actual optimistic projector moves yesterday into history and today into both calendar buckets across Chicago midnight",async t=>{
  const {projectOptimisticWorkout}=await import("../src/lib/optimistic-workout.ts")
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-10-21T05:01:00Z").getTime()})
  const before=context("midnight",{planned:[workout("event:12","2026-10-22")]})
  const historical=projectOptimisticWorkout(before,{id:"event:12",operation:"past",patch:{workout_date:"2026-10-20"}})
  assert.equal(historical.planned.length,0)
  assert.equal(historical.history.find(row=>row.id==="event:12").workout_date,"2026-10-20")
  const current=projectOptimisticWorkout(before,{id:"event:12",operation:"today",patch:{workout_date:"2026-10-21"}})
  assert.equal(current.planned.find(row=>row.id==="event:12").workout_date,"2026-10-21")
  assert.equal(current.history.find(row=>row.id==="event:12").workout_date,"2026-10-21")
})

test("unconfirmed moves and deletes roll back the provisional calendar projection", async () => {
  for (const action of ["move", "delete"]) {
    window.dispatchEvent(new Event("training-cache-reset"))
    setApiAuthenticated(true)
    training.rememberLiveTrainingContext(
      context("unchanged", { planned: [workout("event:12")] })
    )
    globalThis.fetch = async () => json({ verified: false })
    await assert.rejects(
      training.changeWorkout("event:12", action, "2026-10-20"),
      /Unable to/
    )
    const restored=[...training.cachedTrainingContext().planned,...training.cachedTrainingContext().history].find(w=>w.id==="event:12")
    assert.equal(restored.id, "event:12")
    assert.equal(
      restored.workout_date,
      "2026-10-06"
    )
  }
})

test("a confirmed-dialog delete keeps its record mounted while pending and rejected, then removes only the verified identity", async () => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  const race = { ...workout("event:12"), category: "RACE_B" },
    other = workout("event:13")
  training.rememberLiveTrainingContext(context("race-delete", { planned: [race, other] }))
  let reply
  const settled = []
  const listen = () => settled.push(true)
  window.addEventListener("training-mutation-settled", listen)
  try {
    globalThis.fetch = () => new Promise(resolve => { reply = resolve })
    const rejected = training.changeWorkout(race.id, "delete", undefined, undefined, { feedback: false, optimistic: false })
    await flush()
    assert.deepEqual(training.cachedTrainingContext().planned.map(row => row.id), [race.id, other.id])
    assert.ok(training.cachedTrainingContext().planned.every(row => !row.app_pending_operation))
    reply(json({ error: "Race deletion rejected" }, { status: 400 }))
    await assert.rejects(rejected, /Race deletion rejected/)
    assert.deepEqual(training.cachedTrainingContext().planned.map(row => row.id), [race.id, other.id])
    assert.equal(settled.length, 1)

    const confirmed = training.changeWorkout(race.id, "delete", undefined, undefined, { feedback: false, optimistic: false })
    await flush()
    assert.deepEqual(training.cachedTrainingContext().planned.map(row => row.id), [race.id, other.id])
    // A stale bounded response must not restore the independently confirmed deletion.
    reply(json({ verified: true, context: context("provider-old-snapshot", { planned: [race, other] }) }))
    const result = await confirmed
    assert.deepEqual(training.cachedTrainingContext().planned.map(row => row.id), [other.id])
    assert.deepEqual(result.context.planned.map(row => row.id), [other.id])
    assert.equal(settled.length, 2)
  } finally {
    window.removeEventListener("training-mutation-settled", listen)
  }
})

test("missed calendar workouts can move across today and delete without a duplicate global toast", async () => {
  for (const action of ["move", "delete"]) {
    window.dispatchEvent(new Event("training-cache-reset"))
    setApiAuthenticated(true)
    const missed = { ...workout("event:12", "2001-10-12"), status: "upcoming" }
    training.rememberLiveTrainingContext(context("missed", { history: [missed], planned: [] }))
    const feedback = []
    const listen = event => feedback.push(event.detail)
    window.addEventListener("training-write-feedback", listen)
    let reply
    globalThis.fetch = () => new Promise(resolve => { reply = resolve })
    const save = training.changeWorkout(missed.id, action, "2099-10-20", undefined, { feedback: false })
    await flush()
    assert.equal(training.cachedTrainingContext().history.length, 0)
    if (action === "move") assert.equal(training.cachedTrainingContext().planned[0].workout_date, "2099-10-20")
    reply(json({ verified: true, refreshWarning: "Calendar refresh is pending." }))
    await save
    const rows = [...training.cachedTrainingContext().history, ...training.cachedTrainingContext().planned]
    assert.equal(rows.filter(row => row.id === missed.id).length, action === "move" ? 1 : 0)
    assert.ok(!rows.some(row => row.app_pending_operation))
    assert.equal(feedback.length, 0)
    window.removeEventListener("training-write-feedback", listen)
  }
})

test("workout notifications appear only after provider confirmation", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context("toast", { history: [workout("event:12", "2001-10-12")], planned: [] }))
  const feedback = []
  const listen = event => feedback.push(event.detail)
  window.addEventListener("training-write-feedback", listen)
  try {
    let finish
    globalThis.fetch = () => new Promise(resolve=>{finish=resolve})
    const save=training.changeWorkout("event:12", "delete")
    await flush()
    assert.equal(training.cachedTrainingContext().history.length,0)
    assert.equal(feedback.length,0)
    finish(json({verified:true}))
    await save
    assert.deepEqual(feedback.map(item => item.state), ["success"])
  } finally { window.removeEventListener("training-write-feedback", listen) }
})

test("linking sends the exact Intervals IDs immediately and can render a verified result without another calendar read", async () => {
  window.dispatchEvent(new Event("training-cache-reset")); setApiAuthenticated(true)
  const plan={...workout("event:7","2001-10-12"),status:"upcoming"}
  const ride={...workout("activity:i42","2001-10-13"),status:"completed",activity_id:"i42"}
  training.rememberLiveTrainingContext(context("pair",{history:[plan,ride],planned:[]}))
  let finish
  const requests=[]
  globalThis.fetch=(url,options)=>{requests.push({url:String(url),method:options.method,body:JSON.parse(options.body)});return new Promise(resolve=>{finish=resolve})}
  const save=training.pairCompletedWorkout(plan.id,ride.id)
  await flush()
  assert.equal(requests.length,1)
  assert.equal(requests[0].method,"POST")
  assert.deepEqual(requests[0].body,{plannedId:"event:7",completedId:"activity:i42"})
  assert.match(decodeURIComponent(requests[0].url),/workouts\/pair/)
  finish(json({verified:true,workout:{...plan,status:"completed",activity_id:"i42",workout_date:ride.workout_date},context:null}))
  await save
  const rows=[...training.cachedTrainingContext().history,...training.cachedTrainingContext().planned]
  assert.equal(rows.filter(row=>row.activity_id==="i42").length,1)
  assert.equal(rows.find(row=>row.id==="event:7").workout_date,ride.workout_date)
  assert.equal(requests.length,1)
})

test("provider-confirmed description edits replace the editable text in the startup snapshot", async () => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  training.rememberLiveTrainingContext(
    context("description", {
      planned: [{ ...workout("event:12"), editable_description: "Old" }],
    })
  )
  globalThis.fetch = async () => json({ verified: true })
  await training.queueWorkoutMutation(
    { type: "description", id: "event:12", description: "New" },
    true
  )
  assert.equal(
    [...training.cachedTrainingContext().planned,...training.cachedTrainingContext().history].find(w=>w.id==="event:12").editable_description,
    "New"
  )
})

test("a returning full cache validates its version without downloading the snapshot again", async () => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  training.rememberLiveTrainingContext(
    context("returning", { context_scope: "full" })
  )
  const before = training.cachedTrainingContext()
  const persisted = storage.get("training-agent-startup-v2")
  let changes = 0
  const changed = () => changes++
  window.addEventListener("training-context-updated", changed)
  let path
  globalThis.fetch = async (url) => {
    path = url
    return json({ unchanged: true, version: "returning" })
  }
  const loaded = await training.loadFullTrainingContext(false, true)
  assert.match(path, /version=returning/)
  assert.match(path, /training-updates/)
  assert.equal(loaded.version, "returning")
  assert.equal(loaded, before)
  assert.equal(changes, 0)
  assert.equal(storage.get("training-agent-startup-v2"), persisted)
  window.removeEventListener("training-context-updated", changed)
  window.dispatchEvent(new Event("training-cache-reset"))
})

test("early protected version checks preserve a matching full snapshot without a second download", async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true);
  training.rememberLiveTrainingContext({...context("early-version"),context_scope:"full"});
  window.__trainingContextVersion="early-version";
  window.__trainingContextRequest=Promise.resolve(json({unchanged:true,version:"early-version"}));
  globalThis.fetch=()=>{throw Error("Unexpected second download")};
  const before=training.cachedTrainingContext();
  assert.equal(await training.loadFullTrainingContext(false,true),before);
  assert.equal(window.__trainingContextRequest,undefined);
  assert.equal(window.__trainingContextVersion,undefined);
});

test("a stale startup version receipt cannot validate another snapshot", async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true);
  training.rememberLiveTrainingContext({...context("actual-cache"),context_scope:"full"});
  window.__trainingContextVersion="stale-metadata";
  window.__trainingContextRequest=Promise.resolve(json({unchanged:true,version:"stale-metadata"}));
  let calls=0;globalThis.fetch=async()=>{calls++;return json({...context("fresh-full"),context_scope:"full"})};
  assert.equal((await training.loadFullTrainingContext(false,true)).version,"fresh-full");
  assert.equal(calls,1);
});

test("historical range merges retain current version and current athlete metrics", () => {
  const current = context("live", {
    context_scope: "full",
    metrics: { fitness: 90 },
    planned: [workout("current", "2026-10-07")],
  })
  const incoming = context("old-page", {
    context_scope: "range",
    cache_scope: "unrelated-metadata",
    metrics: { fitness: 10 },
    display_range: { start: "2020-01-01", end: "2020-01-31" },
    history: [workout("old", "2020-01-03")],
    planned: [],
  })
  const merged = training.mergeCalendarContext(current, incoming)
  assert.equal(merged.version, "live")
  assert.equal(merged.cache_scope, "fixture")
  assert.equal(merged.context_scope, "full")
  assert.deepEqual(merged.metrics, { fitness: 90 })
  assert.equal(merged.athlete.name, "live")
  assert.equal(merged.history[0].id, "old")
  assert.equal(merged.planned[0].id, "current")
})

test("a bounded live snapshot preserves loaded older history but removes deleted recent workouts", () => {
  const old = workout("historical", "2020-01-03")
  const current = context("before", {
    history: [old, workout("deleted", "2090-01-01")],
    planned: [],
  })
  const fresh = context("live", {
    context_scope: "full",
    retention_days: 90,
    display_range: { start: "0000-01-01", end: "9999-12-31" },
    history: [],
    planned: [],
  })
  const merged = training.mergeCalendarContext(current, fresh)
  assert.deepEqual(
    merged.history.map((row) => row.id),
    ["historical"]
  )
  assert.equal(merged.version, "live")
})
const targets = {
  calories: 2000,
  protein: 150,
  carbs: 225,
  fat: 55,
  fiber: null,
}
const diary = (date = "2026-10-06", revision = 1) => ({
  date,
  day: { entries: [], revision },
  targets,
  targetsRevision: 1,
  week: [],
  aiAvailable: false,
  localPreview: false,
})

test.beforeEach(() => {
  storage.clear()
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true, true)
  globalThis.fetch = () => {
    throw Error("Unexpected network request")
  }
})

test("concurrent training views and repeated forced refreshes each share one database request", async () => {
  let finish,
    calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = training.loadTrainingContext(),
    second = training.loadTrainingContext()
  await flush()
  assert.equal(calls, 1)
  finish(json(context()))
  assert.equal((await first).athlete.name, "one")
  assert.equal((await second).athlete.name, "one")
  await training.loadTrainingContext()
  assert.equal(calls, 1)
  const refresh = training.loadTrainingContext(true),
    duplicate = training.loadTrainingContext(true)
  await flush()
  assert.equal(calls, 2)
  finish(json(context("two")))
  assert.equal((await refresh).athlete.name, "two")
  assert.equal((await duplicate).athlete.name, "two")
})

test("a cache reset during initial load does not self-await or automatically repeat the database read", async () => {
  let finish,
    calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const old = training.loadTrainingContext()
  await flush()
  window.dispatchEvent(new Event("training-cache-reset"))
  finish(json(context("stale")))
  assert.equal((await old).source, "local-preview")
  assert.equal(calls, 1)
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  globalThis.fetch = async () => {
    calls++
    return json(context("fresh"))
  }
  assert.equal((await training.loadTrainingContext()).athlete.name, "fresh")
  assert.equal(calls, 2)
})

test("a fresh full context also satisfies startup week consumers without a second database request", async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json(context("full", { context_scope: "full" }))
  }
  await training.loadFullTrainingContext()
  const week = await training.loadTrainingContext()
  assert.equal(week.athlete.name, "full")
  assert.equal(calls, 1)
  await training.revalidateTrainingContext()
  assert.equal(calls, 2)
})

test("live context supersedes an older response without replacing the visible data", async () => {
  let finish
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const old = training.loadTrainingContext()
  await flush()
  training.rememberLiveTrainingContext(context("live"))
  finish(json(context("old")))
  assert.equal((await old).athlete.name, "live")
  assert.equal(training.cachedTrainingContext().athlete.name, "live")
})

test("broken responses preserve the last display snapshot and cannot suppress the next retry", async () => {
  training.rememberTrainingContext(context("saved"))
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json(
      calls === 1
        ? { athlete: {}, history: null, planned: [] }
        : context("recovered")
    )
  }
  assert.equal((await training.loadTrainingContext()).athlete.name, "saved")
  assert.equal((await training.loadTrainingContext()).athlete.name, "recovered")
  assert.equal(calls, 2)
})

test("a response body timeout settles training loading and retains the prior snapshot", async (t) => {
  training.rememberTrainingContext(context("saved"))
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let networkSignal
  globalThis.fetch = async (_, options) => {
    networkSignal = options.signal
    return new Response(new ReadableStream({ start() {} }))
  }
  const request = training.loadTrainingContext()
  await flush()
  t.mock.timers.tick(20_000)
  assert.equal((await request).athlete.name, "saved")
  assert.equal(networkSignal.aborted, true)
})

test("snapshot validation handles corrupt rows, unavailable storage, and invalid athlete time zones", async () => {
  storage.set(
    "training-agent-startup-v2",
    JSON.stringify(context("saved", { history: [null] }))
  )
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  storage.set(
    "training-agent-startup-v2",
    JSON.stringify(
      context("saved", {
        athlete: { name: "timezone", time_zone: "Mars/Olympus" },
      })
    )
  )
  assert.equal(
    training.cachedTrainingContext().athlete.time_zone,
    "America/Chicago"
  )
  const original = localStorage.setItem
  localStorage.setItem = () => {
    throw new DOMException("Storage full", "QuotaExceededError")
  }
  try {
    training.rememberTrainingContext(context("memory"))
    assert.equal(training.cachedTrainingContext().athlete.name, "memory")
  } finally {
    localStorage.setItem = original
  }
})

test("component response validation rejects nested shapes that would crash the calendar or settings", () => {
  for (const patch of [
    { athlete: { name: { bad: true } } },
    { athlete: { zones: { run_threshold_pace: 720 } } },
    { athlete: { zone_history: "broken" } },
    {
      library: [
        {
          id: "library",
          sport: "Run",
          title: "Run",
          duration: "20m",
          purpose: "Easy",
          tags: { bad: true },
        },
      ],
    },
    { planned: [{ ...workout("bad"), details: { bad: true } }] },
    { cache_scope: { bad: true } },
    { display_range: { start: "2026-10-06", end: "2026-10-01" } },
  ])
    assert.throws(
      () => validatedTrainingContext(context("fixture", patch)),
      /incomplete/
    )
  assert.throws(() => validatedTrainingWorkout({ id: "saved" }), /incomplete/)
  assert.equal(validatedTrainingWorkout(workout("good")).id, "good")
  assert.equal(
    validatedTrainingContext(
      context("timezone", { athlete: { time_zone: "not-a-zone" } })
    ).athlete.time_zone,
    "America/Chicago"
  )
})

test("auth invalidation clears training memory and persisted startup data", () => {
  training.rememberTrainingContext(context("private"), "full")
  window.dispatchEvent(new Event("app-auth-required"))
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  assert.equal(storage.has("training-agent-startup-v2"), false)
})

test("invalid calendar days and corrupt numeric summaries cannot reach charts; null measurements and legacy history remain valid", () => {
  for (const patch of [
    { planned: [workout("invalid-day", "2026-02-31")] },
    { history: [{ workout_date: "2026-13-01" }] },
    { metrics: { fitness: { bad: true } } },
    { metrics: { fatigue: NaN } },
    {
      history: [
        {
          workout_date: "2026-10-01",
          completed: { duration_minutes: { bad: true } },
        },
      ],
    },
    { athlete: { zones: { bike_ftp: Infinity } } },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { planned: "broken", completed: null },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { planned: null, completed: [] },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { completed: { duration_seconds: { bad: true } } },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { completed: { average_hr: NaN } },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-duration"),
          completed_data: { duration_minutes: [] },
        },
      ],
    },
  ])
    assert.throws(
      () => validatedTrainingContext(context("fixture", patch)),
      /incomplete/
    )
  const valid = context("measurements", {
    athlete: { zones: { bike_ftp: null, threshold_hr: null } },
    metrics: { fitness: null },
    history: [
      {
        workout_date: "2024-02-29",
        planned: { tss: null },
        completed: { duration_minutes: 30 },
        recovery: { hrv: null },
      },
    ],
    planned: [
      {
        ...workout("null-values"),
        workout_summary: {
          planned: null,
          completed: { duration_seconds: null, average_hr: 0 },
        },
      },
    ],
    display_range: { start: "0000-01-01", end: "9999-12-31" },
  })
  assert.equal(validatedTrainingContext(valid).history.length, 1)
  assert.equal(
    validatedTrainingWorkout(workout("leap", "2024-02-29")).workout_date,
    "2024-02-29"
  )
})

test("calendar merges retain separate unidentified historical records and deduplicate identified workouts", () => {
  const previous = context("old", {
    history: [
      { workout_date: "2026-08-01", planned: { tss: 10 } },
      { workout_date: "2026-08-02", planned: { tss: 20 } },
      workout("same", "2026-10-01"),
    ],
  })
  const incoming = context("new", {
    history: [workout("same", "2026-10-01")],
    display_range: { start: "2026-09-01", end: "2026-10-08" },
  })
  const merged = training.mergeCalendarContext(previous, incoming)
  assert.equal(merged.history.length, 3)
  assert.deepEqual(merged.history.slice(0, 2), previous.history.slice(0, 2))
})

test("a refreshed calendar range removes deleted sessions while retaining other weeks", () => {
  const previous = context("old", {
    history: [
      workout("outside", "2026-08-01"),
      workout("deleted", "2026-10-01"),
    ],
    planned: [
      workout("moved-away", "2026-10-08"),
      workout("future", "2026-11-01"),
    ],
  })
  const incoming = context("new", {
    history: [],
    planned: [],
    display_range: { start: "2026-10-01", end: "2026-10-08" },
  })
  const merged = training.mergeCalendarContext(previous, incoming)
  assert.deepEqual(
    merged.history.map((row) => row.id),
    ["outside"]
  )
  assert.deepEqual(
    merged.planned.map((row) => row.id),
    ["future"]
  )
})

test("overlapping workout mutations cannot let an older response overwrite newer accepted context", async () => {
  training.rememberTrainingContext(context("saved"), "full")
  const finish = []
  globalThis.fetch = () => new Promise((resolve) => finish.push(resolve))
  const first = training.changeWorkout("first", "delete"),
    second = training.changeWorkout("second", "delete")
  await flush()
  finish[1](json({ verified: true, context: context("newer") }))
  await second
  finish[0](json({ verified: true, context: context("older") }))
  assert.equal((await first).context.athlete.name, "newer")
  assert.equal(training.cachedTrainingContext().athlete.name, "newer")
  assert.equal(training.trainingMutationState().busy, false)
})

test("a verified mutation without a context never clears the visible calendar", async () => {
  training.rememberTrainingContext(context("saved"), "full")
  globalThis.fetch = async () => json({ verified: true })
  await training.changeWorkout("one", "delete")
  assert.equal(training.cachedTrainingContext().athlete.name, "saved")
})

test("stalled edit, workout, and day-action bodies settle without replaying writes or clearing the calendar", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const [start, timeout] of [
    [
      () =>
        training.queueWorkoutMutation({
          type: "description",
          id: "event:1",
          description: "saved",
        }),
      65_000,
    ],
    [() => training.changeWorkout("event:1", "copy"), 180_000],
    [() => training.changeWorkoutDay("2026-10-06", "delete"), 240_000],
  ]) {
    training.rememberTrainingContext(context("saved"), "full")
    let calls = 0,
      signal
    globalThis.fetch = async (_, options) => {
      calls++
      signal = options.signal
      return new Response(new ReadableStream({ start() {} }))
    }
    const request = start()
    const rejected = assert.rejects(
      request,
      (error) =>
        error.name === "TimeoutError" &&
        /check the result before repeating/.test(error.message)
    )
    await flush()
    assert.equal(training.trainingMutationState().busy, true)
    t.mock.timers.tick(timeout)
    await rejected
    assert.equal(signal.aborted, true)
    assert.equal(training.trainingMutationState().busy, false)
    assert.equal(training.cachedTrainingContext().athlete.name, "saved")
    assert.equal(calls, 1)
  }
})

test("session reset aborts old workout writes while a new session's response remains independent", async () => {
  const finishes = [],
    signals = []
  globalThis.fetch = (_, options) => {
    signals.push(options.signal)
    return new Promise((resolve) => finishes.push(resolve))
  }
  const old = training.changeWorkout("event:1", "delete")
  const rejected = assert.rejects(old, { name: "AbortError" })
  await flush()
  window.dispatchEvent(new Event("app-auth-required"))
  const current = training.changeWorkout("event:2", "delete")
  await rejected
  await flush()
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[1].aborted, false)
  assert.equal(training.trainingMutationState().busy, true)
  finishes[1](json({ verified: true, context: context("new-session") }))
  await current
  finishes[0](json({ verified: true, context: context("old-session") }))
  await flush()
  assert.equal(training.cachedTrainingContext().athlete.name, "new-session")
  assert.equal(training.trainingMutationState().busy, false)
})

test("concurrent manual refreshes share one write and expose unresolved queue outcomes without waiting on progress", async () => {
  let finish,
    calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const statuses = []
  const first = training.refreshRecentIntervals((progress) =>
    statuses.push(progress.phase)
  )
  const second = training.refreshRecentIntervals(() => {
    throw Error("View unmounted")
  })
  await flush()
  assert.equal(calls, 1)
  finish(
    json({
      context: context("refreshed"),
      queue: { synced: 2, failed: 1, pending: 1, unknown: 1 },
      section11Sync: { status: "complete", revision: 1 },
    })
  )
  const result = await first
  assert.equal(await second, result)
  assert.equal(result.queue.unknown, 1)
  assert.equal(result.context.athlete.name, "refreshed")
  await result.githubSync
  assert.deepEqual(statuses, ["starting", "complete"])
  assert.equal(training.trainingMutationState().busy, false)
  assert.equal(calls, 1)
})

test("completed manual refresh cancels a stalled progress body immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let finish, progressSignal
  globalThis.fetch = async (path, options) => {
    const route = new URL(path, "http://fixture").searchParams.get(
      "__api_route"
    )
    if (route === "sync/progress") {
      progressSignal = options.signal
      return new Response(new ReadableStream({ start() {} }))
    }
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const request = training.refreshRecentIntervals()
  await flush()
  t.mock.timers.tick(1500)
  await flush()
  assert.equal(progressSignal.aborted, false)
  finish(
    json({
      context: context("refreshed"),
      section11Sync: { status: "complete" },
    })
  )
  const result = await request
  await result.githubSync
  assert.equal(progressSignal.aborted, true)
  assert.equal(result.context.athlete.name, "refreshed")
})

test("manual refresh body deadlines retain the calendar and permit a clean retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  training.rememberTrainingContext(context("saved"), "full")
  let signal
  globalThis.fetch = async (_, options) => {
    signal = options.signal
    return new Response(new ReadableStream({ start() {} }))
  }
  const request = training.refreshRecentIntervals()
  await flush()
  t.mock.timers.tick(240_000)
  await assert.rejects(request, { name: "TimeoutError" })
  assert.equal(signal.aborted, true)
  assert.equal(training.cachedTrainingContext().athlete.name, "saved")
  assert.equal(training.trainingMutationState().busy, false)
  globalThis.fetch = async () =>
    json({
      context: context("recovered"),
      section11Sync: { status: "complete" },
    })
  const recovered = await training.refreshRecentIntervals()
  await recovered.githubSync
  assert.equal(recovered.context.athlete.name, "recovered")
})

test("session reset during completed refresh cleanup prevents old export polling from starting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let finish
  globalThis.fetch = async (path, options) => {
    const route = new URL(path, "http://fixture").searchParams.get(
      "__api_route"
    )
    if (route === "sync/progress") {
      options.signal.addEventListener(
        "abort",
        () => window.dispatchEvent(new Event("app-auth-required")),
        { once: true }
      )
      return new Response(new ReadableStream({ start() {} }))
    }
    assert.equal(route, "sync")
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const request = training.refreshRecentIntervals()
  const rejected = assert.rejects(request, { name: "AbortError" })
  await flush()
  t.mock.timers.tick(1500)
  await flush()
  finish(
    json({
      context: context("old-session"),
      section11Sync: { status: "running" },
    })
  )
  await rejected
  assert.equal(section11ExportPending(), false)
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  assert.equal(training.trainingMutationState().busy, false)
})

test("logout invalidates a shared manual refresh without letting its finalizer cancel a new session's refresh", async () => {
  const finishes = [],
    signals = []
  globalThis.fetch = (_, options) => {
    signals.push(options.signal)
    return new Promise((resolve) => finishes.push(resolve))
  }
  const first = training.refreshRecentIntervals()
  const aborted = assert.rejects(first, { name: "AbortError" })
  await flush()
  window.dispatchEvent(new Event("app-auth-required"))
  const progress = []
  const second = training.refreshRecentIntervals((value) =>
    progress.push(value.phase)
  )
  await aborted
  await flush()
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[1].aborted, false)
  assert.equal(training.trainingMutationState().busy, true)
  const shared = training.refreshRecentIntervals()
  assert.equal(shared, second)
  finishes[1](
    json({
      context: context("new-session"),
      section11Sync: { status: "complete" },
    })
  )
  const result = await second
  await result.githubSync
  finishes[0](
    json({
      context: context("old-session"),
      section11Sync: { status: "running" },
    })
  )
  await flush()
  assert.deepEqual(progress, ["starting", "complete"])
  assert.equal(training.cachedTrainingContext().athlete.name, "new-session")
  assert.equal(training.trainingMutationState().busy, false)
  assert.equal(section11ExportPending(), false)
})

test("export status and start requests include response bodies in their deadlines", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  globalThis.fetch = async () =>
    new Response(new ReadableStream({ start() {} }))
  const waiting = waitForSection11Export({ status: "queued", revision: 2 })
  await flush()
  t.mock.timers.tick(2000)
  await flush()
  t.mock.timers.tick(15_000)
  await assert.rejects(waiting, { name: "TimeoutError" })
  const starting = syncSection11Export()
  await flush()
  t.mock.timers.tick(20_000)
  await assert.rejects(starting, { name: "TimeoutError" })
})

test("session reset cancels old export polling and cannot clear a newer export's pending flag", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let finish, signal
  globalThis.fetch = (_, options) => {
    signal = options.signal
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const old = waitForSection11Export({ status: "queued", revision: 1 })
  const rejected = assert.rejects(old, { name: "AbortError" })
  await flush()
  t.mock.timers.tick(2000)
  await flush()
  window.dispatchEvent(new Event("training-cache-reset"))
  const current = waitForSection11Export({ status: "queued", revision: 2 })
  assert.equal(section11ExportPending(), true)
  await rejected
  assert.equal(signal.aborted, true)
  finish(json({ status: "complete", revision: 1 }))
  await flush()
  assert.equal(section11ExportPending(), true)
  const currentRejected = assert.rejects(current, { name: "AbortError" })
  window.dispatchEvent(new Event("app-auth-required"))
  await currentRejected
  assert.equal(section11ExportPending(), false)
})

test("an older export completing after a new export starts cannot clear the newer pending flag", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const requests = []
  globalThis.fetch = (path) =>
    new Promise((resolve) => requests.push({ path, resolve }))
  const old = syncSection11Export("older")
  await flush()
  const current = waitForSection11Export({ status: "queued", revision: 2 })
  // The old start response arrives after a newer export began tracking.
  requests[0].resolve(
    json({ section11Sync: { status: "queued", revision: 1 } })
  )
  await flush()
  t.mock.timers.tick(2000)
  await flush()
  const olderStatus = requests.find(
    (request) =>
      new URL(request.path, "http://fixture").searchParams.get("revision") ===
      "1"
  )
  const currentStatus = requests.find(
    (request) =>
      new URL(request.path, "http://fixture").searchParams.get("revision") ===
      "2"
  )
  assert.ok(olderStatus)
  assert.ok(currentStatus)
  olderStatus.resolve(json({ status: "complete", revision: 1 }))
  await old
  assert.equal(section11ExportPending(), true)
  currentStatus.resolve(json({ status: "complete", revision: 2 }))
  await current
  assert.equal(section11ExportPending(), false)
})

test("nutrition requests share loads, reject malformed responses, and permit a clean retry", async () => {
  let calls = 0,
    finish
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = nutrition.prefetchNutrition("2026-10-06"),
    second = nutrition.prefetchNutrition("2026-10-06")
  await flush()
  assert.equal(calls, 1)
  finish(json({ date: "2026-10-06", day: { entries: null } }))
  await Promise.all([
    assert.rejects(first, /incomplete/),
    assert.rejects(second, /incomplete/),
  ])
  globalThis.fetch = async () => {
    calls++
    return json(diary())
  }
  assert.equal(
    (await nutrition.prefetchNutrition("2026-10-06")).day.revision,
    1
  )
  assert.equal(calls, 2)
  assert.equal(nutrition.cachedNutrition("2026-10-06").day.revision, 1)
})

test("nutrition optimistic totals update immediately without mutating the saved revision or duplicating a retry", () => {
  const before=diary();
  const entry={id:"food-1",name:"Banana",meal:"breakfast",quantity:1,unit:"banana",calories:105,protein:1,carbs:27,fat:0,fiber:3,source:"manual",notes:"",barcode:null,imageUrl:null};
  const added=projectNutritionChange(before,"add",[entry]);
  assert.equal(added.day.revision,before.day.revision);
  assert.equal(added.day.entries.length,before.day.entries.length+1);
  assert.equal(before.day.entries.length,0);
  assert.equal(projectNutritionChange(added,"add",[entry]).day.entries.length,added.day.entries.length);
  const updated=projectNutritionChange(added,"update",[{...entry,calories:210}]);
  assert.equal(updated.day.entries[0].calories,210);
  assert.equal(projectNutritionChange(updated,"delete",[],entry.id).day.entries.length,0);
});

test("a nutrition write invalidates an older read so it cannot overwrite the local log", async()=>{
  window.dispatchEvent(new Event("training-cache-reset"));setApiAuthenticated(true);
  let finish;
  globalThis.fetch=()=>new Promise(resolve=>{finish=resolve});
  const stale=nutrition.prefetchNutrition("2026-10-06");
  await flush();
  nutrition.beginNutritionWrite();
  finish(json(diary()));
  await assert.rejects(stale,{name:"AbortError"});
  assert.equal(nutrition.cachedNutrition("2026-10-06"),null);
});

test("late nutrition results after logout cannot repopulate any startup or memory cache", async () => {
  let finish
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const old = nutrition.prefetchNutrition("2026-10-06")
  await flush()
  window.dispatchEvent(new Event("app-auth-required"))
  finish(json(diary()))
  await assert.rejects(old, { name: "AbortError" })
  assert.equal(nutrition.cachedNutrition("2026-10-06"), null)
  assert.equal(storage.has("training-agent-nutrition-startup-v1"), false)
})

test("caller-supplied nutrition cancellation still has a whole-body timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const caller = new AbortController()
  let networkSignal
  globalThis.fetch = async (_, options) => {
    networkSignal = options.signal
    return new Response(new ReadableStream({ start() {} }))
  }
  const request = nutrition.nutritionRequest(
    "?date=2026-10-06",
    undefined,
    caller.signal
  )
  await flush()
  t.mock.timers.tick(22_000)
  await assert.rejects(request, { name: "TimeoutError" })
  assert.equal(networkSignal.aborted, true)
  assert.equal(caller.signal.aborted, false)
})

const answer = {
  text: "Ready café 🚲",
  model: "fixture",
  source: {
    dataRevision: "a",
    protocolRevision: "b",
    lastSynced: null,
    checkedAt: "now",
    freshness: "recent",
  },
}
const event = (name, data) =>
  `event:${name}\r\ndata:${JSON.stringify(data)}\r\n\r\n`
function streamResponse(text, { close = true } = {}) {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        if (close) controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  )
}

test("coach streaming handles CRLF, one-byte UTF-8 chunks, and completion before the socket closes", async () => {
  globalThis.fetch = async () =>
    streamResponse(
      event("status", { text: "Thinking" }) +
        event("token", { text: "café 🚲" }) +
        event("answer", answer),
      { close: false }
    )
  const statuses = [],
    tokens = []
  assert.deepEqual(
    await askCoach(
      [],
      new AbortController().signal,
      (text) => statuses.push(text),
      (text) => tokens.push(text)
    ),
    answer
  )
  assert.deepEqual(statuses, ["Thinking"])
  assert.deepEqual(tokens, ["café 🚲"])
})

test("coach streaming accepts a complete final answer at EOF and ignores unknown heartbeat payloads", async () => {
  globalThis.fetch = async () =>
    streamResponse(
      `event: heartbeat\ndata: ping\n\n` +
        `event: answer\ndata: ${JSON.stringify(answer)}`
    )
  assert.deepEqual(
    await askCoach([], new AbortController().signal, () => {}),
    answer
  )
})

test("malformed coach events and interrupted streams leave a clear retry error", async () => {
  globalThis.fetch = async () =>
    streamResponse("event: answer\ndata: {broken}\n\n")
  await assert.rejects(
    askCoach([], new AbortController().signal, () => {}),
    /incomplete response/
  )
  globalThis.fetch = async () =>
    streamResponse(event("status", { text: "Thinking" }))
  await assert.rejects(
    askCoach([], new AbortController().signal, () => {}),
    /ready to retry/
  )
})

test("aborting a stalled coach stream cancels its reader and settles promptly", async () => {
  let canceled = false
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start() {},
        cancel() {
          canceled = true
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    )
  const controller = new AbortController()
  const request = askCoach([], controller.signal, () => {})
  await flush()
  controller.abort()
  await assert.rejects(request, { name: "AbortError" })
  assert.equal(canceled, true)
})
