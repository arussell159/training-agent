import test from "node:test"
import assert from "node:assert/strict"
import {workoutPresentationSport,workoutSelection,workoutSelectionKey} from "../src/lib/workout-presentation.ts"
test("private variants preserve exact presentation independently of workout names and native sport",()=>{
  for(const [variant,label] of [["brick","Brick"],["day-off","Day off"],["custom","Custom"]]){
    const model={sport:"Other",variant,name:"A completely different session name"}
    assert.equal(workoutPresentationSport(model),label)
    assert.equal(workoutPresentationSport({sport:"Other",provider_type:"Other",display_variant:variant,title:"Arbitrary name"}),label)
    assert.equal(workoutPresentationSport({sport:"Other",editor_model:model}),label)
    assert.deepEqual(workoutSelection(workoutSelectionKey(model)),{sport:"Other",variant})
  }
  assert.equal(workoutPresentationSport({sport:"Other",name:"Brick"}),"Other")
  assert.equal(workoutPresentationSport({sport:"Ride",variant:"brick"}),"Ride")
  assert.equal(workoutPresentationSport({sport:"Other",variant:"unknown"}),"Other")
  assert.throws(()=>workoutSelection("variant:unknown"),/valid workout type/)
  assert.deepEqual(workoutSelection("MountainBikeRide"),{sport:"MountainBikeRide"})
})
