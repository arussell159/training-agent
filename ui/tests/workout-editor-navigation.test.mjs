import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "../node_modules/typescript/lib/typescript.js"

const file = ts.createSourceFile(
  "workout-editor.tsx",
  readFileSync(
    new URL("../src/components/workout-editor.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
function find(predicate) {
  let found
  function visit(node) {
    if (predicate(node)) found = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found)
  return found
}
function evaluate(node, values) {
  const text = typeof node === "string" ? node : node.getText(file),
    js = ts.transpileModule(`const callback=${text}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
  return new Function(...Object.keys(values), js + ";return callback")(
    ...Object.values(values)
  )
}
function callback(name, values) {
  return evaluate(
    find(
      (node) =>
        ts.isVariableDeclaration(node) && node.name.getText(file) === name
    ).initializer,
    values
  )
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(extra = {}) {
  const events = [],
    state = {
      Error,
      saving: false,
      dirty: true,
      mobile: false,
      isNew: false,
      status: "draft",
      recovered: null,
      creationAttempted: false,
      externalCreationPending: false,
      creationSnapshot: {current:null},
      pendingStrength: null,
      model: { steps: [], sport: "Run" },
      personal: { busy: false, value: {}, save: async () => {} },
      files: { busy: false },
      templateOpen: false,
      saveInFlight: { current: false },
      deleteInFlight: { current: false },
      discardIntent: { current: null },
      navigationDiscard: { current: null },
      navigationCleanup: {current:false},
      editorNavigation: { current: { dirty: true, decide: async () => false } },
      editorAccount: { isCurrent: () => true, ownsAccount: () => true },
      localStorage: { removeItem: (key) => events.push(["clear", key]) },
      draftKey: "original-draft",
      onClose: () => events.push(["close"]),
      onSaveClose: undefined,
      setNotice: (message) => events.push(["notice", message]),
      setDiscardOpen: (open) => events.push(["dialog", open]),
      setStatus: (status) => events.push(["status", status]),
      storeDraft: () => {
        events.push(["retain"])
        return true
      },
      bypassWorkoutNavigationGuard: (action) => {
        events.push(["bypass"])
        action()
      },
      confirmWithFramework7: async () => false,
      ...extra,
    }
  state.assertEditorOwner = callback("assertEditorOwner", state)
  state.commitEditorNavigation = callback("commitEditorNavigation", state)
  state.discardAndClose = callback("discardAndClose", state)
  state.onDiscardOpenChange = callback("onDiscardOpenChange", state)
  return {
    state,
    events,
    navigate: callback("requestEditorNavigation", state),
    close: callback("requestClose", state),
  }
}
test("actual priority10 editor registration owns the latest decision and cleanup cancels a pending exit", async () => {
  const node = find(
      (node) =>
        ts.isCallExpression(node) &&
        node.expression.getText(file) === "useEffect" &&
        node.arguments[0]
          ?.getText(file)
          .includes("registerWorkoutNavigationGuard(")
    ),
    f = fixture(),
    registered = [],
    resolved = []
  f.state.navigationDiscard.current = (allowed) => resolved.push(allowed)
  const cleanup = evaluate(node.arguments[0], {
    ...f.state,
    registerWorkoutNavigationGuard: (...args) => {
      registered.push(args)
      return () => registered.push("unregistered")
    },
  })()
  assert.equal(registered[0][2], 10)
  f.state.editorNavigation.current = { dirty: false, decide: async () => true }
  assert.equal(await registered[0][0](), true)
  assert.equal(registered[0][1](), false)
  cleanup()
  assert.deepEqual(resolved, [false])
  assert.equal(registered.at(-1), "unregistered")
})
test("actual global discard confirmation clears recovery once without issuing editor close; Cancel keeps everything", async () => {
  const f = fixture(),
    pending = f.navigate()
  assert.deepEqual(f.events, [["dialog", true]])
  assert.equal(
    await f.navigate(),
    false,
    "A second exit cannot own the first dialog"
  )
  f.state.discardAndClose()
  assert.equal(await pending, true)
  assert.deepEqual(f.events, [["dialog",true]], "Consent alone preserves recovery for parent cancellation")
  f.state.commitEditorNavigation()
  assert.deepEqual(f.events, [
    ["dialog", true],
    ["clear", "original-draft"],
  ])
  const cancelled = fixture(),
    waiting = cancelled.navigate()
  cancelled.state.onDiscardOpenChange(false)
  assert.equal(await waiting, false)
  assert.deepEqual(cancelled.events, [
    ["dialog", true],
    ["dialog", false],
  ])
})
test("sync save/delete flags and personal/files/template/local-dialog work block outer navigation before React updates", async () => {
  for (const extra of [
    { saveInFlight: { current: true } },
    { deleteInFlight: { current: true } },
    { personal: { busy: true } },
    { files: { busy: true } },
    { templateOpen: true },
    { discardIntent: { current: "local" } },
    { editorAccount: { isCurrent: () => false, ownsAccount: () => false } },
  ]) {
    const f = fixture(extra)
    assert.equal(await f.navigate(), false)
    f.close()
    assert.deepEqual(f.events, [])
  }
})
test("new generated nonempty content prompts even when clean; clean saved content retires a reverted snapshot and permits navigation", async () => {
  const generated = fixture({
      dirty: false,
      isNew: true,
      model: { steps: [{}] },
    }),
    pending = generated.navigate()
  assert.deepEqual(generated.events, [["dialog", true]])
  generated.state.onDiscardOpenChange(false)
  assert.equal(await pending, false)
  const clean = fixture({ dirty: false })
  assert.equal(await clean.navigate(), true)
  assert.deepEqual(clean.events, [])
  clean.state.commitEditorNavigation()
  assert.deepEqual(clean.events, [["clear", "original-draft"]])
})
test("uncertain creates retain their original intent without discard, and denied retention cannot navigate", async () => {
  for (const model of [
    { steps: [], sport: "Run" },
    { steps: [], strength: { blocks: [] } },
  ]) {
    const f = fixture({ creationAttempted: true, model })
    assert.equal(await f.navigate(), true)
    assert.deepEqual(f.events, [["retain"]])
    const failed = fixture({
      creationAttempted: true,
      model,
      storeDraft: () => false,
    })
    assert.equal(await failed.navigate(), false)
    assert.deepEqual(failed.events, [])
  }
})
test("failed actual discard blocks global navigation and keeps the editor; own confirmed close uses bypass exactly once", async () => {
  const f = fixture({
      localStorage: {
        removeItem() {
          throw Error("Blocked storage")
        },
      },
    }),
    pending = f.navigate()
  f.state.discardAndClose()
  assert.equal(await pending, true)
  assert.throws(()=>f.state.commitEditorNavigation(), /Blocked storage/)
  assert.equal(
    f.events.some((item) => item[0] === "close"),
    false
  )
  assert.match(f.events.at(-1)[1], /could not be discarded/)
  const own = fixture()
  own.close()
  own.state.discardAndClose()
  assert.deepEqual(own.events, [
    ["dialog", true],
    ["clear", "original-draft"],
    ["bypass"],
    ["close"],
  ])
})

test("an account change while discard confirmation is open cannot delete the old recovery or approve navigation", async () => {
  let current = true
  const f = fixture({ editorAccount: { isCurrent: () => current, ownsAccount: () => current } }), pending = f.navigate()
  current = false
  f.state.discardAndClose()
  assert.equal(await pending, false)
  assert.deepEqual(f.events, [["dialog",true]])
})
test("both actual builder JSX bindings use the shared sync-locked delete callback", () => {
  for (const component of ["DesktopStrengthBuilder", "DesktopWorkoutBuilder"]) {
    const node = find(
        (node) =>
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(file) === component
      ),
      prop = node.attributes.properties.find(
        (prop) =>
          ts.isJsxAttribute(prop) && prop.name.getText(file) === "onDelete"
      )
    assert.equal(prop.initializer.expression.getText(file), "deleteWorkout")
  }
})
test("actual shared delete awaits one callback, blocks navigation while held and fences changed account on return", async () => {
  const held = deferred()
  let requests = 0,
    current = true
  const f = fixture({
      onDelete: () => {
        requests++
        return held.promise
      },
      editorAccount: { isCurrent: () => current, ownsAccount: () => current },
    }),
    remove = callback("deleteWorkout", f.state),
    pending = remove()
  await remove()
  assert.equal(requests, 1)
  assert.equal(await f.navigate(), false)
  current = false
  held.resolve()
  await assert.rejects(pending, /connected account changed/)
  assert.equal(f.state.deleteInFlight.current, false)
  assert.deepEqual(f.events, [["status", "saving"]])
})

function saveFixture(extra = {}) {
  const f = fixture(),
    observed = {
      native: 0,
      personal: 0,
      committed: 0,
      fail: 0,
      finished: 0,
      saved: 0,
      closed: 0,
      cleared: 0,
    },
    live = { owner: true, mounted: true },
    state = {
      ...f.state,
      canSave: true,
      yieldForWorkoutFeedback: async () => {},
      inputValidity: { isValid: () => true },
      loaded: {},
      isNew: true,
      savedId: "",
      personalId: "draft:original",
      personalScope: "owner-A",
      creationId: "original-create",
      revision: "new",
      desktopTime: "",
      desktopDraft: {},
      desktopPlanned: {},
      desktopSavedValues: {},
      desktopComment: "",
      desktopComments: [],
      desktopCommentId: "comment-ID",
      nativeDescription: "Original instructions",
      autoCalculate: false,
      manualValues: true,
      recurrence: null,
      onApplyDraft: undefined,
      model: {
        version: 1,
        sport: "WeightTraining",
        name: "Saved",
        date: "2026-10-21",
        notes: "Original instructions",
        steps: [],
        strength: { version: 1, blocks: [] },
      },
      modelDirty: true,
      desktopRemoteDirty: true,
      presentationSport: "WeightTraining",
      editorAccount: {
        ownsAccount: () => live.owner,
        isCurrent: () => live.owner && live.mounted,
      },
      personal: {
        busy: false,
        value: {},
        save: async () => {
          observed.personal++
        },
        setValue() {},
        acceptCommitted() {},
      },
      localStorage: {
        setItem() {},
        removeItem() {
          observed.cleared++
        },
      },
      cachedTrainingContext: () => ({ planned: [], history: [] }),
      workoutTotals: () => ({ seconds: 0, load: null }),
      changedPlannedValues: () => ({}),
      plannedValueDraft: () => ({}),
      clone: (value) => structuredClone(value),
      beginOptimisticWorkoutWrite: () => ({
        commit(workout) {
          observed.committed++
          return { workout, applied: true }
        },
        confirm() {},
        fail() {
          observed.fail++
        },
        finish() {
          observed.finished++
        },
      }),
      writeWorkoutEditor: async () => {
        observed.native++
        return { workout: { id: "event:333" }, revision: "verified" }
      },
      rememberPendingWorkoutCreation: () => true,
      clearPendingWorkoutCreation() {},
      applyWorkoutRecurrence: async () => {},
      setCreationAttempted() {},
      setSavedId() {},
      setRevision() {},
      setBaseline() {},
      setRecovered() {},
      setRecurrence() {},
      setDesktopSavedValues() {},
      setDesktopDescriptionBaseline() {},
      setDesktopComments() {},
      setDesktopComment() {},
      setDesktopCommentId() {},
      setDesktopBaseline() {},
      setError() {},
      uid: () => "next-comment",
      window: { dispatchEvent() {} },
      CustomEvent: class {},
      onSaved: () => {
        observed.saved++
      },
      onClose: () => {
        observed.closed++
        live.mounted = false
      },
      ...extra,
    }
  state.assertEditorOwner = callback("assertEditorOwner", state)
  return { ...f, observed, live, state, save: callback("save", state) }
}
test("actual save fences account change after personal save before dispatching a native write", async () => {
  const personal = deferred(),
    f = saveFixture({
      personal: { value: {}, busy: false, save: () => personal.promise },
    }),
    pending = f.save(false)
  f.live.owner = false
  personal.resolve()
  await pending
  assert.equal(f.observed.native, 0)
  assert.equal(f.observed.committed, 0)
  assert.equal(f.observed.closed, 0)
})
test("actual keyboard save refuses an invalid visible interval draft before any personal or native write", async () => {
  const f = saveFixture({inputValidity:{isValid:()=>false}})
  await f.save(false)
  assert.equal(f.observed.personal,0)
  assert.equal(f.observed.native,0)
  assert.equal(f.observed.committed,0)
  assert.equal(f.observed.closed,0)
})
test("actual native response cannot commit or navigate a different account, while legacy background SaveClose still completes", async () => {
  const native = deferred(),
    changed = saveFixture({ writeWorkoutEditor: () => native.promise }),
    waiting = changed.save(false)
  await tick()
  changed.live.owner = false
  native.resolve({ workout: { id: "event:333" }, revision: "verified" })
  await waiting
  assert.equal(changed.observed.committed, 0)
  assert.equal(changed.observed.closed, 0)
  assert.equal(changed.observed.cleared, 0)
  const held = deferred(),
    background = saveFixture({
      model: {
        version: 1,
        sport: "Other",
        name: "Run",
        date: "2026-10-21",
        notes: "",
        steps: [{}],
      },
      writeWorkoutEditor: () => held.promise,
    }),
    pending = background.save(true)
  await tick()
  assert.equal(background.observed.closed, 1)
  assert.equal(background.live.mounted, false)
  held.resolve({ workout: { id: "event:444" }, revision: "verified" })
  await pending
  assert.equal(
    background.observed.committed,
    1,
    "Unmount does not revoke an already authorized background save"
  )
  assert.equal(
    background.observed.closed,
    1,
    "Late success must not navigate a newly opened view"
  )
  assert.equal(background.observed.saved, 0)
  assert.equal(background.observed.cleared, 1)
})

test("endurance SaveClose keeps recoverable fields open until durable acceptance, then closes once with pending sync", async () => {
  const accepted=deferred(),f=saveFixture({
    model:{version:1,sport:"Run",name:"Run",date:"2026-10-21",notes:"",steps:[{}]},
    writeWorkoutEditor:()=>accepted.promise,
  }),pending=f.save(true)
  await tick()
  assert.equal(f.observed.closed,0)
  assert.equal(f.observed.cleared,0)
  assert.equal(f.observed.committed,0)
  accepted.resolve({accepted:true,verified:false,revision:"local:1",workout:{id:"app:owned-workout"}})
  await pending
  assert.equal(f.observed.committed,0,"The durable path does not repeat an optimistic calendar projection after transaction acceptance")
  assert.equal(f.observed.closed,1)
  assert.equal(f.observed.saved,1)
  assert.equal(f.observed.cleared,1)
  assert.equal(f.observed.personal,0,"personal fields were included in the atomic save rather than separate provider requests")
})

test("durable acceptance clears only the accepted recurrence draft, while rejection preserves it",async()=>{
  const repeat={operationId:"repeat-operation",rule:{frequency:"weekly"}},accepted=deferred(),cleared=[],sent=[];
  const f=saveFixture({model:{version:1,sport:"Run",name:"Repeating run",date:"2026-10-21",notes:"",steps:[{}]},recurrence:repeat,setRecurrence:value=>cleared.push(value),writeWorkoutEditor:(_id,input)=>{sent.push(structuredClone(input));return accepted.promise}});
  const pending=f.save(false);await tick();
  assert.deepEqual(cleared,[]);
  assert.deepEqual(sent[0].recurrence,repeat);
  accepted.resolve({accepted:true,verified:false,revision:"local:1",workout:{id:"app:owned-workout"}});
  await pending;assert.deepEqual(cleared,[null]);
  const rejectedClears=[],rejected=saveFixture({model:{version:1,sport:"Run",name:"Repeating run",date:"2026-10-21",notes:"",steps:[{}]},recurrence:repeat,setRecurrence:value=>rejectedClears.push(value),writeWorkoutEditor:async()=>{throw Error("Storage blocked")}});
  await rejected.save(false);assert.deepEqual(rejectedClears,[]);
});

 test("parent cancellation after editor approval preserves recovery until a subsequent committed navigation",async()=>{
 const f=fixture(),approval=f.navigate();f.state.discardAndClose();assert.equal(await approval,true);assert.deepEqual(f.events,[["dialog",true]]);
 // A parent rejecting the operation never invokes this layer's commit.
 const retry=f.navigate();f.state.onDiscardOpenChange(false);assert.equal(await retry,false);assert.equal(f.events.some(event=>event[0]==="clear"),false);
 const approved=f.navigate();f.state.discardAndClose();assert.equal(await approved,true);f.state.commitEditorNavigation();assert.equal(f.events.filter(event=>event[0]==="clear").length,1);
})
 test("actual uncertain ordinary create rechecks the exact first model and wire fields despite mutated live controls",async()=>{
 const original={version:1,sport:"Run",name:"Original",date:"2026-10-21",notes:"Original prose",steps:[{}]},sent=[];
 const f=saveFixture({isNew:true,creationAttempted:true,creationId:"original-id",model:{...original,name:"Changed",date:"2026-10-25"},desktopTime:"12:00",desktopComment:"Changed comment",nativeDescription:"Changed prose",creationSnapshot:{current:{input:{model:original,revision:"new",creationId:"original-id",values:{tss:0},time:"07:00",comment:"First comment",descriptionMode:"manual",description:"Original prose"},personal:{},recurrence:null}},writeWorkoutEditor:async(id,input)=>{sent.push(structuredClone(input));return{workout:{id:"event:333"},revision:"verified"}}});
 await f.save(false);assert.equal(sent.length,1);assert.deepEqual(sent[0],{model:original,revision:"new",creationId:"original-id",values:{tss:0},time:"07:00",comment:"First comment",descriptionMode:"manual",description:"Original prose",reconcileOnly:true});
})

 test("editor attachment binding explicitly locks native and delegated uncertain creations, independently of fieldset inheritance",()=>{
 const node=find(node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==="WorkoutAttachments"),prop=node.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(file)==="disabled");assert.ok(prop?.initializer?.expression);
 const lock=find(node=>ts.isVariableDeclaration(node)&&node.name.getText(file)==="creationLocked").initializer;
 for(const extra of [{saving:true},{files:{busy:true}},{templateOpen:true},{creationAttempted:true},{externalCreationPending:true},{recovered:{creationAttempted:true}}]){const state={saving:false,files:{busy:false},templateOpen:false,isNew:true,creationAttempted:false,externalCreationPending:false,recovered:null,...extra};state.creationLocked=evaluate(lock,state);assert.equal(evaluate(prop.initializer.expression,state),true,JSON.stringify(extra))}
 const ready={saving:false,files:{busy:false},templateOpen:false,creationLocked:false};assert.equal(evaluate(prop.initializer.expression,ready),false);
})
