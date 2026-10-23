import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import {
  builderWorkoutModel,
  hasWorkoutStructure,
} from "../src/lib/unstructured-workout.ts"
import { simpleWorkoutModel } from "../../app-backend/lib/simple-workout.mjs"
import { hasWorkoutProfile } from "../src/lib/workout-profile-visibility.ts"
import { calendarProfilePath } from "../src/lib/calendar-profile.ts"
import {
  newStep,
  newRepeat,
  validateWorkout,
} from "../../app-backend/lib/workout-editor-model.mjs"
import {
  readPendingWorkoutCreation,
  rememberPendingWorkoutCreation,
} from "../src/lib/pending-workout-creation.ts"

test("simple duration/distance sessions keep executable steps without displaying a profile", () => {
  for (const sport of ["Swim", "Ride", "Run"]) {
    for (const values of [{ duration_seconds: 1800 }, { distance_meters: 1000 }, { duration_seconds: 1800, distance_meters: 1000 }]) {
      const model = simpleWorkoutModel({ name: "Simple session", sport, date: "2026-10-23", values })
      const saved = structuredClone(model)
      const workout = { editor_model: model }
      assert.equal(model.steps.length, 1, "Provider prescription must remain executable")
      assert.equal(hasWorkoutProfile(workout), false)
      assert.equal(calendarProfilePath(workout), null)
      assert.deepEqual(model, saved)
    }
  }
})

test("real targeted intervals, repeats and recovery blocks retain their profiles", () => {
  const model = simpleWorkoutModel({ name: "Intervals", sport: "Run", date: "2026-10-23", values: { duration_seconds: 1800 } })
  for (const steps of [[newStep("Run")], [newRepeat([newStep("Run")])], [model.steps[0], { ...model.steps[0], id: "recovery", role: "recovery" }]]) {
    const workout = { editor_model: { ...model, steps } }
    assert.equal(hasWorkoutProfile(workout), true)
    assert.match(calendarProfilePath(workout), /^M0,20/)
    assert.equal(hasWorkoutProfile({ ...workout, unstructured: true }), false)
    assert.equal(hasWorkoutProfile({ editor_model: { ...workout.editor_model, unstructured: true } }), false)
  }
})

test("native provider simple sessions are hidden, while targets and repeats remain visible", () => {
  for (const step of [{ duration: 1800 }, { distance: 1000 }, { duration: 1800, distance: 1000, text: "Intervals in the title do not imply a profile" }]) {
    for (const structure of [[step], { steps: [step] }, { structure: [step] }]) {
      const workout = { structure: JSON.stringify(structure) }
      assert.equal(hasWorkoutProfile(workout), false)
      assert.equal(calendarProfilePath(workout), null)
    }
  }
  for (const steps of [[{ duration: 600, pace: { value: 480, units: "secs/mi" } }], [{ reps: 3, steps: [{ duration: 60 }] }], [{ duration: 600 }, { duration: 60, intensity: "rest" }]]) {
    assert.equal(hasWorkoutProfile({ structure: JSON.stringify({ steps }) }), true)
  }
  for (const structure of [undefined, "", "bad JSON", "null", "[]", "[null]"]) {
    assert.equal(hasWorkoutProfile({ structure }), false)
  }
})

test("title-only simple session stays freeform, but entering a builder removes its empty-step exemption", () => {
  const simple = simpleWorkoutModel({
    name: "Day off",
    sport: "Run",
    date: "2026-10-21",
    description: "",
    values: {},
  })
  assert.equal(simple.unstructured, true)
  assert.deepEqual(simple.steps, [])
  assert.deepEqual(validateWorkout(simple), [])
  assert.equal(hasWorkoutStructure(simple), false)
  const builder = builderWorkoutModel(simple)
  assert.equal(Object.hasOwn(builder, "unstructured"), false)
  assert.ok(
    validateWorkout(builder).length,
    "An empty interval builder must remain invalid"
  )
  assert.equal(
    simple.unstructured,
    true,
    "The saved simple model cannot be mutated by opening its builder"
  )
  const withInterval = builderWorkoutModel({
    ...simple,
    steps: [newStep("Run")],
  })
  assert.equal(hasWorkoutStructure(withInterval), true)
  assert.deepEqual(validateWorkout(withInterval), [])
})

test("unstructured pending-create recovery preserves empty description and absent totals", () => {
  const store = new Map(),
    storage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    }
  const input = {
    model: simpleWorkoutModel({
      name: "Easy day",
      sport: "Run",
      date: "2026-10-21",
      description: "",
      values: {},
    }),
    values: {},
    time: "",
    comment: "",
    creationId: "bb85482d-5953-458b-9f48-8a0e7356b17b",
    descriptionMode: "manual",
    description: "",
  }
  rememberPendingWorkoutCreation(storage, "isolated", input)
  assert.deepEqual(readPendingWorkoutCreation(storage, "isolated"), input)
})

// Legacy non-endurance writes still await provider confirmation. Endurance
// saves below assert the independent durable transaction boundary instead.
const source = ts.createSourceFile(
  "desktop-workout-details.tsx",
  readFileSync(
    new URL("../src/components/desktop-workout-details.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let saveNode
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "save")
    saveNode = node.initializer
  ts.forEachChild(node, find)
}
find(source)
assert.ok(saveNode)
const callback = ts.transpileModule(
  `const save=${saveNode.getText(source)};save`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture({
  valuesDirty = true,
  busy = false,
  provider,
  description,
  personalFailure,
  durableSave = false,
  transaction,
  model,
} = {}) {
  const calls = {
    close: 0,
    provider: 0,
    description: 0,
    retained: 0,
    cleared: 0,
    confirmed: 0,
    failed: 0,
    error: "",
    busy: [],
    atomic: 0,
    atomicInput: null,
    textAccepted: 0,
    personalAccepted: 0,
  }
  const scope = {
    yieldForWorkoutFeedback: async () => {},
    requireCurrentAccount: () => {},
    busy,
    saving: { current: false },
    valuesDirty,
    completedDirty:false, completedDraft:{}, completedSavedRef:{current:{}}, setCompletedSaved:()=>{}, activityId:null,
    editable: true,
    durableSave,
    loading: false,
    revision: "a".repeat(64),
    draft: {},
    saved: {},
    sport: "Run",
    scope: "isolated",
    workout: { id: "event:123", title:"Title-only revised",workout_date:"2026-10-21",sport:"Run",editor_model:model || simpleWorkoutModel({name:"Unstructured",sport:"Run",date:"2026-10-21",unstructured:true}) },
    metadata: {name:"Title-only revised",date:"2026-10-21",time:"06:30"},
    editorModel:{current:undefined},
    editorZones:{current:[]},
    loadGeneration:{current:0},
    localCommittedWorkout:()=>null,
    structuredClone,
    simpleWorkoutModel,
    metadataPatch: { name: "Title-only revised" },
    changedPlannedValues: () => ({}),
    setBusy: (value) => calls.busy.push(value),
    setError: (value) => {
      calls.error = value
    },
    setNotice: () => {},
    personal: {
      value:{privateNotes:"Exact private notes",tags:[],equipment:""},
      acceptCommitted:()=>calls.personalAccepted++,
      dirty: Boolean(personalFailure),
      save: async () => {
        if (personalFailure) throw Error("Personal save failed")
      },
    },
    text: {
      description:"Exact human description",
      comment:"A comment",
      creationId:"comment-uuid",
      comments:[],
      acceptCommitted:()=>calls.textAccepted++,
      dirty: false,
      retain: () => calls.retained++,
      save: async () => {
        calls.description++
        if (description) await description.promise
      },
    },
    beginWorkoutSaveFeedback: () => ({
      confirm: () => calls.confirmed++,
      fail: () => calls.failed++,
    }),
    retainWorkoutSaveDraft: () => "token",
    clearWorkoutSaveDraft: () => calls.cleared++,
    savePlannedWorkoutValues: async () => {
      calls.provider++
      return provider
        ? await provider.promise
        : {
            revision: "b".repeat(64),
            workout: { workout_summary: { planned: {} } },
          }
    },
    writeWorkoutEditor:async (_id,input)=>{
      calls.atomic++
      calls.atomicInput=input
      if(transaction) return await transaction.promise
      return {accepted:true,verified:false,revision:"local:1",workout:{workout_summary:{planned:{}}},refreshWarning:"Saved on this device; sync pending."}
    },
    plannedValueDraft: (value) => value,
    setSaved: () => {},
    setDraft: () => {},
    setRevision: () => {},
    setLoading: () => {},
    load: async () => {},
    onClose: () => calls.close++,
    Error,
  }
  return { calls, save: runInNewContext(callback, scope) }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test("details Save & Close waits for provider and description, then closes exactly once", async () => {
  const provider = deferred(),
    description = deferred(),
    f = fixture({ provider, description })
  const pending = f.save(true)
  await tick()
  assert.equal(f.calls.close, 0)
  assert.equal(f.calls.provider, 1)
  assert.equal(f.calls.retained, 1)
  await f.save(true)
  assert.equal(f.calls.provider, 1, "Duplicate saves are suppressed")
  provider.resolve({
    revision: "b".repeat(64),
    workout: { workout_summary: { planned: {} } },
  })
  await tick()
  assert.equal(f.calls.description, 1)
  assert.equal(f.calls.close, 0)
  description.resolve()
  await pending
  assert.equal(f.calls.close, 1)
  assert.equal(f.calls.confirmed, 1)
  assert.equal(f.calls.cleared, 1)
  assert.deepEqual(f.calls.busy, [true, false])
})

test("provider or description failure leaves details open with its retained draft and actionable error", async () => {
  for (const failing of ["provider", "description"]) {
    const provider = deferred(),
      description = deferred(),
      f = fixture({ provider, description }),
      pending = f.save(true)
    if (failing === "provider")
      provider.reject(Error("Provider rejected title-only save"))
    else {
      provider.resolve({
        revision: "b".repeat(64),
        workout: { workout_summary: { planned: {} } },
      })
      await tick()
      description.reject(Error("Description could not be saved"))
    }
    await pending
    assert.equal(f.calls.close, 0)
    assert.equal(f.calls.failed, 1)
    assert.equal(f.calls.retained, 1)
    assert.match(f.calls.error, /Provider rejected|Description could/)
  }
})

test("busy details never starts a write and ordinary Save keeps the dialog open", async () => {
  const blocked = fixture({ busy: true })
  await blocked.save(true)
  assert.equal(blocked.calls.provider, 0)
  assert.equal(blocked.calls.close, 0)
  const saved = fixture()
  await saved.save(false)
  assert.equal(saved.calls.provider, 1)
  assert.equal(saved.calls.close, 0)
  assert.equal(saved.calls.confirmed, 1)
})

test("description-only close awaits its write without requiring duration or creating a values mutation", async () => {
  const description = deferred(),
    f = fixture({ valuesDirty: false, description }),
    pending = f.save(true)
  await tick()
  assert.equal(f.calls.provider, 0)
  assert.equal(f.calls.close, 0)
  description.resolve()
  await pending
  assert.equal(f.calls.close, 1)
  const personal = fixture({ personalFailure: true })
  await personal.save(true)
  assert.equal(personal.calls.provider, 0)
  assert.equal(personal.calls.close, 0)
})

test("endurance Save & Close waits only for durable app acceptance and atomically includes every field", async () => {
  const transaction=deferred(), f=fixture({durableSave:true,transaction})
  const pending=f.save(true)
  await tick()
  assert.equal(f.calls.atomic,1)
  assert.equal(f.calls.provider,0)
  assert.equal(f.calls.description,0)
  assert.equal(f.calls.close,0)
  assert.equal(f.calls.personalAccepted,0)
  await f.save(true)
  assert.equal(f.calls.atomic,1,"a duplicate click cannot start another transaction")
  transaction.resolve({accepted:true,verified:false,revision:"local:1",workout:{workout_summary:{planned:{}}},refreshWarning:"Saved on this device; sync pending."})
  await pending
  assert.equal(f.calls.close,1)
  assert.equal(f.calls.confirmed,0,"a local transaction cannot claim Intervals.icu sync")
  assert.equal(f.calls.personalAccepted,1)
  assert.equal(f.calls.textAccepted,1)
  const input=f.calls.atomicInput
  assert.equal(input.model.unstructured,true)
  assert.deepEqual(input.model.steps,[])
  assert.equal(input.model.name,"Title-only revised")
  assert.equal(input.description,"Exact human description")
  assert.equal(input.comment,"A comment")
  assert.equal(input.commentId,"comment-uuid")
  assert.equal(input.time,"06:30")
  assert.equal(input.personal.privateNotes,"Exact private notes")
})

test("failed endurance persistence retains every draft without publishing saved state", async () => {
  const transaction=deferred(), f=fixture({durableSave:true,transaction})
  const pending=f.save(true)
  transaction.reject(Error("Device storage is full"))
  await pending
  assert.equal(f.calls.close,0)
  assert.equal(f.calls.cleared,0)
  assert.equal(f.calls.textAccepted,0)
  assert.equal(f.calls.personalAccepted,0)
  assert.equal(f.calls.failed,1)
  assert.match(f.calls.error,/storage is full/)
})

test("endurance summary metadata preserves the full structured prescription instead of flattening it",async()=>{
  const model=simpleWorkoutModel({name:"Structured",sport:"Run",date:"2026-10-21",values:{duration_seconds:600}})
  model.steps[0].notes="Keep this coaching cue"
  model.steps[0].target={kind:"pace",unit:"secs/km",mode:"range",start:270,end:300}
  const f=fixture({durableSave:true,model})
  await f.save(false)
  assert.deepEqual(f.calls.atomicInput.model.steps,model.steps)
  assert.equal(f.calls.atomicInput.model.name,"Title-only revised")
  assert.equal(model.name,"Structured","the source model remains immutable")
})
