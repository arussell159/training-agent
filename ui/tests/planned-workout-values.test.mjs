import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlannedValue, parsePlannedValue, plannedValueDraft, changedPlannedValues, mergeLoadedPlannedDraft, updatePlannedValueDraft } from "../src/lib/planned-workout-values.ts";
import { builderBlock, desktopBuilderBlocks, displayTarget, desktopTargetPresentation, desktopBuilderTotals, desktopProfileRange, desktopProfileDropSlot, resizeDesktopRamp, changeDesktopTargetShape, changeDesktopTargetUnit, changeDesktopStepLength, duplicateDesktopBlock, desktopPaletteDropIndex, readDesktopBuilderPreferences, rememberDesktopBuilderPreferences } from "../src/lib/desktop-workout-builder.ts";
import { desktopWorkoutDescription } from "../src/lib/desktop-workout-description.ts";
import { validateWorkout, workoutTotals, moveNode, insertNodes, newStep, newRepeat, walkNodes, expandSteps, chartSegments, serializeWorkout, readEditorModel, verifyParsedWorkout } from "../../app-backend/lib/workout-editor-model.mjs";
import { parseTestWorkout } from "../../app-backend/lib/fixtures/workout-editor-fixtures.mjs";
import { fakeProvider, fixtureEvent } from "../../app-backend/lib/fixtures/workout-editor-fixtures.mjs";
import { loadWorkoutEditor, saveWorkoutEditor } from "../../app-backend/lib/workout-editor.mjs";
import { readPendingWorkoutCreation, rememberPendingWorkoutCreation, clearPendingWorkoutCreation } from "../src/lib/pending-workout-creation.ts";
import { readWorkoutSaveDraft, retainWorkoutSaveDraft, clearWorkoutSaveDraft, validPlannedSaveDraft, validTextSaveDraft } from "../src/lib/workout-save-drafts.ts";
import { simpleWorkoutModel } from "../../app-backend/lib/simple-workout.mjs";

test("three miles at 10:30 per mile immediately derives 31:30 in either entry order", () => {
  for (const entries of [[["distance_meters","3"],["average_speed","10:30"]],[["average_speed","10:30"],["distance_meters","3"]]]) {
    let draft=plannedValueDraft(null,"Run");
    for(const [key,value] of entries) draft=updatePlannedValueDraft(draft,key,value,"Run");
    assert.equal(draft.duration_seconds,"0:31:30");
    assert.equal(draft.distance_meters,"3");
    assert.equal(draft.average_speed,"10:30");
    const saved=changedPlannedValues(draft,plannedValueDraft(null,"Run"),"Run");
    assert.equal(saved.duration_seconds,1890);
    assert.equal(saved.distance_meters,3*1609.344);
    assert.equal(saved.average_speed,1609.344/630);
  }
});

test("editing distance, pace or duration recalculates the corresponding third value",()=>{
  const initial={...plannedValueDraft(null,"Run"),duration_seconds:"0:31:30",distance_meters:"3",average_speed:"10:30"};
  assert.equal(updatePlannedValueDraft(initial,"distance_meters","4","Run").duration_seconds,"0:42:00");
  assert.equal(updatePlannedValueDraft(initial,"average_speed","10:00","Run").duration_seconds,"0:30:00");
  assert.equal(updatePlannedValueDraft(initial,"duration_seconds","0:30:00","Run").average_speed,"10:00");
  assert.deepEqual(initial,{...plannedValueDraft(null,"Run"),duration_seconds:"0:31:30",distance_meters:"3",average_speed:"10:30"});
});

test("calculated duration is exported as a native duration step, not just a displayed estimate",()=>{
  const draft=updatePlannedValueDraft({...plannedValueDraft(null,"Run"),distance_meters:"3"},"average_speed","10:30","Run");
  const values=changedPlannedValues(draft,plannedValueDraft(null,"Run"),"Run");
  const model=simpleWorkoutModel({name:"Zone 2 run",sport:"Run",date:"2026-10-20",values});
  assert.deepEqual(validateWorkout(model),[]);
  assert.equal(model.steps[0].end.kind,"time");
  assert.equal(model.steps[0].end.value,1890);
  assert.equal(workoutTotals(model).seconds,1890);
});

test("duration plus pace derives distance, duration plus distance derives pace, including short duration entry",()=>{
  let draft={...plannedValueDraft(null,"Run"),duration_seconds:"31:30"};
  draft=updatePlannedValueDraft(draft,"average_speed","10:30","Run");
  assert.equal(draft.distance_meters,"3");
  assert.equal(draft.duration_seconds,"31:30");
  assert.equal(updatePlannedValueDraft({...plannedValueDraft(null,"Run"),duration_seconds:"0:31:30"},"distance_meters","3","Run").average_speed,"10:30");
});

test("planned swim yards and cycling mph calculate in their own displayed units",()=>{
  const swim=updatePlannedValueDraft({...plannedValueDraft(null,"Swim"),distance_meters:"1000"},"average_speed","1:40","Swim");
  assert.equal(swim.duration_seconds,"0:16:40");
  const bike=updatePlannedValueDraft({...plannedValueDraft(null,"Ride"),distance_meters:"20"},"average_speed","20","Ride");
  assert.equal(bike.duration_seconds,"1:00:00");
});

test("incomplete typing, clearing, zero pace, and an excessive duration never overwrite other inputs",()=>{
  const draft={...plannedValueDraft(null,"Run"),duration_seconds:"0:31:30",distance_meters:"3",average_speed:"10:30"};
  for(const text of ["","1:","0:00","NaN","-1:00","10:99"]){
    assert.deepEqual(updatePlannedValueDraft(draft,"average_speed",text,"Run"),{...draft,average_speed:text});
  }
  assert.deepEqual(updatePlannedValueDraft(draft,"distance_meters","1000000","Run"),{...draft,distance_meters:"1000000"});
  assert.deepEqual(updatePlannedValueDraft(draft,"average_speed","9:00","Run",false),{...draft,average_speed:"9:00"});
  assert.deepEqual(updatePlannedValueDraft(draft,"calories","300","Run"),{...draft,calories:"300"});
});

test("closed-popup drafts keep comment identities, isolate accounts and remove only confirmed portions",()=>{
  globalThis.localStorage=creationStorage();
  const text={description:"Zone 2",comment:"Keep it easy",creationId:"same-comment"};
  const token=retainWorkoutSaveDraft("closed-athlete-a","event:9","text",text);
  const totals=retainWorkoutSaveDraft("closed-athlete-a","event:9","totals",{values:{duration_seconds:1890},metadata:{name:"Zone 2 run"}});
  assert.deepEqual(readWorkoutSaveDraft("closed-athlete-a","event:9","text").value,text);
  assert.equal(readWorkoutSaveDraft("closed-athlete-b","event:9","text"),undefined);
  clearWorkoutSaveDraft("closed-athlete-a","event:9","totals",totals);
  assert.equal(readWorkoutSaveDraft("closed-athlete-a","event:9","totals"),undefined);
  assert.equal(readWorkoutSaveDraft("closed-athlete-a","event:9","text").token,token);
  const newer=retainWorkoutSaveDraft("closed-athlete-a","event:9","text",{...text,comment:"A newer draft"});
  clearWorkoutSaveDraft("closed-athlete-a","event:9","text",token);
  assert.equal(readWorkoutSaveDraft("closed-athlete-a","event:9","text").token,newer);
  clearWorkoutSaveDraft("closed-athlete-a","event:9","text",newer);
  assert.equal(readWorkoutSaveDraft("closed-athlete-a","event:9","text"),undefined);
});

test("closed-popup drafts survive unavailable storage and a stale disk copy cannot replace the newest input",()=>{
  const storage=creationStorage();globalThis.localStorage=storage;
  retainWorkoutSaveDraft("storage-failure","event:10","text",{comment:"Old"});
  storage.setItem=()=>{throw Error("Quota exceeded")};
  const token=retainWorkoutSaveDraft("storage-failure","event:10","text",{comment:"Retain this"});
  assert.equal(readWorkoutSaveDraft("storage-failure","event:10","text").value.comment,"Retain this");
  storage.removeItem=()=>{throw Error("Unavailable")};
  clearWorkoutSaveDraft("storage-failure","event:10","text",token);
  assert.equal(readWorkoutSaveDraft("storage-failure","event:10","text"),undefined);
});

test("damaged recovery records cannot populate workout inputs",()=>{
  globalThis.localStorage=creationStorage();
  for(const value of [{values:null,metadata:{}},{values:{duration_seconds:"bad"},metadata:{}},{values:{duration_seconds:NaN},metadata:{}},{values:{},metadata:{name:{bad:true}}}]){
    retainWorkoutSaveDraft("damaged", "event:11", "totals",value);
    assert.equal(readWorkoutSaveDraft("damaged","event:11","totals",validPlannedSaveDraft),undefined);
  }
  retainWorkoutSaveDraft("damaged","event:11","text",{comment:123,creationId:"same"});
  assert.equal(readWorkoutSaveDraft("damaged","event:11","text",validTextSaveDraft),undefined);
});

test("a definitively rejected creation restores an editable draft without losing its identity",()=>{
  const storage=creationStorage(),input={...pendingCreation(),reconcileOnly:false};
  rememberPendingWorkoutCreation(storage,"rejected",input);
  assert.deepEqual(readPendingWorkoutCreation(storage,"rejected"),input);
  clearPendingWorkoutCreation(storage,"rejected",input.creationId);
  assert.equal(readPendingWorkoutCreation(storage,"rejected"),null);
});

test("typing before the provider read completes survives while untouched fields refresh", () => {
  const initial = plannedValueDraft({ duration_seconds: 1800, calories: 200 }, "Run")
  const typed = { ...initial, duration_seconds: "0:45:00", distance_meters: "5" }
  const remote = plannedValueDraft({ duration_seconds: 2100, calories: 250 }, "Run")
  const merged = mergeLoadedPlannedDraft(typed, initial, remote)
  assert.equal(merged.duration_seconds, "0:45:00")
  assert.equal(merged.distance_meters, "5")
  assert.equal(merged.calories, "250")
  assert.deepEqual(changedPlannedValues(merged, remote, "Run"), { duration_seconds: 2700, distance_meters: 8046.72 })
})
test("duration and pace formats use explicit units and reject invalid clocks", () => {
  assert.equal(formatPlannedValue("duration_seconds", 3720, "Run"), "1:02:00");
  assert.equal(parsePlannedValue("duration_seconds", "1:02:00", "Run"), 3720);
  assert.equal(parsePlannedValue("average_speed", "10:12", "Run"), 1609.344 / 612);
  for (const text of ["1:60:00", "-1", "abc", "1:2"]) assert.throws(() => parsePlannedValue("duration_seconds", text, "Run"));
  assert.throws(() => parsePlannedValue("average_speed", "0:00", "Run"));
});
test("distance and elevation convert miles/feet; planned yards differ from recorded metres", () => {
  assert.equal(parsePlannedValue("distance_meters", "6.07", "Run"), 6.07 * 1609.344);
  assert.equal(parsePlannedValue("elevation_gain", "100", "Run"), 30.48);
  assert.equal(formatPlannedValue("elevation_gain", 30.48, "Run"), "100");
  assert.equal(formatPlannedValue("distance_meters", 914.4, "Swim", true), "1000");
  assert.equal(parsePlannedValue("distance_meters", "1000", "Swim"), 1000);
  assert.equal(parsePlannedValue("average_speed", "1:40", "Swim"), 1);
});
test("only edited fields are sent; blank clears while zero is retained", () => {
  const saved = plannedValueDraft({ duration_seconds: 3720, distance_meters: 9770.76543, calories: 450, intensity_factor: .87543 }, "Run");
  const draft = { ...saved, calories: "", tss: "0" };
  assert.deepEqual(changedPlannedValues(draft, saved, "Run"), { calories: null, tss: 0 });
  assert.throws(() => parsePlannedValue("tss", "4.2", "Run"));
  assert.throws(() => parsePlannedValue("intensity_factor", "5.1", "Run"));
});

test('bike speed uses mph while run and swim use pace',()=>{
 assert.equal(formatPlannedValue('average_speed',7.15264,'Bike'),'16.0');
 assert.ok(Math.abs(parsePlannedValue('average_speed','16.0','Bike')-7.15264)<1e-5);
});

test("switching builder sports treats newly introduced blank fields as unchanged", () => {
  for (const [from, to] of [["Run", "Ride"], ["Ride", "Run"], ["Run", "Swim"]]) {
    const draft = { ...plannedValueDraft(null, from), duration_seconds: "0:05:00" };
    assert.deepEqual(changedPlannedValues(draft, plannedValueDraft(null, to), to), {
      duration_seconds: 300,
    });
  }
});

test("all desktop palette blocks retain valid native prescriptions for each calendar sport", () => {
  for (const sport of ["Run", "Ride", "Swim", "Other", "WeightTraining"]) {
    const model = {version:1, name:"Builder", sport, date:"2026-10-16", notes:"", poolLength:sport === "Swim" ? "25y" : "", steps:[], thresholds:{ftp:250,pace:3}};
    for (const name of desktopBuilderBlocks) {
      const steps = builderBlock(name, model, /Run|Swim/.test(sport) ? "%pace" : "%ftp", "range");
      assert.deepEqual(validateWorkout({...model,steps}), [], `${sport}: ${name}`);
      assert.ok(workoutTotals({...model,steps}).executedSteps > 0);
      if (/Repeats/.test(name)) assert.equal(steps[0].repetitions, name.startsWith("Two") ? 4 : 3);
      if (/Other|WeightTraining/.test(sport)) assert.equal(steps[0].kind === "repeat" ? steps[0].steps[0].target.kind : steps[0].target.kind, "none");
    }
  }
});

test("desktop profile reordering preserves complete steps and repeat sets at either end", () => {
  const model = {version:1, name:"Reorder", sport:"Run", date:"2026-10-16", notes:"", poolLength:"", steps:[], thresholds:{pace:3}};
  const original = ["Warm up", "Two Step Repeats", "Cool down"].flatMap(name => builderBlock(name, model, "%pace", "range"));
  original[1].steps[0].notes = "Keep this prescription";
  const frozen = structuredClone(original);
  const blocks = original.map((node, i) => ({id:node.id, width:[600,720,600][i]}));
  for (const [id, position, order] of [
    [original[1].id, -.1, [1,0,2]],
    [original[1].id, 1.1, [0,2,1]],
    [original[0].id, 1, [1,2,0]],
    [original[2].id, 0, [2,0,1]],
  ]) {
    const drop = desktopProfileDropSlot(blocks,id,position);
    assert.ok(drop);
    assert.ok(drop.position >= 0 && drop.position <= 1);
    const moved = moveNode(original,id,null,drop.index);
    assert.deepEqual(moved,order.map(index=>frozen[index]));
    assert.deepEqual(workoutTotals({...model,steps:moved}),workoutTotals({...model,steps:original}));
    assert.deepEqual(validateWorkout({...model,steps:moved}),[]);
  }
  assert.deepEqual(original,frozen);
});

test("desktop block presets match the observed TrainingPeaks duration and range defaults",()=>{
  const model={version:1,name:"Desktop presets",sport:"Run",date:"2026-10-20",notes:"",poolLength:"",steps:[],thresholds:{pace:3}};
  for(const [name,seconds,low,high] of [["Warm up",1200,70,80],["Active",600,105,115],["Recovery",300,75,85],["Cool down",600,70,80]]){
    const [step]=builderBlock(name,model,"%pace","range",{kind:"time",unit:"s"});
    assert.equal(step.end.value,seconds);assert.equal(step.target.start,low);assert.equal(step.target.end,high);
  }
  const [two]=builderBlock("Two Step Repeats",model,"%pace","range",{kind:"time",unit:"s"});
  assert.equal(two.repetitions,4);assert.deepEqual(two.steps.map(step=>step.end.value),[360,180]);
  const [three]=builderBlock("Three Step Repeats",model,"%pace","range",{kind:"time",unit:"s"});
  assert.equal(three.repetitions,3);assert.deepEqual(three.steps.map(step=>step.end.value),[180,60,60]);
  const [up]=builderBlock("Ramp Up",model,"%pace","range",{kind:"time",unit:"s"});
  const [down]=builderBlock("Ramp Down",model,"%pace","range",{kind:"time",unit:"s"});
  assert.equal(up.repetitions,1);assert.deepEqual(up.steps.map(step=>step.target.start),[75,85,95,105]);
  assert.deepEqual(down.steps.map(step=>step.target.start),[105,95,85,75]);
  assert.equal(workoutTotals({...model,steps:[two]}).seconds,2160);
});

test("distance builder choices generate valid native distance steps throughout repeats and ramps",()=>{
  const model={version:1,name:"Distance presets",sport:"Run",date:"2026-10-20",notes:"",poolLength:"",steps:[],thresholds:{pace:3}};
  for(const unit of ["m","km","mi","yd"]){
    for(const name of desktopBuilderBlocks){
      const steps=builderBlock(name,model,"%pace","range",{kind:"distance",unit});
      assert.deepEqual(validateWorkout({...model,steps}),[],`${name} ${unit}`);
      const leaves=steps.flatMap(node=>node.kind==="step"?[node]:node.steps);
      assert.ok(leaves.every(step=>step.end.kind==="distance"&&step.end.unit===unit&&step.end.value>0));
    }
  }
  const [warmup]=builderBlock("Warm up",model,"%pace","range",{kind:"distance",unit:"km"});
  assert.equal(warmup.end.value,3);
  const [durationSwim]=builderBlock("Warm up",{...model,sport:"Swim",poolLength:"25y"},"%pace","range",{kind:"time",unit:"s"});
  assert.equal(durationSwim.end.kind,"time");assert.equal(durationSwim.end.value,1200);
});

test("desktop power and heart-rate presets use the observed ranges rather than running pace percentages",()=>{
  const model={version:1,name:"Cycling presets",sport:"Ride",date:"2026-10-20",notes:"",poolLength:"",steps:[]};
  for(const unit of ["%ftp","%hr","%lthr"]){
    for(const [name,low,high] of [["Warm up",40,50],["Active",70,80],["Recovery",50,60],["Cool down",40,50]]){
      const [step]=builderBlock(name,model,unit,"range",{kind:"time",unit:"s"});
      assert.equal(step.target.start,low);assert.equal(step.target.end,high);
    }
    const [two]=builderBlock("Two Step Repeats",model,unit,"range");
    assert.deepEqual(two.steps.map(step=>[step.target.start,step.target.end]),[[85,95],[50,60]]);
    const [three]=builderBlock("Three Step Repeats",model,unit,"range");
    assert.deepEqual(three.steps.map(step=>[step.target.start,step.target.end]),[[75,85],[90,100],[50,60]]);
    const [up]=builderBlock("Ramp Up",model,unit,"range");
    assert.deepEqual(up.steps.map(step=>step.target.start),[55,65,75,85]);
  }
});

test("desktop duration and distance presets retain every prescribed step through provider parsing and editor reopen", () => {
  const base={version:1,name:"Desktop roundtrip",sport:"Run",date:"2026-10-20",notes:"",poolLength:"",thresholds:{pace:3}};
  for(const mode of ["range","single"]){
    for(const length of [{kind:"time",unit:"s"},{kind:"distance",unit:"km"},{kind:"distance",unit:"mi"}]){
      const model={...base,steps:desktopBuilderBlocks.flatMap(name=>builderBlock(name,base,"%pace",mode,length))};
      const description=serializeWorkout(model);
      const persisted=structuredClone(model);delete persisted.thresholds;
      assert.deepEqual(readEditorModel(description),persisted);
      assert.deepEqual(verifyParsedWorkout(model,{workout_doc:parseTestWorkout(description)}),[],`${length.unit} ${mode}`);
    }
  }
});

test("desktop stepped ramp resizing matches the observed interpolation without repeating its stages",()=>{
  const base={version:1,name:"Ramp stages",sport:"Run",date:"2026-10-21",notes:"",poolLength:"",steps:[]};
  for(const length of [{kind:"time",unit:"s"},{kind:"distance",unit:"km"}]){
    const [ramp]=builderBlock("Ramp Up",base,"%pace","range",length);
    ramp.steps[0].notes="Start relaxed";ramp.steps.at(-1).notes="Finish controlled";
    const original=structuredClone(ramp),six=resizeDesktopRamp(ramp,6);
    assert.equal(six.repetitions,1);assert.equal(six.sets,1);
    assert.deepEqual(six.steps.map(step=>step.target.start),[75,81,87,93,99,105]);
    assert.deepEqual(six.steps.map(step=>step.target.end),[85,91,97,103,109,115]);
    assert.equal(new Set(six.steps.map(step=>step.id)).size,6);
    assert.equal(six.steps[0].notes,"Start relaxed");assert.equal(six.steps.at(-1).notes,"Finish controlled");
    assert.deepEqual(ramp,original);
    const model={...base,steps:[six]},description=serializeWorkout(model);
    assert.deepEqual(readEditorModel(description),model);
    assert.deepEqual(verifyParsedWorkout(model,{workout_doc:parseTestWorkout(description)}),[]);
    if(length.kind === "time")assert.equal(workoutTotals(model).seconds,1080);
    else assert.equal(workoutTotals(model).distance,6000);
    const two=resizeDesktopRamp(six,2);
    assert.deepEqual(two.steps.map(step=>step.target.start),[75,105]);
  }
});

test("a resized desktop ramp is written once to the provider and its native stages survive verified reload",async()=>{
  const provider=fakeProvider(fixtureEvent("Run"));
  const loaded=await loadWorkoutEditor(provider.request,"event:100");
  const [ramp]=builderBlock("Ramp Up",loaded.model,"%pace","range",{kind:"time",unit:"s"});
  loaded.model.steps=[resizeDesktopRamp(ramp,6)];
  const saved=await saveWorkoutEditor(provider.request,"event:100",{model:loaded.model,revision:loaded.revision,values:{duration_seconds:1080},time:"06:30"});
  assert.equal(saved.verified,true);
  assert.equal(provider.calls.filter(call=>call.method === "PUT").length,1);
  assert.equal(saved.event.workout_doc.duration,1080);
  assert.deepEqual(saved.event.workout_doc.steps[0].steps.map(step=>step.pace.start),[75,81,87,93,99,105]);
  const reopened=await loadWorkoutEditor(provider.request,"event:100");
  assert.equal(reopened.model.steps[0].steps.length,6);
  assert.equal(reopened.model.steps[0].repetitions,1);
  assert.equal(reopened.model.steps[0].steps.at(-1).target.end,115);
});

test("ramp stage counts reject invalid input and incompatible endpoint prescriptions",()=>{
  const base={version:1,name:"Ramp",sport:"Ride",date:"2026-10-21",notes:"",poolLength:"",steps:[]};
  const [ramp]=builderBlock("Ramp Down",base,"%ftp","single",{kind:"time",unit:"s"});
  const six=resizeDesktopRamp(ramp,6);
  assert.deepEqual(six.steps.map(step=>step.target.value),[90,84,78,72,66,60]);
  for(const count of [0,1,1.5,101,NaN])assert.throws(()=>resizeDesktopRamp(ramp,count));
  const malformed=structuredClone(ramp);malformed.steps.at(-1).target={kind:"none"};
  assert.throws(()=>resizeDesktopRamp(malformed,6),/same target type/);
  assert.throws(()=>resizeDesktopRamp({...ramp,label:"Repeats"},6),/stepped ramp/);
});

test("desktop drops insert before the whole hovered block, including its latter half", () => {
  const blocks = [{id:"warmup",width:600},{id:"repeat",width:720},{id:"cooldown",width:600}];
  for (const fraction of [600/1920,900/1920,1320/1920,1919/1920]) assert.equal(desktopProfileDropSlot(blocks,"repeat",fraction),null);
  assert.equal(desktopProfileDropSlot(blocks,"repeat",599/1920).index,0);
  assert.equal(desktopProfileDropSlot(blocks,"repeat",1).index,3);
  assert.equal(desktopProfileDropSlot(blocks,"cooldown",1319/1920).index,1);
  assert.equal(desktopPaletteDropIndex(blocks,599/1920),0);
  assert.equal(desktopPaletteDropIndex(blocks,1319/1920),1);
  assert.equal(desktopPaletteDropIndex(blocks,1919/1920),2);
  assert.equal(desktopPaletteDropIndex(blocks,1),3);
  assert.equal(desktopPaletteDropIndex([{width:1200}],.96),0);
  assert.equal(desktopProfileDropSlot(blocks,"warmup",0),null);
  assert.equal(desktopProfileDropSlot(blocks,"cooldown",1),null);
  assert.equal(desktopProfileDropSlot(blocks,"missing",.5),null);
  assert.equal(desktopProfileDropSlot([],"missing",.5),null);
  assert.equal(desktopProfileDropSlot(blocks,"repeat",NaN),null);
  assert.equal(desktopProfileDropSlot([{id:"only",width:300}],"only",1),null);
});

function profileDragFixture() {
  const step = (role, seconds, changes = {}) => ({
    ...newStep("Ride", role),
    end: {kind:"time", unit:"s", value:seconds},
    ...changes,
  });
  const nested = {
    ...newRepeat([step("active", 120, {
      label:"Controlled ramp",
      notes:"Hold form through the complete ramp",
      target:{kind:"power", unit:"%ftp", mode:"ramp", start:75, end:110},
      cadence:{start:82, end:94},
      end:{kind:"time", unit:"s", value:120, pressLap:true},
    })]),
    repetitions:2,
    finalRecovery:false,
    recovery:step("rest", 10),
  };
  const repeat = {
    ...newRepeat([
      nested,
      step("active", 45, {
        label:"Finish strong",
        notes:"Keep this range and cadence",
        target:{kind:"power", unit:"%ftp", mode:"range", start:105, end:115},
        cadence:{start:90, end:100},
      }),
    ]),
    label:"Two sets with nested repeats",
    notes:"Recover only between repetitions and sets",
    repetitions:3,
    sets:2,
    finalRecovery:false,
    recovery:step("recovery", 30),
    setRecovery:step("rest", 90),
  };
  return {
    version:1, name:"Profile drag preservation", sport:"Ride", date:"2026-10-20",
    notes:"Keep the workout instructions", poolLength:"", thresholds:{ftp:250, pace:3.2},
    steps:[
      step("warmup", 420),
      repeat,
      step("active", 120, {
        label:"Distance with lap ending",
        notes:"The distance must stay in metres",
        end:{kind:"distance", unit:"m", value:400, pressLap:true},
        target:{kind:"pace", unit:"secs/km", mode:"single", value:300},
      }),
      step("cooldown", 260),
    ],
  };
}

function profileRootBlocks(model) {
  const {segments} = chartSegments(model);
  return model.steps.map(root => {
    const ids = new Set();
    walkNodes([root], node => ids.add(node.id));
    return {
      id:root.id,
      width:segments.filter(segment => ids.has(segment.step.id)).reduce((sum, segment) => sum + segment.width, 0),
    };
  });
}

test("profile boundary moves retain nested sets, recoveries and every prescription without flattening", () => {
  const model = profileDragFixture(), original = structuredClone(model);
  assert.deepEqual(validateWorkout(model), []);
  const blocks = profileRootBlocks(model), total = blocks.reduce((sum, block) => sum + block.width, 0);
  const boundaries = [0];
  for (const block of blocks) boundaries.push(boundaries.at(-1) + block.width);
  for (let source = 0; source < model.steps.length; source++) {
    for (let boundary = 0; boundary <= model.steps.length; boundary++) {
      const drop = desktopProfileDropSlot(blocks, model.steps[source].id, boundaries[boundary] / total);
      if (boundary === source || boundary === source + 1) {
        assert.equal(drop, null, `moving ${source} to its existing neighbours is a no-op`);
        continue;
      }
      assert.equal(drop?.index, boundary);
      assert.equal(drop.position, boundaries[boundary] / total);
      const expected = [...original.steps];
      const [picked] = expected.splice(source, 1);
      expected.splice(boundary - Number(source < boundary), 0, picked);
      const moved = {...model, steps:moveNode(model.steps, model.steps[source].id, null, drop.index)};
      assert.deepEqual(moved.steps, expected, `source ${source}, boundary ${boundary}`);
      assert.deepEqual(expandSteps(moved.steps), expected.flatMap(node => expandSteps([node])));
      assert.deepEqual(validateWorkout(moved), []);
      assert.deepEqual(workoutTotals(moved), workoutTotals(model));
    }
  }
  assert.deepEqual(model, original);
});

test("palette drops insert the same complete payload only between root blocks at every boundary", () => {
  const model = profileDragFixture(), original = structuredClone(model);
  const blocks = profileRootBlocks(model), total = blocks.reduce((sum, block) => sum + block.width, 0);
  const boundaries = [0];
  for (const block of blocks) boundaries.push(boundaries.at(-1) + block.width);
  for (const name of ["Active", "Two Step Repeats", "Three Step Repeats", "Ramp Up"]) {
    // Generate once at drag start: the preview and committed insert share these IDs and values.
    const pending = builderBlock(name, model, "%ftp", "range", {kind:"time", unit:"s"});
    walkNodes(pending, node => {
      node.notes = `Preserve ${name} instructions`;
      if (node.kind === "step") {
        node.cadence = {start:85, end:95};
        node.end.pressLap = true;
      }
    });
    const snapshot = structuredClone(pending);
    for (let boundary = 0; boundary <= model.steps.length; boundary++) {
      const index = desktopPaletteDropIndex(blocks, boundaries[boundary] / total);
      assert.equal(index, boundary);
      const inserted = {...model, steps:insertNodes(model.steps, null, index, pending)};
      assert.deepEqual(inserted.steps, [
        ...original.steps.slice(0, boundary), ...snapshot, ...original.steps.slice(boundary),
      ]);
      assert.equal(inserted.steps[index], pending[0]);
      assert.deepEqual(validateWorkout(inserted), []);
      const persisted = structuredClone(inserted);
      delete persisted.thresholds;
      assert.deepEqual(readEditorModel(serializeWorkout(inserted)), persisted);
    }
    assert.deepEqual(pending, snapshot);
  }
  assert.deepEqual(model, original);
});

test("zoomed and panned screen positions select the same root insertion slots as the full profile", () => {
  const blocks = [{id:"warmup", width:1200}, {id:"repeats", width:2160}, {id:"cooldown", width:600}];
  const viewportLeft = 49, viewportWidth = 900;
  for (const {zoom, scroll, offset, root} of [
    {zoom:1, scroll:0, offset:0, root:0},
    {zoom:2, scroll:450, offset:1, root:0},
    {zoom:2, scroll:450, offset:100, root:1},
    {zoom:2, scroll:450, offset:899, root:1},
    {zoom:5, scroll:3600, offset:1, root:1},
    {zoom:5, scroll:3600, offset:899, root:2},
    {zoom:5, scroll:3600, offset:900, root:3},
  ]) {
    const svgLeft = viewportLeft - scroll, fullWidth = viewportWidth * zoom;
    const fraction = (viewportLeft + offset - svgLeft) / fullWidth;
    assert.equal(desktopPaletteDropIndex(blocks, fraction), root);
    const drop = desktopProfileDropSlot(blocks, "cooldown", fraction);
    if (root >= 2) assert.equal(drop, null);
    else assert.equal(drop?.index, root);
  }
});

test("desktop display-unit conversion preserves the original target and real threshold pace", () => {
  const target = {kind:"pace",unit:"secs/mi",mode:"single",value:600};
  const model = {sport:"Run",thresholds:{pace:1609.344/500}};
  assert.equal(displayTarget(target,"%pace",model).value, 500/600*100);
  const relative = {kind:"pace",unit:"%pace",mode:"single",value:80};
  assert.equal(displayTarget(relative,"secs/mi",model).value, 625);
  assert.equal(target.value,600);
  assert.throws(()=>displayTarget(target,"w",model));
  assert.throws(()=>displayTarget(relative,"secs/mi",{sport:"Run",thresholds:{}}));
});

test("desktop target presentation displays reciprocal pace bounds and the configured zone without changing targets", () => {
  const target = Object.freeze({kind:"pace",unit:"%pace",mode:"range",start:105,end:115});
  const model = {sport:"Run",thresholds:{pace:1609.344/530}};
  const zones = [{types:["Run"],threshold_pace:1609.344/530,pace_zones:[75,85,95,105,999]}];
  assert.deepEqual(desktopTargetPresentation(target,model,zones),{zoneId:"5",physical:"07:41-08:25 min/mi"});
  assert.deepEqual(target,{kind:"pace",unit:"%pace",mode:"range",start:105,end:115});
  assert.deepEqual(desktopTargetPresentation({kind:"pace",unit:"secs/mi",mode:"single",value:600},model,zones),{zoneId:"3",physical:""});
  assert.deepEqual(desktopTargetPresentation({kind:"pace",unit:"pace_zone",mode:"single",value:5},model,zones),{zoneId:"5",physical:""});
});

test("desktop target presentation uses sport thresholds and keeps missing physical targets unknown", () => {
  assert.deepEqual(
    desktopTargetPresentation({kind:"power",unit:"%ftp",mode:"range",start:60,end:75},{sport:"Ride",thresholds:{ftp:280}},[{types:["Ride"],power_zones:[55,75,90,105,120,999]}]),
    {zoneId:"2",physical:"168-210 W"}
  );
  assert.deepEqual(
    desktopTargetPresentation({kind:"pace",unit:"%pace",mode:"single",value:80},{sport:"Swim"},[{types:["Swim"],threshold_pace:.9144,pace_zones:[70,85,95,105,999]}]),
    {zoneId:"2",physical:"02:05 min/100yd"}
  );
  assert.deepEqual(
    desktopTargetPresentation({kind:"pace",unit:"%pace",mode:"single",value:96.4},{sport:"Run"}),
    {zoneId:"",physical:""}
  );
  assert.deepEqual(
    desktopTargetPresentation({kind:"hr",unit:"%lthr",mode:"single",value:85},{sport:"Run"},[{types:["Run"],pace_zones:[75,85,95,105,999]}]),
    {zoneId:"",physical:""}
  );
});

test("desktop automatic pace estimates weight repeat durations without inventing missing targets", () => {
  const model={version:1,name:"Pace",sport:"Run",date:"2026-10-16",notes:"",poolLength:"",thresholds:{pace:1609.344/500},steps:[]};
  const step=builderBlock("Active",model,"%pace","single")[0];
  step.end.value=3600;
  step.target.value=80;
  model.steps=[step];
  assert.ok(Math.abs(desktopBuilderTotals(model).load-64)<1e-8);
  step.target={kind:"pace",unit:"secs/mi",mode:"single",value:625};
  assert.ok(Math.abs(desktopBuilderTotals(model).load-64)<1e-8);
  step.target={kind:"none"};
  assert.equal(desktopBuilderTotals(model).load,null);
});
test("desktop range bands use both target bounds and invert absolute pace correctly", () => {
  const power=desktopProfileRange({start:.7,end:.7,step:{target:{kind:"power",unit:"%ftp",mode:"range",start:70,end:80}}});
  assert.ok(Math.abs(power.low-.7)<1e-10 && Math.abs(power.high-.8)<1e-10);
  assert.deepEqual(desktopProfileRange({start:2,end:2,step:{target:{kind:"pace",unit:"secs/mi",mode:"range",start:450,end:600}}}),{low:1.5,high:2});
  assert.deepEqual(desktopProfileRange({start:.25,end:.25,step:{target:{kind:"none"}}}),{low:.25,high:.25});
});

function creationStorage() {
  const items=new Map();
  return {items,getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key)};
}
function pendingCreation() {
  const model={version:1,name:"Recover my session",sport:"Run",date:"2026-10-16",notes:"Keep it relaxed.",poolLength:"",steps:[]};
  model.steps=builderBlock("Active",model,"%pace","single");
  return {model,values:{duration_seconds:300,tss:8},time:"06:30",comment:"One comment.",creationId:"b941e975-42f0-4717-ac4f-ce6402ca9691"};
}
test("pending creation retains its exact identity, model and text across reloads and isolates accounts",()=>{
  const storage=creationStorage(), input=pendingCreation();
  assert.equal(rememberPendingWorkoutCreation(storage,"athlete-a",input),true);
  assert.deepEqual(readPendingWorkoutCreation(storage,"athlete-a"),input);
  assert.equal(readPendingWorkoutCreation(storage,"athlete-b"),null);
});
test("a second unconfirmed creation cannot replace the first and only its matching identity can clear it",()=>{
  const storage=creationStorage(), input=pendingCreation();
  rememberPendingWorkoutCreation(storage,"athlete-a",input);
  assert.throws(()=>rememberPendingWorkoutCreation(storage,"athlete-a",{...input,creationId:"0e5b2d61-87e3-471c-bc0b-c3614465b13e"}),error=>error.code==="CREATION_PENDING");
  assert.equal(clearPendingWorkoutCreation(storage,"athlete-a","another-operation"),false);
  assert.deepEqual(readPendingWorkoutCreation(storage,"athlete-a"),input);
  assert.equal(clearPendingWorkoutCreation(storage,"athlete-a",input.creationId),true);
  assert.equal(readPendingWorkoutCreation(storage,"athlete-a"),null);
});
test("damaged pending creations are never restored and unavailable storage retains the in-memory save path",()=>{
  const storage=creationStorage(), input=pendingCreation();
  rememberPendingWorkoutCreation(storage,"athlete-a",input);
  const key=[...storage.items.keys()][0];
  storage.setItem(key,JSON.stringify({version:1,input:{...input,values:{duration_seconds:-3}}}));
  assert.equal(readPendingWorkoutCreation(storage,"athlete-a"),null);
  storage.setItem(key,"not-json");
  assert.equal(readPendingWorkoutCreation(storage,"athlete-a"),null);
  const unavailable={getItem(){throw Error("Unavailable")},setItem(){throw Error("Unavailable")},removeItem(){throw Error("Unavailable")}};
  assert.equal(rememberPendingWorkoutCreation(unavailable,"athlete-a",input),false);
});

test("desktop workout-wide shape edits all nested prescriptions and exports the observed midpoint",()=>{
  const base={version:1,name:"Reference conversion",sport:"Run",date:"2026-10-21",notes:"Manual instructions stay",poolLength:"",thresholds:{pace:3,ftp:240},steps:[]};
  base.steps=[...builderBlock("Warm up",base,"%pace","range"),...builderBlock("Two Step Repeats",base,"%pace","range")];
  const original=structuredClone(base);
  const target=changeDesktopTargetShape(base,"single","%pace");
  assert.equal(target.steps[0].target.value,75);
  assert.deepEqual(target.steps[1].steps.map(s=>s.target.value),[110,80]);
  assert.deepEqual(base,original);
  const range=changeDesktopTargetShape(target,"range","%pace");
  assert.deepEqual(range.steps[0].target,{kind:"pace",unit:"%pace",mode:"range",start:70,end:80});
  const power=changeDesktopTargetUnit(range,"%ftp");
  assert.equal(power.steps[0].target.kind,"power");
  assert.equal(power.steps[1].steps[0].target.start,105);
  const watts=changeDesktopTargetUnit(power,"w");
  assert.equal(watts.steps[0].target.start,168);
  assert.equal(watts.steps[1].steps[0].target.end,276);
  assert.equal(watts.notes,base.notes);
  assert.deepEqual(validateWorkout(watts),[]);
  const absolutePace=changeDesktopTargetUnit(watts,"secs/mi");
  assert.equal(absolutePace.steps[0].target.kind,"pace");
  assert.ok(absolutePace.steps[0].target.start<absolutePace.steps[0].target.end);
  assert.deepEqual(validateWorkout(absolutePace),[]);
  assert.deepEqual(verifyParsedWorkout(absolutePace,{workout_doc:parseTestWorkout(serializeWorkout(absolutePace))}),[]);
  assert.deepEqual(verifyParsedWorkout(watts,{workout_doc:parseTestWorkout(serializeWorkout(watts))}),[]);
  assert.throws(()=>changeDesktopTargetUnit({...base,thresholds:{}},"w"));
  assert.deepEqual(base,original);
});

test("desktop length and distance-unit changes preserve physical quantities instead of resetting them",()=>{
  const model={version:1,name:"Physical units",sport:"Run",date:"2026-10-21",notes:"",poolLength:"",thresholds:{pace:4},steps:[]};
  const step=builderBlock("Warm up",model,"%pace","single")[0];
  step.end.pressLap=true;
  const distance=changeDesktopStepLength(step,"distance","mi",model);
  assert.ok(Math.abs(distance.end.value*1609.344-3600)<.02);
  assert.equal(distance.end.pressLap,true);
  const km=changeDesktopStepLength(distance,"distance","km",model);
  assert.ok(Math.abs(km.end.value-3.6)<.0001);
  const time=changeDesktopStepLength(km,"time","s",model);
  assert.equal(time.end.value,1200);
  assert.equal(time.end.pressLap,true);
  assert.equal(step.end.value,1200);
  assert.throws(()=>changeDesktopStepLength({...step,target:{kind:"none"}},"distance","mi",model),/original length/);
});

test("desktop palette drops can append and duplicated repeat groups have independent descendant IDs",()=>{
  assert.equal(desktopPaletteDropIndex([{width:100},{width:20}],1),2);
  assert.equal(desktopPaletteDropIndex([{width:100},{width:20}],0),0);
  assert.equal(desktopPaletteDropIndex([{width:100},{width:20}],.85),1);
  const model={version:1,name:"Copies",sport:"Run",date:"2026-10-21",notes:"",poolLength:"",steps:[]};
  const repeat=builderBlock("Two Step Repeats",model,"%pace","range")[0];
  repeat.recovery=structuredClone(repeat.steps[0]);repeat.recovery.id="recovery";
  repeat.setRecovery=structuredClone(repeat.steps[1]);repeat.setRecovery.id="set-recovery";
  const copy=duplicateDesktopBlock(repeat);
  const ids=node=>[node.id,...(node.kind==="repeat"?[...node.steps.flatMap(ids),...ids(node.recovery),...ids(node.setRecovery)]:[])];
  assert.ok(ids(copy).every(id=>!ids(repeat).includes(id)));
  copy.steps[0].end.value=900;
  assert.equal(repeat.steps[0].end.value,360);
});

test("desktop Description trusts explicit provider prose and never falls back to a generated outline",()=>{
  const model={version:1,name:"Manual",sport:"Run",date:"2026-10-21",notes:"Coach text",poolLength:"",steps:[]};
  model.steps=builderBlock("Warm up",model,"%pace","range");
  const row={id:"event:42",goal:"Generated legacy outline",details:"Generated readable plan",app_description_version:3,manual_description:"",editor_model:model};
  assert.equal(desktopWorkoutDescription(row),"");
  assert.equal(desktopWorkoutDescription({...row,manual_description:"Easy miles. Finish relaxed."}),"Easy miles. Finish relaxed.");
  const legacy=serializeWorkout(model);
  assert.equal(desktopWorkoutDescription({...row,manual_description:undefined,editable_description:legacy}),"Coach text");
  assert.equal(desktopWorkoutDescription({...row,manual_description:undefined,editable_description:"Typed in Intervals.icu"}),"Typed in Intervals.icu");
});

test("desktop builder preferences preserve the chosen new-block basis across mixed workout edits",()=>{
  const data=new Map(), storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const preference={length:{kind:"time",unit:"s"},unit:"%pace",mode:"range"};
  rememberDesktopBuilderPreferences(storage,"athlete-a","Run",preference);
  assert.deepEqual(readDesktopBuilderPreferences(storage,"athlete-a","Run"),preference);
  assert.equal(readDesktopBuilderPreferences(storage,"athlete-b","Run"),null);
  assert.equal(readDesktopBuilderPreferences(storage,"athlete-a","Swim"),null);
  data.set("desktop-workout-builder:athlete-a:Run",JSON.stringify({...preference,length:{kind:"distance",unit:"bad"}}));
  assert.equal(readDesktopBuilderPreferences(storage,"athlete-a","Run"),null);
  assert.equal(readDesktopBuilderPreferences({getItem(){throw Error("blocked")}},"athlete-a","Run"),null);
});
