import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import {simpleWorkoutModel as actualSimpleWorkoutModel} from "../../app-backend/lib/simple-workout.mjs"
import {rememberPendingWorkoutCreation as actualRemember,clearPendingWorkoutCreation as actualClear,readPendingWorkoutCreation as actualRead,inspectPendingWorkoutCreation as actualInspect} from "../src/lib/pending-workout-creation.ts"

// Execute the component's real save callback with in-memory dependencies. This
// exercises its promise contract without mounting dialogs or contacting a provider.
const source = ts.createSourceFile(
  "desktop-workout-create.tsx",
  readFileSync(
    new URL("../src/components/desktop-workout-create.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const callbacks = new Map()
function findSave(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ["save", "requestClose", "prepareNavigation", "commitNavigation", "confirmDiscard", "onDiscardChange"].includes(node.name.getText(source))
  )
    callbacks.set(node.name.getText(source), node.initializer)
  ts.forEachChild(node, findSave)
}
findSave(source)
assert.ok(
  callbacks.get("save"),
  "the creation component exposes its save callback"
)
assert.ok(
  callbacks.get("requestClose"),
  "all draft dismissal goes through a guarded callback"
)
const callbackSource = (name) =>
  ts.transpileModule(
    `const ${name} = ${callbacks.get(name).getText(source)}; ${name}`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }
  ).outputText

function fixture({
  personalFailure,
  providerFailure,
  provider,
  hasDraft = true,
  uncertain = false,
  personalBusy = false,
  sport = "Swim",
} = {}) {
  const observed = {
    busy: [],
    errors: [],
    uncertain: [],
    providerCalls: 0,
    saved: 0,
    savedArguments: [],
    closed: 0,
    discarded: [],
  }
  const model = {
    version: 1,
    name: "Swim",
    sport,
    date: "2026-10-21",
    notes: "",
    steps: [],
  }
  const saving = { current: false }
  const personal = {
    busy: personalBusy,
    value: {},
    refresh: async () => {
      if (personalFailure) throw personalFailure
    },
    save: async () => {
      if (personalFailure) throw personalFailure
    },
  }
  const context = {
    yieldForWorkoutFeedback: async () => {},
    saving,
    account:{isCurrent:()=>true,ownsAccount:()=>true},
    bypassWorkoutNavigationGuard:action=>action(),
    personal,
    structure: null,
    metadata: { name: "Swim", date: model.date, time: "" },
    initialName: "Swim",
    defaultName: "Swim",
    sport,
    nativeSport: sport,
    variant: undefined,
    description: "",
    comment: "",
    recurrence: null,
    draft: {},
    blank: {},
    scope: "test",
    creationId: "creation",
    uncertain,
    mounted: { current: true },
    busy: false,
    hasDraft,
    submitted: { current: null },
    submittedExtras:{current:null},
    navigationResolve:{current:null},navigationCleanup:{current:false},discardPending:false,builder:null,clearRecovery:()=>observed.discarded.push("clear"),
    structuredClone,
    localStorage: {},
    readPendingWorkoutCreation:()=>null,
    inspectPendingWorkoutCreation:()=>({status:"empty"}),
    clearRejectedCreation:()=>{},
    rejectedCreationSection:"rejected-create",
    console,
    setBusy: (value) => observed.busy.push(value),
    setError: (value) => observed.errors.push(value),
    setUncertain: (value) => observed.uncertain.push(value),
    setRecurrence: () => {},
    setDiscardPending: (value) => observed.discarded.push(value),
    changedPlannedValues: () => ({}),
    simpleWorkoutModel: () => model,
    rememberPendingWorkoutCreation: () => true,
    clearPendingWorkoutCreation: () => {},
    retainWorkoutSaveDraft: () => {},
    clearWorkoutSaveDraft: () => {},
    createPlannedWorkout: async () => {
      observed.providerCalls++
      if (providerFailure) throw providerFailure
      if (provider) return provider()
      return { workout: { id: "event:123" } }
    },
    onClose: () => observed.closed++,
    onSaved: (...args) => {
      observed.saved++
      observed.savedArguments.push(args)
    },
    toast: { add: () => {} },
  }
  const save = runInNewContext(callbackSource("save"), context)
  const requestClose = runInNewContext(callbackSource("requestClose"), context)
  return {
    save,
    requestClose,
    observed,
    saving,
    context,
    built: { model, values: {}, personal: {}, comment: "", time: "" },
  }
}

test("Save & Close waits for app transaction acceptance and ignores duplicate-save attempts while busy", async () => {
  let resolveProvider
  const pending = new Promise((resolve) => {
    resolveProvider = resolve
  })
  const { save, requestClose, observed, saving } = fixture({
    provider: () => pending,
  })
  const attempt = save(true)
  // The transaction is still unresolved; neither dismissal nor another Save commits it twice.
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observed.providerCalls, 1)
  assert.equal(saving.current, true)
  assert.equal(observed.closed, 0)
  assert.equal(observed.saved, 0)
  requestClose()
  await save(true)
  assert.equal(observed.closed, 0)
  assert.equal(observed.providerCalls, 1)
  assert.deepEqual(observed.discarded, [])
  resolveProvider({ workout: { id: "event:confirmed" } })
  await attempt
  assert.equal(observed.saved, 1)
  assert.equal(observed.savedArguments[0][0].id, "event:confirmed")
  assert.equal(observed.savedArguments[0][1], true)
  assert.equal(observed.closed, 0)
  assert.equal(saving.current, false)
})

test("a rejected Save & Close leaves the editor open with the error and editable draft", async () => {
  const failure = Object.assign(new Error("Workout duration is invalid"), {
    status: 400,
  })
  const { save, requestClose, observed, saving, context } = fixture({
    providerFailure: failure,
  })
  await save(true)
  assert.equal(observed.saved, 0)
  assert.equal(observed.closed, 0)
  assert.equal(observed.errors.at(-1), failure.message)
  assert.equal(context.submitted.current, null)
  assert.equal(saving.current, false)
  requestClose()
  assert.deepEqual(observed.discarded, [true])
  assert.equal(observed.closed, 0)
})

test("a timed out Save & Close keeps the editor visible and retains reconciliation identity", async () => {
  const { save, observed, context } = fixture({
    providerFailure: new Error("Timed out awaiting provider confirmation"),
  })
  await save(true)
  assert.equal(observed.closed, 0)
  assert.equal(observed.saved, 0)
  assert.deepEqual(observed.uncertain, [true])
  assert.equal(context.submitted.current.creationId, "creation")
})

test("a retired creation popup cannot close a subsequently opened popup after its response", async () => {
  const { save, observed, context } = fixture()
  context.mounted.current = false
  await save(true)
  assert.equal(observed.providerCalls, 1)
  assert.equal(observed.saved, 0)
  assert.equal(observed.closed, 0)
})

test("draft dismissal confirms ordinary changes, allows blank or recoverable drafts, and blocks personal writes", async () => {
  const dirty = fixture()
  dirty.requestClose()
  assert.deepEqual(dirty.observed.discarded, [true])
  assert.equal(dirty.observed.closed, 0)
  const blank = fixture({ hasDraft: false })
  blank.requestClose()
  assert.equal(blank.observed.closed, 1)
  const pending = fixture({ uncertain: true })
  pending.requestClose()
  assert.equal(pending.observed.closed, 1)
  assert.deepEqual(pending.observed.discarded, [])
  const personalWrite = fixture({ personalBusy: true })
  personalWrite.requestClose()
  await personalWrite.save(true)
  assert.equal(personalWrite.observed.closed, 0)
  assert.equal(personalWrite.observed.providerCalls, 0)
  assert.deepEqual(personalWrite.observed.discarded, [])
})

test("legacy builder creation rejects a personal-field failure before starting a provider write", async () => {
  const failure = new DOMException("Personal fields timed out", "TimeoutError")
  const { save, observed, saving, built } = fixture({
    personalFailure: failure,
    sport: "Other",
  })
  await assert.rejects(save(false, built), (error) => error === failure)
  assert.equal(observed.providerCalls, 0)
  assert.equal(observed.saved, 0)
  assert.equal(observed.errors.at(-1), failure.message)
  assert.deepEqual(observed.busy, [true, false])
  assert.equal(saving.current, false)
})

test("builder creation propagates an unconfirmed provider failure and retains recovery status", async () => {
  const failure = Object.assign(new Error("The existing write is pending"), {
    status: 409,
    code: "CREATE_UNCONFIRMED",
  })
  const { save, observed, saving, built } = fixture({
    providerFailure: failure,
  })
  await assert.rejects(save(false, built), (error) => error === failure)
  assert.equal(observed.providerCalls, 1)
  assert.deepEqual(observed.uncertain, [true])
  assert.equal(observed.saved, 0)
  assert.equal(observed.closed, 0)
  assert.equal(saving.current, false)
})

test("legacy summary creation handles a failure locally without an unhandled rejection", async () => {
  const failure = new Error("Personal fields unavailable")
  const { save, observed } = fixture({ personalFailure: failure, sport: "Other" })
  await save(false)
  assert.equal(observed.errors.at(-1), failure.message)
  assert.equal(observed.providerCalls, 0)
  assert.equal(observed.saved, 0)
})

test("successful builder creation resolves and reports the saved workout once", async () => {
  const { save, observed, built } = fixture()
  await save(false, built)
  assert.equal(observed.providerCalls, 1)
  assert.equal(observed.saved, 1)
  assert.equal(observed.errors.at(-1), "")
  assert.deepEqual(observed.busy, [true, false])
})

test("endurance acceptance retains personal fields with the workout without awaiting their separate network service", async () => {
  for (const sport of ["Swim", "Ride", "Run"]) {
    const f = fixture({ sport, personalFailure: Error("Offline") }), received = []
    f.context.personal.value = { privateNotes: "Retained offline", tags: ["Test"] }
    f.context.createPlannedWorkout = async input => { received.push(structuredClone(input)); return { accepted: true, verified: false, workout: { id: "app:test" }, refreshWarning: "Saved on this device; sync pending." } }
    await f.save(true)
    assert.equal(received.length, 1)
    assert.deepEqual(received[0].personal, f.context.personal.value)
    assert.equal(f.observed.savedArguments[0][0].id, "app:test")
    assert.match(f.observed.savedArguments[0][2], /sync pending/)
  }
})

 test("creator two-phase guard retains recovery when a later parent cancels, and mounted builder avoids duplicate mirrored consent",async()=>{
 const f=fixture(),prepare=runInNewContext(callbackSource("prepareNavigation"),f.context),commit=runInNewContext(callbackSource("commitNavigation"),f.context),approve=runInNewContext(callbackSource("confirmDiscard"),f.context),cancel=runInNewContext(callbackSource("onDiscardChange"),f.context);
 const pending=prepare();approve();assert.equal(await pending,true);assert.deepEqual(f.observed.discarded,[true]);
 // A cancelled ancestor never calls commit, so the original recovery remains.
 const again=prepare();cancel(false);assert.equal(await again,false);assert.equal(f.observed.discarded.includes("clear"),false);
 const last=prepare();approve();assert.equal(await last,true);commit();assert.equal(f.observed.discarded.filter(value=>value==="clear").length,1);
 f.context.builder={steps:[{}]};assert.equal(await prepare(),true);
 f.context.saving.current=true;assert.equal(await prepare(),false);
})
 test("ordinary creator blocks native write if durable pending retention fails",async()=>{
 const f=fixture();f.context.rememberPendingWorkoutCreation=()=>false;await f.save(false);assert.equal(f.observed.providerCalls,0);assert.equal(f.observed.saved,0);assert.match(f.observed.errors.at(-1),/could not retain the pending save/);assert.equal(f.observed.closed,0);
})
 test("creator uncertain retries keep original native body and personal snapshot after control changes and denied rechecks",async()=>{
 const f=fixture({sport:"Other"}),sent=[],personal=[];f.context.personal.save=async(id,value)=>personal.push(structuredClone(value));f.context.personal.value={equipment:"original"};f.context.createPlannedWorkout=async input=>{sent.push(structuredClone(input));throw Object.assign(Error("Lost reply"),{status:502})};
 await f.save(false);f.context.uncertain=true;f.context.metadata={name:"Changed",date:"2026-11-05",time:"12:00"};f.context.description="Changed";f.context.comment="Changed";f.context.personal.value={equipment:"changed"};
 await f.save(false);assert.equal(sent.length,2);assert.deepEqual({...sent[0],reconcileOnly:true},sent[1]);assert.deepEqual(personal[0],personal[1]);assert.equal(f.context.submitted.current.creationId,"creation");
 f.context.createPlannedWorkout=async input=>{sent.push(structuredClone(input));throw Object.assign(Error("Denied recheck"),{status:403})};await f.save(false);assert.equal(f.context.submitted.current.creationId,"creation");assert.deepEqual(sent[2],sent[1]);assert.equal(f.observed.uncertain.includes(false),false);
})

 test("certified first rejection retains editable recovery separately and an unchanged retry reaches the provider with fresh structure IDs",async()=>{
 const f=fixture(),records=new Map(),localDrafts=[],calls=[];let commits=0;
 const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value)),removeItem:key=>records.delete(key)};
 Object.assign(f.context,{localStorage:storage,creationId:"995fb014-baa8-4b92-8c4b-9f430e540323",rememberPendingWorkoutCreation:actualRemember,clearPendingWorkoutCreation:actualClear,readPendingWorkoutCreation:actualRead,inspectPendingWorkoutCreation:actualInspect,simpleWorkoutModel:actualSimpleWorkoutModel,changedPlannedValues:()=>({duration_seconds:600}),retainWorkoutSaveDraft:(scope,id,section,value)=>localDrafts.push({scope,id,section,value}),createPlannedWorkout:async input=>{calls.push(structuredClone(input));if(calls.length===1)throw Object.assign(Error("Rejected before provider service"),{status:400});commits++;return{workout:{id:"event:123"}}}});
 await f.save(true);assert.equal(calls.length,1);assert.equal(commits,0);assert.equal(actualInspect(storage,"test").status,"empty");assert.equal(localDrafts.at(-1).section,"rejected-create");assert.equal(localDrafts.at(-1).value.reconcileOnly,false);assert.equal(f.context.submitted.current,null);
 await f.save(true);assert.equal(calls.length,2);assert.equal(commits,1);assert.notEqual(calls[0].model.steps[0].id,calls[1].model.steps[0].id,"Real model factory regenerates identifiers on a legitimate new attempt");assert.equal(calls[1].reconcileOnly,false);assert.equal(f.observed.saved,1);assert.equal(actualInspect(storage,"test").status,"empty");
})
 test("legacy certified rejected pending body is retired before edited retry without weakening immutable pending validation",async()=>{
 const f=fixture(),records=new Map(),calls=[],id="995fb014-baa8-4b92-8c4b-9f430e540323";
 const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value)),removeItem:key=>records.delete(key)};const original={model:actualSimpleWorkoutModel({name:"Rejected title",sport:"Swim",date:"2026-10-21",values:{duration_seconds:600}}),values:{duration_seconds:600},time:"",comment:"",creationId:id,descriptionMode:"manual",description:"",reconcileOnly:false};actualRemember(storage,"test",original);
 Object.assign(f.context,{localStorage:storage,creationId:id,rememberPendingWorkoutCreation:actualRemember,clearPendingWorkoutCreation:actualClear,readPendingWorkoutCreation:actualRead,inspectPendingWorkoutCreation:actualInspect,simpleWorkoutModel:actualSimpleWorkoutModel,changedPlannedValues:()=>({duration_seconds:600}),metadata:{name:"Edited retry",date:"2026-10-21",time:"08:00"},createPlannedWorkout:async input=>{calls.push(structuredClone(input));return{workout:{id:"event:123"}}}});
 await f.save(true);assert.equal(calls.length,1);assert.equal(calls[0].model.name,"Edited retry");assert.equal(calls[0].time,"08:00");assert.equal(calls[0].reconcileOnly,false);assert.equal(f.observed.saved,1);
})

 test("an ambiguous ordinary creation keeps exact pending bytes through denied rechecks and never becomes an editable rejected draft",async()=>{
 const f=fixture({uncertain:true}),records=new Map(),calls=[],rejected=[],id="995fb014-baa8-4b92-8c4b-9f430e540323";
 const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value)),removeItem:key=>records.delete(key)},original={model:actualSimpleWorkoutModel({name:"Unconfirmed title",sport:"Swim",date:"2026-10-21",values:{duration_seconds:600}}),values:{duration_seconds:600},time:"07:00",comment:"Original",creationId:id,descriptionMode:"manual",description:"Original"};actualRemember(storage,"test",original);const before=storage.getItem("workout-creation-pending:test");
 Object.assign(f.context,{localStorage:storage,creationId:id,submitted:{current:structuredClone(original)},submittedExtras:{current:{personal:{},recurrence:null}},rememberPendingWorkoutCreation:actualRemember,clearPendingWorkoutCreation:actualClear,readPendingWorkoutCreation:actualRead,inspectPendingWorkoutCreation:actualInspect,simpleWorkoutModel:actualSimpleWorkoutModel,retainWorkoutSaveDraft:(...args)=>rejected.push(args),createPlannedWorkout:async input=>{calls.push(structuredClone(input));throw Object.assign(Error("Denied reconciliation"),{status:calls.length===1?403:400})}});
 await f.save(true);await f.save(true);assert.equal(calls.length,2);assert.deepEqual(calls[0],{...original,reconcileOnly:true});assert.deepEqual(calls[1],calls[0]);assert.equal(storage.getItem("workout-creation-pending:test"),before);assert.deepEqual(rejected,[]);assert.equal(f.observed.uncertain.includes(false),false);assert.equal(f.context.submitted.current.creationId,id);assert.equal(f.observed.saved,0);
})

 test("creator attachment binding disables its visible and hidden controls during uncertain, busy, or personal/file writes",()=>{
 let attachment,disabled;const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==="WorkoutAttachments")attachment=node;if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="disabled")disabled=node.initializer;ts.forEachChild(node,visit)};visit(source);const prop=attachment.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(source)==="disabled");assert.ok(prop?.initializer?.expression);
 const evaluate=(expression,state)=>runInNewContext(ts.transpileModule("("+expression.getText(source)+")",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,state);
 for(const extra of [{uncertain:true},{busy:true},{personal:{busy:true}},{files:{busy:true}}]){const state={uncertain:false,busy:false,personal:{busy:false},files:{busy:false},...extra};state.disabled=evaluate(disabled,state);assert.equal(evaluate(prop.initializer.expression,state),true,JSON.stringify(extra))}
 assert.equal(evaluate(prop.initializer.expression,{disabled:false,files:{busy:false}}),false);
})

 test("reloaded creator snapshots remain local while every recheck sends exactly the original public body",async()=>{
 const f=fixture({uncertain:true}),records=new Map(),sent=[],savedPersonal=[],retainedRecurrence=[],appliedRecurrence=[],id="995fb014-baa8-4b92-8c4b-9f430e540323",scope="test";
 const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value)),removeItem:key=>records.delete(key)};
 const original={model:actualSimpleWorkoutModel({name:"Original title",sport:"Run",date:"2026-10-21",values:{duration_seconds:600}}),values:{duration_seconds:600,tss:0},time:"07:15",comment:"Original comment",creationId:id,descriptionMode:"manual",description:""},extras={personal:{equipment:"Original shoes",notes:"Original private note"},recurrence:{operationId:"repeat-original",frequency:"weekly"}};
 actualRemember(storage,scope,{...original,creatorSnapshot:extras,editorSnapshot:{localOnly:true},otherLocalExtension:"never send"});const raw=storage.getItem("workout-creation-pending:test"),recovered=actualRead(storage,scope);assert.deepEqual(recovered.creatorSnapshot,extras);
 Object.assign(f.context,{localStorage:storage,creationId:id,submitted:{current:recovered},submittedExtras:{current:recovered.creatorSnapshot},rememberPendingWorkoutCreation:actualRemember,clearPendingWorkoutCreation:actualClear,readPendingWorkoutCreation:actualRead,inspectPendingWorkoutCreation:actualInspect,personal:{busy:false,value:{equipment:"Changed live shoes"},save:async(target,value)=>savedPersonal.push({target,value:structuredClone(value)})},retainWorkoutSaveDraft:(scope,target,section,value)=>retainedRecurrence.push({target,section,value:structuredClone(value)}),applyWorkoutRecurrence:async(target,value)=>appliedRecurrence.push({target,value:structuredClone(value)}),createPlannedWorkout:async input=>{sent.push(structuredClone(input));if(sent.length===1)throw Object.assign(Error("Recheck not yet confirmed"),{status:503});return{workout:{id:"event:123"}}}});
 await f.save(false);assert.deepEqual(sent[0],{...original,reconcileOnly:true});assert.equal(storage.getItem("workout-creation-pending:test"),raw);assert.deepEqual(actualRead(storage,scope).creatorSnapshot,extras);assert.deepEqual(savedPersonal[0].value,extras.personal);assert.deepEqual(retainedRecurrence[0].value,extras.recurrence);assert.equal(f.observed.saved,0);
 await f.save(false);assert.deepEqual(sent[1],sent[0]);assert.deepEqual(savedPersonal.at(-1),{target:"event:123",value:extras.personal});assert.deepEqual(appliedRecurrence,[{target:"event:123",value:extras.recurrence}]);assert.equal(f.observed.saved,1);assert.equal(actualInspect(storage,scope).status,"empty");
})
