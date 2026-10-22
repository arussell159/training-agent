import test from "node:test"
import assert from "node:assert/strict"
import {completedValueDraft,changedCompletedValues,editableCompletedValue} from "../src/lib/completed-workout-values.ts"

test("completed swims round-trip native metres while displaying yards",()=>{
  const saved=completedValueDraft({duration_seconds:1800,distance_meters:914.4,average_speed:1.016},"Swim")
  assert.equal(saved.distance_meters,"1000")
  assert.equal(saved.average_speed,"1:30")
  assert.deepEqual(changedCompletedValues({...saved,distance_meters:"2000"},saved,"Swim"),{distance_meters:1828.8})
  assert.deepEqual(changedCompletedValues(saved,saved,"Swim"),{})
})
test("completed edits patch only explicit changes and preserve derived recordings",()=>{
  const saved=completedValueDraft({duration_seconds:600,distance_meters:1609.344,normalized_power:220,work_kj:300},"Run")
  assert.deepEqual(changedCompletedValues({...saved,duration_seconds:"0:20:00",tss:"25"},saved,"Run"),{duration_seconds:1200,tss:25})
  assert.equal(editableCompletedValue("normalized_power"),false)
  assert.throws(()=>changedCompletedValues({...saved,normalized_power:"250"},saved,"Run"),/calculated/)
  assert.throws(()=>changedCompletedValues({...saved,duration_seconds:"invalid"},saved,"Run"),/valid duration/)
})
test("clearing completed measurements cannot silently erase native values",()=>{
  const saved=completedValueDraft({duration_seconds:600,distance_meters:1609.344},"Run")
  assert.throws(()=>changedCompletedValues({...saved,duration_seconds:""},saved,"Run"),/completed duration/)
  assert.throws(()=>changedCompletedValues({...saved,distance_meters:""},saved,"Run"),/completed distance/)
  assert.deepEqual(changedCompletedValues({...saved,distance_meters:"0"},saved,"Run"),{distance_meters:0})
})
