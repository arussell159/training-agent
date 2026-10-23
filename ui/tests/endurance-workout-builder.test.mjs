import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import * as React from "../node_modules/react/index.js"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"
import {
  builderBlock,
  changeDesktopStepLength,
  desktopWorkoutZoneOptions,
  desktopProfileAxis,
  desktopProfileMaximum,
  desktopProfileTicks,
  displayTarget,
  changeDesktopTargetUnit,
  desktopBuilderTotals,
  desktopDistanceTicks,
  desktopTargetPresentation,
  desktopTargetUnits,
  desktopPaceUnitLabel,
  initialDesktopTargetUnit,
  targetKind,
} from "../src/lib/desktop-workout-builder.ts"
import {
  expandSteps,
  chartSegments,
  validateWorkout,
  serializeWorkout,
  verifyParsedWorkout,
  workoutTotals,
  paceFactors,
  targetLabel,
} from "../../app-backend/lib/workout-editor-model.mjs"
import { parseTestWorkout } from "../../app-backend/lib/fixtures/workout-editor-fixtures.mjs"

const model = (sport) => ({
  version: 1,
  name: "Endurance verification",
  sport,
  date: "2026-10-21",
  notes: "Coaching notes only",
  poolLength: sport === "Swim" ? "25m" : "",
  ...(sport === "Swim" ? { swimUnitMode: "explicit" } : {}),
  steps: [],
  thresholds: { ftp: 250, pace: sport === "Swim" ? 1 : 3 },
})

test("fresh run and swim builders use physical pace defaults instead of automatically remembered percentages", () => {
  const previous = {length:{kind:"time",unit:"s"},unit:"%pace",mode:"range"}
  for (const [sport, unit, label] of [["Swim","secs/100y","m:ss/100yds"],["Run","secs/mi","min/mile"],["TrailRun","secs/mi","min/mile"]]) {
    assert.equal(initialDesktopTargetUnit(undefined, model(sport)), unit)
    assert.equal(initialDesktopTargetUnit(undefined, model(sport), [], previous), unit)
    assert.equal(desktopPaceUnitLabel(unit), label)
    const workout = model(sport)
    workout.steps = builderBlock("Active", workout, unit, "range")
    assert.equal(workout.steps[0].target.unit, unit)
    assert.deepEqual(validateWorkout(workout), [])
    assert.deepEqual(verifyParsedWorkout(workout, {workout_doc:parseTestWorkout(serializeWorkout(workout))}), [])
  }
})

test("reopening a workout preserves deliberate metric, imperial and percentage prescriptions before general preferences", () => {
  for (const [sport, units] of [["Swim",["secs/100m","secs/100y","%pace"]],["Run",["secs/km","secs/mi","%pace"]]]) {
    for (const unit of units) {
      const target = Object.freeze({kind:"pace",unit,mode:"range",start:100,end:120})
      const preference = {length:{kind:"time",unit:"s"},unit:"%pace",mode:"range",unitExplicit:true}
      assert.equal(initialDesktopTargetUnit(target, model(sport), [], preference), unit)
      assert.deepEqual(target, {kind:"pace",unit,mode:"range",start:100,end:120})
    }
    const selected = {length:{kind:"time",unit:"s"},unit:units[0],mode:"range",unitExplicit:true}
    assert.equal(initialDesktopTargetUnit(undefined, model(sport), [], selected), units[0])
  }
})

test("zone labels and targets use the explicitly selected pace scale without changing physical intensity", () => {
  for (const [sport, preferred, expectedLabel] of [["Swim","secs/100y","m:ss/100yds"],["Swim","secs/100m","m:ss/100m"],["Run","secs/mi","min/mile"],["Run","secs/km","min/km"]]) {
    const workout = model(sport)
    const zones = [{types:[sport],threshold_pace:workout.thresholds.pace,pace_zones:[80,90,100,999]}]
    const option = desktopWorkoutZoneOptions(workout, zones, preferred).find(option => option.id === "2")
    assert.ok(option.label.includes(expectedLabel), option.label)
    assert.equal(option.target.unit, preferred)
    const expected = [paceFactors[preferred] / (workout.thresholds.pace * .9), paceFactors[preferred] / (workout.thresholds.pace * .8)].map(Math.round)
    assert.deepEqual([option.target.start, option.target.end], expected)
    const clock = value => `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`
    assert.ok(option.label.includes(`${clock(expected[0])} - ${clock(expected[1])}`), option.label)
  }
})

test("actual builder fields and labels round imported percentages without altering the prescription", () => {
  const source=fs.readFileSync(new URL("../src/components/desktop-workout-builder.tsx",import.meta.url),"utf8")
  const file=ts.createSourceFile("builder.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const functions=file.statements.filter(node=>ts.isFunctionDeclaration(node) && ["TargetNumber","StepTarget"].includes(node.name?.text)).map(node=>node.getText(file)).join("\n")
  assert.ok(functions.includes("function StepTarget"))
  const js=ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const scope={useCallback:React.useCallback,useState:React.useState,useRef:React.useRef,useEffect:React.useEffect,
    displayTarget,desktopWorkoutZoneOptions,desktopTargetPresentation,desktopTargetUnits,desktopPaceUnitLabel,paceFactors,targetKind,builderBlock,
    useWorkoutFieldValidity:()=>({invalid:false,markInvalid(){}}),X:()=>null}
  const StepTarget=new Function("require","exports",...Object.keys(scope),js+";return StepTarget;")(
    createRequire(new URL("../package.json",import.meta.url)),{},...Object.values(scope))
  for(const [sport,kind,unit] of [["Run","pace","%pace"],["Swim","pace","%pace"],["Ride","power","%ftp"],["Run","hr","%lthr"],["Run","hr","%hr"]]) {
    for(const mode of ["single","range","ramp"]) {
      const target={kind,unit,mode,...(mode==="single"?{value:79.97}:{start:79.97,end:89.97})}
      const before=structuredClone(target)
      const html=renderToStaticMarkup(React.createElement(StepTarget,{step:{target},unit,model:model(sport),zones:[],change(){},selectZone(){}}))
      assert.match(html,/value="80"/)
      if(mode!=="single")assert.match(html,/value="90"/)
      assert.doesNotMatch(html,/value="(?:79\.97|89\.97)"/)
      assert.equal(targetLabel(target),`${mode==="single"?"80":mode==="ramp"?"80 → 90":"80–90"} ${unit}`)
      assert.deepEqual(target,before,"display rounding must never rewrite imported provider values")
    }
  }
})

test("run and swim range conversions retain physical estimates and editable ordered pace bounds", () => {
  for (const [sport, paceUnit, distanceUnit] of [["Run", "secs/km", "km"], ["Run", "secs/mi", "mi"], ["Swim", "secs/100m", "m"], ["Swim", "secs/100y", "yd"]]) {
    const workout = model(sport)
    workout.steps = builderBlock("Active", workout, "%pace", "range", {kind:"distance",unit:distanceUnit})
    workout.steps[0].target = {kind:"pace",unit:"%pace",mode:"range",start:50,end:100}
    const before = structuredClone(workout)
    const absolute = changeDesktopTargetUnit(workout, paceUnit)
    assert.ok(absolute.steps[0].target.start < absolute.steps[0].target.end)
    assert.ok(Math.abs(workoutTotals(absolute).seconds - workoutTotals(workout).seconds) < 1e-8)
    assert.ok(Math.abs(desktopBuilderTotals(absolute).load - desktopBuilderTotals(workout).load) < 1e-8)
    assert.deepEqual(verifyParsedWorkout(absolute,{workout_doc:parseTestWorkout(serializeWorkout(absolute))}),[])
    const relative = changeDesktopTargetUnit(absolute, "%pace")
    assert.ok(Math.abs(relative.steps[0].target.start - 50) < 1e-8)
    assert.ok(Math.abs(relative.steps[0].target.end - 100) < 1e-8)
    assert.deepEqual(workout,before,"changing the displayed basis never mutates the saved/draft input")
  }
})

test("reciprocal pace conversion preserves ramp direction while ordering a range's bounds", () => {
  const workout = model("Run")
  const range = displayTarget({kind:"pace",unit:"%pace",mode:"range",start:80,end:120},"secs/km",workout)
  assert.ok(range.start < range.end)
  const ramp = displayTarget({kind:"pace",unit:"%pace",mode:"ramp",start:80,end:120},"secs/km",workout)
  assert.ok(ramp.start > ramp.end,"faster ending speed is a lower ending pace")
  const again = displayTarget(ramp,"%pace",workout)
  assert.ok(Math.abs(again.start - 80) < 1e-8)
  assert.ok(Math.abs(again.end - 120) < 1e-8)
})

test("swim distance presets use the independently observed swim distances throughout repeats and ramps", () => {
  const swim = model("Swim")
  const presets = {
    "Warm up": [600],
    Active: [200],
    Recovery: [100],
    "Cool down": [200],
    "Two Step Repeats": [200, 50],
    "Three Step Repeats": [75, 25, 50],
    "Ramp Up": [100, 100, 100, 100],
    "Ramp Down": [100, 100, 100, 100],
  }
  for (const [name, distances] of Object.entries(presets)) {
    const nodes = builderBlock(name, swim, "%pace", "range", {
      kind: "distance",
      unit: "m",
    })
    const leaves = nodes[0].kind === "repeat" ? nodes[0].steps : nodes
    assert.deepEqual(
      leaves.map((step) => step.end.value),
      distances,
      name
    )
    assert.ok(
      leaves.every(
        (step) =>
          step.end.kind === "distance" &&
          step.end.unit === "m" &&
          step.end.pressLap === false
      ),
      name
    )
    const workout = { ...swim, steps: nodes }
    assert.deepEqual(validateWorkout(workout), [])
    assert.deepEqual(
      verifyParsedWorkout(workout, {
        workout_doc: parseTestWorkout(serializeWorkout(workout)),
      }),
      [],
      name
    )
  }
})

test("swim yard presets use the independently observed nominal pool distances", () => {
  const swim = model("Swim")
  for (const [name, distance] of [
    ["Warm up", 600],
    ["Active", 200],
    ["Recovery", 100],
    ["Cool down", 200],
  ]) {
    const [step] = builderBlock(name, swim, "%pace", "range", {
      kind: "distance",
      unit: "yd",
    })
    assert.equal(step.end.value, distance)
    assert.equal(step.end.pressLap, false)
    const workout = {...swim, steps:[step]}
    assert.ok(Math.abs(workoutTotals(workout).distance - distance * 0.9144) < 1e-8)
    assert.deepEqual(verifyParsedWorkout(workout,{workout_doc:parseTestWorkout(serializeWorkout(workout))}),[])
  }
  assert.equal(
    builderBlock("Active", swim, "%pace", "single")[0].end.unit,
    "yd"
  )
})

test("changing swim block length preserves explicit lap choices and exact distance conversion", () => {
  const swim = model("Swim")
  const [step] = builderBlock("Active", swim, "%pace", "single", {
    kind: "time",
    unit: "s",
  })
  assert.equal(step.end.value, 600)
  assert.equal(step.end.pressLap, false)
  step.end.pressLap = true
  const distance = changeDesktopStepLength(step, "distance", "m", swim)
  assert.equal(distance.end.pressLap, true)
  assert.equal(
    changeDesktopStepLength(distance, "time", "s", swim).end.value,
    600
  )
  assert.equal(
    changeDesktopStepLength(
      { ...distance, end: { ...distance.end, value: 1609.344 } },
      "distance",
      "mi",
      swim
    ).end.value,
    1
  )
})

test("bike and run endurance defaults retain their original duration and repeat arithmetic", () => {
  for (const sport of ["Run", "Ride"]) {
    const workout = model(sport),
      unit = sport === "Run" ? "%pace" : "%ftp"
    workout.steps = ["Warm up", "Two Step Repeats", "Cool down"].flatMap(
      (name) => builderBlock(name, workout, unit, "range")
    )
    assert.equal(workoutTotals(workout).seconds, 3960)
    assert.equal(expandSteps(workout.steps).length, 10)
    assert.ok(
      expandSteps(workout.steps).every(({ step }) => !step.end.pressLap)
    )
    assert.deepEqual(
      verifyParsedWorkout(workout, {
        workout_doc: parseTestWorkout(serializeWorkout(workout)),
      }),
      []
    )
  }
})

test("cadence cannot save a reversed, missing, negative, nonfinite or out-of-bounds range", () => {
  const workout = model("Ride")
  workout.steps = builderBlock("Active", workout, "%ftp", "single")
  for (const cadence of [
    { start: 95, end: 80 },
    { start: 0, end: 90 },
    { start: 80, end: 301 },
    { start: NaN, end: 90 },
    { start: 80, end: Infinity },
  ]) {
    workout.steps[0].cadence = cadence
    assert.ok(validateWorkout(workout).some((error) => /Cadence/.test(error)))
  }
  for (const cadence of [
    { start: 80, end: 95 },
    { start: 1, end: 300 },
    { start: 90, end: 90 },
  ]) {
    workout.steps[0].cadence = cadence
    assert.deepEqual(validateWorkout(workout), [])
  }
})


test("zone clicks keep the chosen percentage basis and round fractional boundaries for all three sports", () => {
  for (const sport of ["Ride", "Run", "Swim"]) {
    const unit = sport === "Ride" ? "%ftp" : "%pace"
    const settings = [{types: [sport], ftp: 197, threshold_pace: 3,
      power_zones: [55.4, 75.2, 999], pace_zones: [86.111115, 96.42857, 999]}]
    const options = desktopWorkoutZoneOptions(model(sport), settings, unit)
    assert.deepEqual(options[1].target, {kind: sport === "Ride" ? "power" : "pace", unit, mode: "range",
      start: sport === "Ride" ? 55 : 86, end: sport === "Ride" ? 75 : 96})
    assert.equal(options[2].target.unit, sport === "Ride" ? "power_zone" : "pace_zone")
    assert.equal(options[2].target.value, 3)
    if (sport !== "Ride") assert.equal(options[0].target.unit, "pace_zone")
    assert.equal(settings[0].pace_zones[0], 86.111115, "provider configuration is never mutated")
  }
})


test("swim profiles fill the chart in the entered yard or metre scale, including short sets", () => {
  for (const unit of ["m", "yd"]) {
    const swim = model("Swim")
    swim.steps = builderBlock("Warm up", swim, "%pace", "range", {kind:"distance", unit})
    for (const value of [200, 600, 800, 1200]) {
      swim.steps[0].end.value = value
      const axis = desktopProfileAxis(swim)
      assert.equal(axis.unit, unit)
      assert.equal(axis.maximum / axis.factor, value)
      assert.equal(axis.actual / axis.factor, value)
    }
  }
})


test("desktop profiles fit observed bike and pace percentage ranges instead of shrinking cycling bars", () => {
  for (const sport of ["Ride", "Run", "Swim"]) {
    const workout = model(sport), unit = sport === "Ride" ? "%ftp" : "%pace"
    workout.steps = ["Warm up","Two Step Repeats","Cool down"].flatMap(name=>builderBlock(name,workout,unit,"range"))
    assert.equal(desktopProfileMaximum(chartSegments(workout).segments),sport === "Ride" ? 1.2 : 1.44)
  }
})


test("desktop axis retains the 100% tick and bounds work for invalid large numeric drafts", () => {
  assert.deepEqual(desktopProfileTicks(1),[0,0.25,0.5,0.75,1])
  assert.deepEqual(desktopProfileTicks(1.2),[0,0.5,1])
  const easy = model("Run")
  easy.steps = builderBlock("Warm up",easy,"%pace","range")
  assert.equal(desktopProfileMaximum(chartSegments(easy).segments),1)
  assert.deepEqual(desktopProfileTicks(1,true),[0,0.25,0.5,0.75,1])
  const ticks = desktopProfileTicks(1e12)
  assert.ok(ticks.length <= 8)
  assert.ok(ticks.every(Number.isFinite))
})

test("distance axis matches short native swim ticks and retains exact physical yard scaling",()=>{
  assert.deepEqual(desktopDistanceTicks(200),[0,50,100,150,200])
  assert.deepEqual(desktopDistanceTicks(600),[0,100,200,300,400,500,600])
  assert.deepEqual(desktopDistanceTicks(200*.9144,.9144),[0,50,100,150,200].map(value=>value*.9144))
  assert.deepEqual(desktopDistanceTicks(Infinity),[0])
  assert.ok(desktopDistanceTicks(1e100).length <=12)
})
