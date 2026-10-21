import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

function actual(path, predicate, context) {
  const file = ts.createSourceFile(
    path,
    readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let found
  const visit = (node) => {
    if (predicate(node, file)) {
      assert.equal(found, undefined)
      found = node
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found)
  const initializer = found.initializer
  const text = ts.isMethodDeclaration(found)
    ? `async function ${found.name.getText(file)}${found.getText(file).slice(found.getText(file).indexOf("("))}`
    : ts.isCallExpression(initializer) &&
        initializer.expression.getText(file) === "useCallback"
      ? initializer.arguments[0].getText(file)
      : initializer.getText(file)
  return runInNewContext(
    ts.transpileModule(`(${text})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { Error, yieldForWorkoutFeedback: async () => {}, ...context }
  )
}
const variable = (name) => (node, file) =>
  ts.isVariableDeclaration(node) && node.name.getText(file) === name
const guard = () => {
  let current = true
  return {
    revoke() {
      current = false
    },
    requireCurrentAccount() {
      if (!current) throw Error("Account changed")
    },
  }
}
const feedback = {
  confirm() {
    throw Error("A revoked save cannot confirm")
  },
  fail() {},
}

test("actual text save cannot post a comment or publish saved state after its description awaited across an account change", async () => {
  const account = guard(),
    writes = [],
    state = []
  const save = actual("hooks/use-workout-text-draft.ts", variable("save"), {
    editable: true,
    dirty: true,
    scope: "old-owner",
    workout: { id: "event:11" },
    description: "Human text",
    savedDescription: "Original",
    comment: "Private comment",
    creationId: "uuid",
    requireCurrentAccount: account.requireCurrentAccount,
    retainWorkoutSaveDraft: () => "token",
    beginWorkoutSaveFeedback: () => feedback,
    queueWorkoutMutation: async () => {
      writes.push("description")
      account.revoke()
    },
    saveWorkoutComment: async () => {
      writes.push("comment")
    },
    setSavedDescription: () => state.push("description"),
    clearWorkoutSaveDraft: () => state.push("clear"),
  })
  await assert.rejects(save(), /Account changed/)
  assert.deepEqual(writes, ["description"])
  assert.deepEqual(state, [])
})

test("actual details save stops before planned values/text when personal fields finish under a revoked account", async () => {
  const account = guard(),
    writes = [],
    errors = []
  const save = actual(
    "components/desktop-workout-details.tsx",
    variable("save"),
    {
      busy: false,
      saving: { current: false },
      valuesDirty: true,
      editable: true,
      durableSave:false,
      loading: false,
      revision: "R1",
      draft: {},
      saved: {},
      sport: "Ride",
      workout: { id: "event:11" },
      changedPlannedValues: () => ({ tss: 12 }),
      setBusy() {},
      setError: (value) => errors.push(value),
      setNotice() {},
      beginWorkoutSaveFeedback: () => feedback,
      requireCurrentAccount: account.requireCurrentAccount,
      personal: {
        dirty: true,
        async save() {
          writes.push("personal")
          account.revoke()
        },
      },
      text: {
        retain() {
          writes.push("retain")
        },
        async save() {
          writes.push("text")
        },
      },
      savePlannedWorkoutValues: async () => {
        writes.push("values")
      },
    }
  )
  await save(true)
  assert.deepEqual(writes, ["personal"])
  assert.deepEqual(errors, ["", "Account changed"])
})

test("durable details acceptance under a revoked account cannot publish saved fields or close the new account's dialog", async () => {
  const account=guard(),writes=[],state=[],errors=[]
  const model={version:1,name:"Run",sport:"Run",date:"2026-10-21",notes:"",poolLength:"",steps:[{id:"a",kind:"step",label:"Active",notes:"",role:"active",end:{kind:"time",unit:"s",value:600},target:{kind:"none"},cadence:null}]}
  const save=actual("components/desktop-workout-details.tsx",variable("save"),{
    busy:false,saving:{current:false},valuesDirty:true,editable:true,durableSave:true,
    loading:false,revision:"R1",draft:{},saved:{},sport:"Run",scope:"old-owner",
    workout:{id:"event:11",title:"Run",workout_date:"2026-10-21",editor_model:model},metadata:undefined,metadataPatch:{},
    editorModel:{current:model},editorZones:{current:[]},loadGeneration:{current:0},localCommittedWorkout:()=>null,structuredClone,
    changedPlannedValues:()=>({tss:12}),setBusy(){},setError:value=>errors.push(value),setNotice:value=>{if(value)state.push("notice")},
    beginWorkoutSaveFeedback:()=>feedback,requireCurrentAccount:account.requireCurrentAccount,
    personal:{value:{},acceptCommitted:()=>state.push("personal")},
    text:{description:"",comment:"",creationId:"uuid",comments:[],retain(){},acceptCommitted:()=>state.push("text")},
    retainWorkoutSaveDraft:()=>"retained",clearWorkoutSaveDraft:()=>state.push("cleared"),
    writeWorkoutEditor:async()=>{writes.push("atomic-old-account");account.revoke();return{revision:"local:1",workout:{workout_summary:{planned:{}}}}},
    onClose:()=>state.push("close"),
  })
  await save(true)
  assert.deepEqual(writes,["atomic-old-account"])
  assert.deepEqual(state,[])
  assert.deepEqual(errors,["","Account changed"])
})

test("actual personal load cannot import old local metadata after a delayed read changes account", async () => {
  const account = guard(),
    writes = []
  const load = actual(
    "components/desktop-workout-personal-fields.tsx",
    variable("load"),
    {
      setLoading() {},
      snapshotRef: { current: null },
      acceptedEpoch:{current:0},
      local: { notes: "Old private notes" },
      activeId: { current: "event:11" },
      requireCurrentAccount: account.requireCurrentAccount,
      loadWorkoutPersonal: async () => {
        account.revoke()
        return { exists: false, revision: "R1" }
      },
      hasWorkoutPersonalFields: () => true,
      saveWorkoutPersonal: async () => {
        writes.push("import")
      },
      setError() {},
    }
  )
  await assert.rejects(load(), /Account changed/)
  assert.deepEqual(writes, [])
})

test("actual personal save cannot transfer a private draft after its source lookup changes account", async () => {
  const account = guard(),
    writes = []
  const save = actual(
    "components/desktop-workout-personal-fields.tsx",
    (node, file) =>
      ts.isMethodDeclaration(node) && node.name.getText(file) === "save",
    {
      activeId: { current: "event:11" },
      value: { notes: "Old private notes" },
      saved: {},
      setBusy() {},
      setError() {},
      requireCurrentAccount: account.requireCurrentAccount,
      ensureLoaded: async () => {
        account.revoke()
        return { value: {}, revision: "R1" }
      },
      saveWorkoutPersonal: async () => {
        writes.push("private-write")
      },
      retainWorkoutSaveDraft: () => {
        writes.push("retain")
      },
    }
  )
  await assert.rejects(save(), /Account changed/)
  assert.deepEqual(writes, [])
})

test("a personal read started before durable acceptance cannot replace its accepted baseline",async()=>{
  const epoch={current:0},state=[]
  const load=actual("components/desktop-workout-personal-fields.tsx",variable("load"),{
    acceptedEpoch:epoch,setLoading(){},snapshotRef:{current:null},local:{},activeId:{current:"event:11"},
    requireCurrentAccount(){},loadWorkoutPersonal:async()=>{epoch.current++;return{exists:true,revision:"old",value:{privateNotes:"Old"}}},
    hasWorkoutPersonalFields:()=>false,removeWorkoutLocalMetadata:()=>state.push("remove"),setSnapshot:()=>state.push("snapshot"),setSaved:()=>state.push("saved"),setValue:()=>state.push("value"),setError:()=>state.push("error"),
  })
  const result=await load()
  assert.equal(result.revision,"old","the original caller can complete while stale state publication is fenced")
  assert.deepEqual(state,[])
})
