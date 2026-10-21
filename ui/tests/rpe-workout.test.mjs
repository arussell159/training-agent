import test from "node:test"
import assert from "node:assert/strict"
import {builderBlock,normalizeRpeValue,editRpeTarget,reshapeDesktopTarget,changeDesktopTargetUnit,desktopBuilderTotals,desktopTargetPresentation,desktopTargetUnits,desktopBuilderBlocks} from "../src/lib/desktop-workout-builder.ts"
import {chartSegments,expandSteps,validateWorkout} from "../../app-backend/lib/workout-editor-model.mjs"
const model=(sport="Run")=>({version:1,name:"RPE workout",date:"2026-10-24",sport,poolLength:sport==="Swim"?"25y":"",notes:"",steps:[]})
test("RPE inputs round and clamp on the observed 1–10 scale without accepting nonfinite values",()=>{
  for(const [input,expected] of [[0,1],[-1,1],[10.5,10],[11,10],[6.5,7],[4,4]])assert.equal(normalizeRpeValue(input),expected)
  for(const value of [NaN,Infinity,-Infinity])assert.throws(()=>normalizeRpeValue(value),/finite/)
})
test("editing either RPE range endpoint preserves its typed integer and an ordered opposite bound",()=>{
  const original={kind:"rpe",unit:"rpe",mode:"range",start:1,end:8}
  assert.deepEqual(editRpeTarget(original,"start",11),{...original,start:10,end:10})
  assert.deepEqual(editRpeTarget(original,"end",0),{...original,start:1,end:1})
  assert.deepEqual(original,{kind:"rpe",unit:"rpe",mode:"range",start:1,end:8})
})
test("new Active RPE preset is ten minutes with range1–8 and has no invented physiological load",()=>{
  assert.ok(desktopTargetUnits.some(([unit])=>unit==="rpe"))
  const sample=model();sample.steps=builderBlock("Active",sample,"rpe","range")
  assert.deepEqual(sample.steps[0].target,{kind:"rpe",unit:"rpe",mode:"range",start:1,end:8})
  assert.equal(sample.steps[0].end.value,600);assert.deepEqual(validateWorkout(sample),[])
  assert.equal(desktopBuilderTotals(sample).load,null)
  assert.deepEqual(desktopTargetPresentation(sample.steps[0].target,sample),{zoneId:"",physical:""})
  assert.equal(chartSegments(sample).segments[0].start,0.1)
})
test("all RPE palette blocks remain valid across every supported sport, including native Other variants",()=>{
  for(const sport of ["Run","Ride","Swim","Other","WeightTraining","Walk","Rowing","NordicSki","Workout","MountainBikeRide"]){
    for(const name of desktopBuilderBlocks){const sample=model(sport);sample.steps=builderBlock(name,sample,"rpe","range");assert.deepEqual(validateWorkout(sample),[],`${sport}: ${name}`);assert.ok(expandSteps(sample.steps).every(({step})=>step.target.kind==="rpe"));assert.equal(desktopBuilderTotals(sample).load,null)}
  }
})
test("observed warmup, recovery, cooldown and two-step RPE presets retain exact minute lengths and independent bounds",()=>{
  const sample=model()
  for(const [name,seconds,end] of [["Warm up",1200,5],["Recovery",300,7],["Cool down",600,5]]){
    const [step]=builderBlock(name,sample,"rpe","range");assert.equal(step.end.value,seconds);assert.deepEqual(step.target,{kind:"rpe",unit:"rpe",mode:"range",start:1,end})
  }
  const [repeats]=builderBlock("Two Step Repeats",sample,"rpe","range")
  assert.equal(repeats.repetitions,4);assert.deepEqual(repeats.steps.map(step=>[step.label,step.end.value,step.target.start,step.target.end]),[["Hard",360,1,10],["Easy",180,1,7]])
})
test("choosing Target before adding any RPE palette block starts every step at1 rather than reusing the Range midpoint",()=>{
  const sample=model()
  for(const name of desktopBuilderBlocks){const steps=expandSteps(builderBlock(name,sample,"rpe","single"));for(const {step} of steps)assert.deepEqual(step.target,{kind:"rpe",unit:"rpe",mode:"single",value:1})}
})
test("RPE shape changes remain integer and ordered, and physiological conversion attempts preserve the original",()=>{
  const sample=model();sample.steps=builderBlock("Active",sample,"rpe","range")
  const single=reshapeDesktopTarget(sample.steps[0].target,"single",sample)
  assert.equal(single.value,5);assert.deepEqual(reshapeDesktopTarget(single,"range",sample),{kind:"rpe",unit:"rpe",mode:"range",start:1,end:10})
  assert.throws(()=>reshapeDesktopTarget(single,"ramp",sample),/stepped blocks/)
  const saved=JSON.stringify(sample);for(const unit of ["%ftp","%lthr","%pace","w"])assert.throws(()=>changeDesktopTargetUnit(sample,unit),/cannot be converted/)
  assert.equal(JSON.stringify(sample),saved)
  const power=model("Ride");power.steps=builderBlock("Active",power,"%ftp","range");assert.throws(()=>changeDesktopTargetUnit(power,"rpe"),/cannot be converted/)
})
test("observed RPE stepped ramps keep four independent integer stages and global target/shape switching",()=>{
  const sample=model()
  for(const [name,bounds] of [["Ramp Up",[7,8,9,10]],["Ramp Down",[10,9,8,7]]]){
    const [ramp]=builderBlock(name,sample,"rpe","range");assert.equal(ramp.repetitions,1);assert.equal(ramp.steps.length,4)
    assert.deepEqual(ramp.steps.map(step=>[step.label,step.end.value,step.target.start,step.target.end]),bounds.map(end=>["",180,1,end]))
  }
  const [three]=builderBlock("Three Step Repeats",sample,"rpe","range");assert.equal(three.repetitions,3);assert.deepEqual(three.steps.map(step=>[step.label,step.end.value,step.target.start,step.target.end]),[["Hard",180,1,9],["Harder",60,1,10],["Easy",60,1,7]])
  const [down]=builderBlock("Ramp Down",sample,"rpe","range")
  const singles=down.steps.map(step=>reshapeDesktopTarget(step.target,"single",sample));assert.deepEqual(singles.map(target=>target.value),[6,5,5,4])
  assert.deepEqual(singles.map(target=>reshapeDesktopTarget(target,"range",sample)).map(target=>[target.start,target.end]),[[1,10],[1,10],[1,10],[1,9]])
})
