import test from "node:test";
import assert from "node:assert/strict";
import { aggregateActivityHistory,aggregateFastestPace,aggregateDailyMetrics,aggregateFitnessSummary } from "../src/lib/aggregate-analysis.ts";
import { validatedTrainingWorkout, validatedTrainingContext } from "../src/lib/training-context-validation.ts";
import { calendarMetricFields } from "../../app-backend/lib/calendar-metrics-model.mjs";

const record = (id, date, values = {}, extra = {}) => ({
  id: `activity:${id}`, activity_id: id, workout_date: date, status: "completed", sport: "Bike", activity_type: "Ride",
  title: "Synthetic recording", duration: "20m", day: "Mon", date: "Oct 19", goal: "",
  workout_summary: { planned: null, completed: values }, ...extra,
});
const zones = (seconds = [0, 30, 60], boundaries_bpm = [130, 150, 180], threshold_bpm = 170) => ({ seconds, boundaries_bpm, threshold_bpm });

test("Fitness Summary selects exact planned/completed values and dates, deduplicating paired records independently",()=>{
  const actual=record("paired","2026-10-20",{duration_seconds:1800,distance_meters:4000},{activity_type:"Run",sport:"Run"});
  const paired={...actual,id:"event:10",category:"WORKOUT",provider_type:"Ride",planned_workout_date:"2026-10-19",workout_summary:{planned:{duration_seconds:3600,distance_meters:20000},completed:actual.workout_summary.completed}};
  const rows=[paired,structuredClone(paired),actual];
  for(const [reportType,date,value,sport] of [["Planned Distance","2026-10-19",20000,"Bike"],["Planned Duration","2026-10-19",3600,"Bike"],["Completed Distance","2026-10-20",4000,"Run"],["Completed Duration","2026-10-20",1800,"Run"]]){
    const result=aggregateFitnessSummary(rows,{start:date,end:date,reportType});
    assert.deepEqual(result.rows,[{sport,value,observed:1,missing:0}]);
    assert.deepEqual(result.total,{value,observed:1,missing:0});
  }
  assert.equal(aggregateFitnessSummary(rows,{start:"2026-10-20",end:"2026-10-20",reportType:"Planned Duration"}).rows.length,0);
});

test("Fitness Summary modern nulls override stale legacy values, while real zero and missing coverage remain distinct",()=>{
  const zero={...record("zero","2026-10-20",{duration_seconds:0}),id:"event:1",category:"WORKOUT",workout_summary:{planned:{duration_seconds:0},completed:{duration_seconds:0}}};
  const missing={...zero,id:"event:2",activity_id:"missing",planned:{duration_minutes:60},plannedDurationMinutes:90,actualDurationMinutes:120,workout_summary:{planned:null,completed:null}};
  for(const reportType of ["Planned Duration","Completed Duration"]){
    const result=aggregateFitnessSummary([zero,missing],{start:"2026-10-20",end:"2026-10-20",reportType});
    assert.deepEqual(result.total,{value:0,observed:1,missing:1});
  }
  const unavailable=aggregateFitnessSummary([missing],{start:"2026-10-20",end:"2026-10-20",reportType:"Planned Duration"});
  assert.deepEqual(unavailable.total,{value:null,observed:0,missing:1});
  assert.deepEqual(aggregateFitnessSummary([],{start:"2026-10-20",end:"2026-10-20",reportType:"Planned Duration"}).total,{value:0,observed:0,missing:0});
});

test("Fitness Summary separates native Mountain Bike and exact planned variants without labeling actuals from plan titles",()=>{
  const row=(id,type,variant)=>({...record(id,"2026-10-20",{duration_seconds:10},{activity_type:type}),id:`event:${id}`,category:"WORKOUT",provider_type:type,display_variant:variant,workout_summary:{planned:{duration_seconds:20},completed:{duration_seconds:10}}});
  const mountain=row("1","MountainBikeRide"),brick=row("2","Other","brick"),custom=row("3","Other","custom");
  const planned=aggregateFitnessSummary([mountain,brick,custom],{start:"2026-10-20",end:"2026-10-20",reportType:"Planned Duration"});
  assert.deepEqual(planned.rows.map(row=>row.sport),["Brick","Custom","Mtn Bike"]);
  const completed=aggregateFitnessSummary([mountain,brick,custom],{start:"2026-10-20",end:"2026-10-20",reportType:"Completed Duration"});
  assert.deepEqual(completed.rows.map(row=>row.sport),["Mtn Bike","Other"]);
  assert.equal(completed.rows.find(row=>row.sport==="Other").value,20);
});

test("Fitness Summary excludes pending/calendar-only entries and only uses explicit legacy planned fields",()=>{
  const legacy={...record("legacy","2026-10-20",{}),id:"event:11",workout_summary:undefined,category:"WORKOUT",planned:{duration_minutes:5,distance_meters:900},distance_meters:99999};
  const note={...legacy,id:"event:12",category:"NOTE",planned:{duration_minutes:60}};
  const pending={...legacy,id:"pending:write",planned:{duration_minutes:60}};
  const result=aggregateFitnessSummary([legacy,note,pending],{start:"2026-10-20",end:"2026-10-20",reportType:"Planned Distance"});
  assert.deepEqual(result.total,{value:900,observed:1,missing:0});
  assert.equal(aggregateFitnessSummary([legacy,note,pending],{start:"2026-10-20",end:"2026-10-20",reportType:"Planned Duration"}).total.value,300);
  assert.throws(()=>aggregateFitnessSummary([],{start:"2026-02-30",end:"2026-03-01",reportType:"Planned Duration"}),/valid aggregate dates/);
  assert.throws(()=>aggregateFitnessSummary([],{start:"2026-10-20",end:"2026-10-20",reportType:"CTL"}),/report type/);
});

test("Fitness Summary newer authoritative clears win stale duplicates without mutating source records",()=>{
  const old={...record("same","2026-10-20",{duration_seconds:100}),id:"event:1",category:"WORKOUT",source_updated_at:"2026-10-20T10:00:00Z",workout_summary:{planned:{duration_seconds:100},completed:{duration_seconds:100}}};
  const fresh={...old,source_updated_at:"2026-10-20T11:00:00Z",workout_summary:{planned:{duration_seconds:null},completed:{duration_seconds:null}}};
  const rows=[fresh,old],before=structuredClone(rows);
  for(const reportType of ["Planned Duration","Completed Duration"])assert.deepEqual(aggregateFitnessSummary(rows,{start:"2026-10-20",end:"2026-10-20",reportType}).total,{value:null,observed:0,missing:1});
  assert.deepEqual(rows,before);
});

test("an existing workout keeps its updated contribution while its optimistic edit awaits acknowledgement", () => {
  const planned = {...record("same", "2026-10-20", {}), id:"event:1", category:"WORKOUT", status:"upcoming", app_pending_operation:"edit-1", workout_summary:{planned:{duration_seconds:1800},completed:null}};
  const result = aggregateFitnessSummary([planned],{start:"2026-10-19",end:"2026-10-25",reportType:"Planned Duration"});
  assert.deepEqual(result.total,{value:1800,observed:1,missing:0});
});

test("recorded analysis and Fitness Summary both preserve a cleared modern recording instead of reviving stale actual minutes", () => {
  const cleared = {...record("cleared", "2026-10-20", {}), actualDurationMinutes:90, distance_meters:12000, workout_summary:{planned:null,completed:null}};
  const analysis = aggregateActivityHistory([cleared],{start:"2026-10-20",end:"2026-10-20",period:"day"});
  assert.deepEqual(analysis.periods[0].metrics.duration_seconds,{value:null,observed:0,missing:1});
  assert.deepEqual(analysis.periods[0].metrics.distance_meters,{value:null,observed:0,missing:1});
  assert.deepEqual(analysis.periods[0].metrics.duration_seconds,aggregateFitnessSummary([cleared],{start:"2026-10-20",end:"2026-10-20",reportType:"Completed Duration"}).total);
});

test("inclusive daily and partial weekly ranges use exact recorded seconds across year boundaries", () => {
  const rows = [record("i1", "2026-12-30", { duration_seconds: 90, distance_meters: 1000, tss: 2 }), record("i2", "2027-01-04", { duration_seconds: 120, distance_meters: 500, tss: 3 })];
  const daily = aggregateActivityHistory(rows, { start: "2026-12-30", end: "2027-01-04", period: "day" });
  assert.equal(daily.periods.length, 6);
  assert.deepEqual(daily.periods.map((row) => row.metrics.duration_seconds.value), [90, 0, 0, 0, 0, 120]);
  const weekly = aggregateActivityHistory(rows, { start: "2026-12-30", end: "2027-01-04" });
  assert.deepEqual(weekly.periods.map(({ key, start, end }) => ({ key, start, end })), [
    { key: "2026-12-28", start: "2026-12-30", end: "2027-01-03" }, { key: "2027-01-04", start: "2027-01-04", end: "2027-01-04" },
  ]);
  assert.deepEqual(weekly.periods.map((row) => row.metrics.tss.value), [2, 3]);
});

test("measured zero, partial coverage, unavailable metrics and empty periods remain distinguishable", () => {
  const result = aggregateActivityHistory([record("i1", "2026-10-19", { duration_seconds: 0, distance_meters: 0, tss: 0 }), record("i2", "2026-10-19", { duration_seconds: 60, distance_meters: null, tss: null })], { start: "2026-10-19", end: "2026-10-20", period: "day" });
  assert.deepEqual(result.periods[0].metrics.tss, { value: 0, observed: 1, missing: 1 });
  assert.deepEqual(result.periods[0].metrics.duration_seconds, { value: 60, observed: 2, missing: 0 });
  assert.deepEqual(result.periods[0].metrics.work_kj, { value: null, observed: 0, missing: 2 });
  assert.deepEqual(result.periods[1].metrics.tss, { value: 0, observed: 0, missing: 0 });
});

test("paired plans and recordings count once and calendar defaults never replace missing recorded metrics", () => {
  const recorded = record("i1", "2026-10-19", { duration_seconds: 1800, tss: 20 });
  const plan = { ...recorded, id: "event:10", planned: { duration_minutes: 60, tss: 99 } };
  const missing = record("i2", "2026-10-19", { tss: null }, { load: 99, actualDurationMinutes: 0, completed_data: { tss: 0 } });
  const uncompleted = record("i3", "2026-10-19", {}, { id: "event:11", status: "upcoming", workout_summary: { planned: { duration_seconds: 3600, tss: 100 }, completed: null } });
  const result = aggregateActivityHistory([plan, recorded, missing, uncompleted], { start: "2026-10-19", end: "2026-10-19" });
  assert.equal(result.activities, 2);
  assert.deepEqual(result.periods[0].metrics.duration_seconds, { value: 1800, observed: 1, missing: 1 });
  assert.deepEqual(result.periods[0].metrics.tss, { value: 20, observed: 1, missing: 1 });
});

test("sport filters use recorded sport, include cycling variants and exclude out-of-range or invalid dates", () => {
  const rows = [record("i1", "2026-10-19", { tss: 5 }, { activity_type: "MountainBikeRide" }), record("i2", "2026-10-19", { tss: 7 }, { activity_type: "VirtualRide" }), record("i3", "2026-10-19", { tss: 3 }, { activity_type: "Run", sport: "Bike" }), record("i4", "2026-10-18", { tss: 90 }), record("i5", "2026-02-30", { tss: 90 })];
  const options = { start: "2026-10-19", end: "2026-10-19" };
  assert.equal(aggregateActivityHistory(rows, { ...options, sport: "bike" }).periods[0].metrics.tss.value, 12);
  assert.equal(aggregateActivityHistory(rows, { ...options, sport: "MountainBikeRide" }).activities, 1);
  assert.equal(aggregateActivityHistory(rows, { ...options, sport: "run" }).periods[0].metrics.tss.value, 3);
});

test("HR zone aggregation separates sports, historical boundaries and thresholds without mutating source arrays", () => {
  const rows = [record("i1", "2026-10-19", { heart_rate_zones: zones() }), record("i2", "2026-10-19", { heart_rate_zones: zones([0, 10, 20]) }), record("i3", "2026-10-19", { heart_rate_zones: zones([1, 2, 3], [120, 140, 170]) }), record("i4", "2026-10-19", { heart_rate_zones: zones() }, { activity_type: "Run", sport: "Run" }), record("i5", "2026-10-19", { heart_rate_zones: zones([0, 0, 0], [130, 150, 180], 165) }), record("i6", "2026-10-19", {})];
  const before = structuredClone(rows);
  const result = aggregateActivityHistory(rows, { start: "2026-10-19", end: "2026-10-19" });
  assert.equal(result.heartRateZones.length, 4);
  const combined = result.heartRateZones.find((group) => group.activities === 2);
  assert.equal(combined.sport, "Ride");
  assert.deepEqual(combined.seconds, [0, 40, 80]);
  assert.equal(result.missingHeartRateZones, 1);
  assert.deepEqual(rows, before);
});

test("separate source stress loads retain their own values without fabricating TrainingPeaks equivalents", () => {
  const result = aggregateActivityHistory([record("i1", "2026-10-19", { tss: 20, power_load: 20, hr_load: 12, pace_load: null, hr_load_type: "HRSS" }), record("i2", "2026-10-19", { tss: 10, power_load: 0, hr_load: 9, pace_load: 0 })], { start: "2026-10-19", end: "2026-10-19" });
  assert.equal(result.periods[0].metrics.tss.value, 30);
  assert.equal(result.periods[0].metrics.power_load.value, 20);
  assert.equal(result.periods[0].metrics.hr_load.value, 21);
  assert.deepEqual(result.periods[0].metrics.pace_load, { value: 0, observed: 1, missing: 1 });
  assert.equal(result.records[0].workout_summary.completed.hr_load_type, "HRSS");
});

test("malformed inputs do not create made-up measurements or silently accept invalid ranges", () => {
  const row = record("i1", "2026-10-19", { tss: -1, duration_seconds: NaN, heart_rate_zones: zones([1, -1, 1]) });
  const result = aggregateActivityHistory([row], { start: "2026-10-19", end: "2026-10-19" });
  assert.equal(result.periods[0].metrics.tss.value, null);
  assert.equal(result.periods[0].metrics.duration_seconds.value, null);
  assert.equal(result.heartRateZones.length, 0);
  assert.throws(() => aggregateActivityHistory([], { start: "2026-02-30", end: "2026-03-01" }), /valid aggregate dates/);
  assert.throws(() => aggregateActivityHistory([], { start: "2026-10-20", end: "2026-10-19" }), /valid aggregate dates/);
  assert.throws(() => aggregateActivityHistory([], { start: "2026-10-19", end: "2026-10-20", period: "year" }), /daily or weekly/);
});

test("training payload validation accepts valid compact HR source data and rejects corrupted arrays", () => {
  const valid = record("i1", "2026-10-19", { hr_load: 0, hr_load_type: "HRSS", heart_rate_zones: zones() });
  assert.equal(validatedTrainingWorkout(valid), valid);
  for (const invalid of [zones([1, 2]), zones([1, -1, 3]), zones([1, 2, 3], [130, 120, 180]), zones([1, 2, 3], [130, 150, 180], -1)])
    assert.throws(() => validatedTrainingWorkout(record("i1", "2026-10-19", { heart_rate_zones: invalid })), /incomplete/);
});

test("calendar metric projections validate all fields before replacing a usable context, including zero and unchanged imported outliers", () => {
  const entries = Object.fromEntries(calendarMetricFields.map(field => [field.key, { value: null, time: null, source: "unavailable" }]));
  entries.weight = { value: 1100, time: null, source: "intervals" };
  entries.hrv = { value: 0, time: "00:00", source: "manual" };
  const context = { athlete: {}, metrics: {}, history: [], planned: [], wellness_history: [{ date: "2026-10-20", calendar_metrics: entries, calendar_metrics_note: "Imported note" }] };
  assert.equal(validatedTrainingContext(context).wellness_history[0].calendar_metrics.hrv.value, 0);
  for (const change of [row => { row.calendar_metrics.fatigue.value = "Unknown"; }, row => { row.calendar_metrics.hrv.time = "25:00"; }, row => { delete row.calendar_metrics.hrv; }, row => { row.calendar_metrics_note = {}; }]) {
    const invalid = structuredClone(context); change(invalid.wellness_history[0]);
    assert.throws(() => validatedTrainingContext(invalid), /incomplete/);
  }
});

test("calories, elevation and kJ sum exact recorded values while longest and source maxima retain ties and coverage",()=>{
  const rows=[record("i1","2026-10-19",{duration_seconds:600,distance_meters:2000,calories:0,elevation_gain:12.5,elevation_loss:0,work_kj:120,max_power:300,max_cadence:90,max_hr:180,max_speed:5}),record("i2","2026-10-20",{duration_seconds:1200,distance_meters:2000,calories:100,elevation_gain:null,elevation_loss:10,work_kj:0,max_power:300,max_cadence:null,max_hr:150,max_speed:0})];
  const result=aggregateActivityHistory(rows,{start:"2026-10-19",end:"2026-10-25"});
  const bucket=result.periods[0];
  assert.deepEqual(bucket.metrics.calories,{value:100,observed:2,missing:0});
  assert.deepEqual(bucket.metrics.elevation_gain,{value:12.5,observed:1,missing:1});
  assert.deepEqual(bucket.metrics.elevation_loss,{value:10,observed:2,missing:0});
  assert.equal(bucket.metrics.work_kj.value,120);
  assert.deepEqual(bucket.maxima.duration_seconds,{value:1200,observed:2,missing:0,activityIds:["i2"]});
  assert.deepEqual(bucket.maxima.distance_meters,{value:2000,observed:2,missing:0,activityIds:["i1","i2"]});
  assert.deepEqual(bucket.maxima.max_power,{value:300,observed:2,missing:0,activityIds:["i1","i2"]});
  assert.deepEqual(bucket.maxima.max_cadence,{value:90,observed:1,missing:1,activityIds:["i1"]});
  assert.equal(aggregateFastestPace(bucket.maxima.max_speed),0.2);
  const daily=aggregateActivityHistory(rows,{start:"2026-10-19",end:"2026-10-21",period:"day"});
  assert.equal(aggregateFastestPace(daily.periods[1].maxima.max_speed),null);
  assert.deepEqual(daily.periods[2].maxima.max_hr,{value:null,observed:0,missing:0,activityIds:[]});
});

const recordedZones=(basis="power",threshold=200,seconds=[0,30,60],boundaries_percent=[55,75,999])=>({basis,threshold,seconds,boundaries_percent,unit:basis==="power"?"%ftp":"%threshold-speed"});
test("power/speed zone totals separate recorded sports, thresholds, boundaries and GAP basis",()=>{
  const rows=[record("i1","2026-10-19",{power_zone_times:recordedZones(),pace_zone_times:recordedZones("speed",4)}),record("i2","2026-10-19",{power_zone_times:recordedZones("power",200,[0,10,20]),pace_zone_times:recordedZones("gap-speed",4)}),record("i3","2026-10-19",{power_zone_times:recordedZones("power",210),pace_zone_times:recordedZones("speed",4,[0,10,20])}),record("i4","2026-10-19",{power_zone_times:recordedZones("power",200,[0,30,60],[50,70,999])}),record("i5","2026-10-19",{power_zone_times:recordedZones()},{activity_type:"Run",sport:"Run"}),record("i6","2026-10-19",{})];
  const before=structuredClone(rows),result=aggregateActivityHistory(rows,{start:"2026-10-19",end:"2026-10-19"});
  assert.equal(result.powerZones.length,4);
  assert.deepEqual(result.powerZones.find(group=>group.activities===2).seconds,[0,40,80]);
  assert.equal(result.paceZones.length,2);
  assert.deepEqual(result.paceZones.find(group=>group.basis==="speed").seconds,[0,40,80]);
  assert.equal(result.missingPowerZones,1);
  assert.equal(result.missingPaceZones,3);
  assert.deepEqual(rows,before);
  assert.throws(()=>validatedTrainingWorkout(record("i7","2026-10-19",{power_zone_times:recordedZones("speed")})),/incomplete/);
  assert.throws(()=>validatedTrainingWorkout(record("i7","2026-10-19",{pace_zone_times:recordedZones("speed",4,[1,-1,1])})),/incomplete/);
});

test("source maxima never fall back to averages, planned targets or duplicate paired records",()=>{
  const actual=record("i1","2026-10-19",{duration_seconds:600,max_power:300,max_speed:5});
  const paired={...actual,id:"event:1",workout_summary:{planned:{duration_seconds:3600,max_power:999},completed:{duration_seconds:600,max_power:300,max_speed:5}}};
  const missing=record("i2","2026-10-19",{average_power:500,average_hr:190,average_speed:8,max_power:null});
  const result=aggregateActivityHistory([actual,paired,missing],{start:"2026-10-19",end:"2026-10-19"});
  assert.equal(result.activities,2);
  assert.deepEqual(result.periods[0].maxima.max_power,{value:300,observed:1,missing:1,activityIds:["i1"]});
  assert.equal(result.periods[0].maxima.max_hr.value,null);
  assert.equal(result.periods[0].maxima.max_speed.value,5);
});

test("daily metric snapshots preserve exact subjective labels, null clears, time, units and provenance",()=>{
  const entries=Object.fromEntries(calendarMetricFields.map(field=>[field.key,{value:null,time:null,source:"unavailable"}]));
  entries.weight={value:null,time:"09:00",source:"manual"};
  entries.hrv={value:0,time:"00:00",source:"manual"};
  entries.stress={value:"Extreme",time:"08:30",source:"manual"};
  const rows=[{date:"2026-10-19",weight:45.359237,sleepSecs:7200,restingHR:50,stress:5,comments:"Imported note"},{date:"2026-10-20",calendar_metrics:entries,calendar_metrics_note:"Exact note"},{date:"2026-10-20",weight:99,hrv:100},{date:"2026-02-30",weight:1}];
  const before=structuredClone(rows),result=aggregateDailyMetrics(rows,{start:"2026-10-19",end:"2026-10-21"});
  assert.equal(result.length,2);
  assert.ok(Math.abs(result[0].entries.weight.value-100)<1e-10);
  assert.equal(result[0].entries.sleepHours.value,2);
  assert.deepEqual(result[0].entries.stress,{value:null,time:null,source:"unavailable"});
  assert.equal(result[0].entries.weight.source,"intervals");
  assert.equal(result[0].note,"Imported note");
  assert.deepEqual(result[1].entries.weight,{value:null,time:"09:00",source:"manual"});
  assert.deepEqual(result[1].entries.stress,{value:"Extreme",time:"08:30",source:"manual"});
  assert.equal(result[1].entries.hrv.value,0);
  assert.equal(result[1].note,"Exact note");
  assert.deepEqual(rows,before);
  assert.throws(()=>aggregateDailyMetrics(rows,{start:"2026-02-30",end:"2026-03-01"}),/valid daily metric dates/);
});

test("weekly zone buckets clip boundaries and distinguish missing recordings from an empty period",()=>{
  const rows=[record("i1","2026-12-30",{power_zone_times:recordedZones(),heart_rate_zones:zones()}),record("i2","2027-01-04",{power_zone_times:recordedZones("power",200,[0,10,20])}),record("i3","2027-01-04",{})];
  const result=aggregateActivityHistory(rows,{start:"2026-12-30",end:"2027-01-17"});
  assert.deepEqual(result.powerZones[0].periods,[{key:"2026-12-28",start:"2026-12-30",end:"2027-01-03",activities:1,seconds:[0,30,60]},{key:"2027-01-04",start:"2027-01-04",end:"2027-01-10",activities:1,seconds:[0,10,20]}]);
  assert.deepEqual(result.periods.map(row=>row.missingZoneActivities.power),[0,1,0]);
  assert.deepEqual(result.periods.map(row=>row.missingZoneActivities.heartRate),[0,2,0]);
  assert.equal(result.heartRateZones[0].periods[0].start,"2026-12-30");
  assert.equal(result.periods[2].activities,0);
});
