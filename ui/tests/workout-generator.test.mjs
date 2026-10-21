import test from "node:test"
import assert from "node:assert/strict"
import { createWorkoutGeneratorClient, generatorProblem } from "../src/lib/workout-generator.ts"
import { newStep } from "../../app-backend/lib/workout-editor-model.mjs"
import {readFileSync} from "node:fs"
import {runInNewContext} from "node:vm"
import ts from "typescript"

const input = () => ({ date:"2026-10-24",sport:"Run",intensity:"percentOfFtp",length:"duration",target:"range",prompt:"  Warm up for ten minutes, then run easy.  " })
const result = (request=input()) => {
  const step=newStep(request.sport),[kind,unit]={percentOfFtp:["power","%ftp"],percentOfMaxHr:["hr","%hr"],percentOfThresholdHr:["hr","%lthr"],percentOfThresholdPace:["pace","%pace"],RPE:["rpe","rpe"]}[request.intensity]
  step.end=request.length==="distance"?{kind:"distance",unit:"m",value:1000}:{kind:"time",unit:"s",value:600}
  step.target={kind,unit,...(request.target==="range"?{mode:"range",start:kind==="rpe"?3:40,end:kind==="rpe"?6:60}:{mode:"single",value:kind==="rpe"?5:50})}
  return {generated:true,saved:false,warnings:[],model:{version:1,name:"Easy run",sport:request.sport,date:request.date,notes:"Easy conversational running.",poolLength:"",steps:[step],...(request.variant?{variant:request.variant}:{})}}
}
const reply = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}})

test("generator validates date, required prompt, thousand-character bound and explicit native variants before any request",async()=>{
  let requests=0;const client=createWorkoutGeneratorClient(async()=>{requests++;return reply(result())})
  for(const change of [{prompt:" "},{prompt:"x".repeat(1001)},{date:"2026-02-30"},{sport:"Brick"},{variant:"brick"},{length:"laps"},{intensity:"watts"}]){
    assert.ok(generatorProblem({...input(),...change}));
    assert.throws(()=>client.generate({...input(),...change}));
  }
  assert.equal(requests,0)
  assert.equal(generatorProblem({...input(),sport:"Other",variant:"brick"}),"")
})

test("generator sends one readonly generation request and accepts only a valid unsaved structured draft",async()=>{
  const calls=[];const client=createWorkoutGeneratorClient(async(path,options)=>{calls.push({path,options});return reply(result())})
  const generated=await client.generate(input())
  assert.equal(calls.length,1);assert.equal(calls[0].path,"/api/workouts/generate");assert.equal(calls[0].options.method,"POST")
  assert.deepEqual(JSON.parse(calls[0].options.body),{...input(),prompt:input().prompt.trim()})
  assert.equal(generated.saved,false);assert.equal(generated.generated,true);assert.equal(generated.model.steps.length,1)
  assert.equal(Object.hasOwn(generated,"workoutId"),false)
})

test("a matching date cannot hide a wrong sport, lost variant or saved/provider identity in a generated response",async()=>{
  const expected={...input(),sport:"Other",variant:"custom"};const valid=result(expected)
  for(const candidate of [
    {...valid,saved:true}, {...valid,workoutId:"event:123"}, {...valid,context:{}},
    {...valid,model:{...valid.model,sport:"Ride"}}, {...valid,model:{...valid.model,variant:undefined}},
    {...valid,model:{...valid.model,date:"2026-10-25"}}, {...valid,model:{...valid.model,steps:[],unstructured:true}},
    {...valid,warnings:[{text:"wrong shape"}]},
  ]){
    const client=createWorkoutGeneratorClient(async()=>reply(candidate))
    await assert.rejects(client.generate(expected),/incomplete or did not match/)
  }
})

test("numeric RPE targets and their warnings remain intact without a physiological conversion",async()=>{
  const request={...input(),intensity:"RPE"};const generated=result(request)
  generated.model.steps[0].target={kind:"rpe",unit:"rpe",mode:"range",start:3,end:6}
  generated.warnings=["RPE remains an effort target; device support varies."]
  const loaded=await createWorkoutGeneratorClient(async()=>reply(generated)).generate(request)
  assert.deepEqual(loaded.model.steps[0].target,{kind:"rpe",unit:"rpe",mode:"range",start:3,end:6})
  assert.deepEqual(loaded.warnings,generated.warnings)
})
test("valid200 models with contradictory intensity, length, shape or non-rest missing targets cannot open as matching drafts",async()=>{
  const request=input()
  for(const patch of [
    {target:{kind:"hr",unit:"%lthr",mode:"range",start:40,end:60}},
    {target:{kind:"power",unit:"%ftp",mode:"single",value:50}},
    {target:{kind:"none"}},
    {end:{kind:"distance",unit:"m",value:1000}},
  ]){
    const candidate=result(request);Object.assign(candidate.model.steps[0],patch)
    await assert.rejects(createWorkoutGeneratorClient(async()=>reply(candidate)).generate(request),/incomplete or did not match/)
  }
})

test("provider/model errors retain an actionable error and never trigger retries or a calendar write",async()=>{
  for(const status of [422,429,503]){
    let count=0;const client=createWorkoutGeneratorClient(async()=>{count++;return reply({error:"Synthetic generator unavailable; prompt retained."},status)})
    await assert.rejects(client.generate(input()),/Synthetic generator unavailable/)
    assert.equal(count,1)
  }
  await assert.rejects(createWorkoutGeneratorClient(async()=>new Response("not JSON")) .generate(input()),/could not be read/)
})

test("canceling a held generation aborts its only request and never returns a late draft",async()=>{
  let release,started;const held=new Promise(resolve=>{release=resolve});const entered=new Promise(resolve=>{started=resolve});let count=0,signal
  const client=createWorkoutGeneratorClient(async(_path,options)=>{count++;signal=options.signal;started();await held;return reply(result())})
  const controller=new AbortController();const pending=client.generate(input(),controller.signal)
  await entered;controller.abort(new DOMException("Closed generator","AbortError"));release()
  await assert.rejects(pending,/Closed generator/);assert.equal(signal.aborted,true);assert.equal(count,1)
})

test("deadline includes a hanging response body and an already-aborted request never reaches transport",async()=>{
  let count=0;const client=createWorkoutGeneratorClient(async()=>{count++;return {ok:true,json:()=>new Promise(()=>{})}},10)
  await assert.rejects(client.generate(input()),/generation took too long/);assert.equal(count,1)
  const controller=new AbortController();controller.abort()
  await assert.rejects(client.generate(input(),controller.signal),{name:"AbortError"});assert.equal(count,1)
})
test("the actual editor close callback confirms a generated unsaved baseline while leaving pristine blank and existing builders closable",()=>{
  const source=ts.createSourceFile("workout-editor.tsx",readFileSync(new URL("../src/components/workout-editor.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let callback
  const find=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==="EditorWorkspace"){
    const walk=child=>{if(ts.isVariableDeclaration(child)&&child.name.getText(source)==="requestClose")callback=child.initializer;ts.forEachChild(child,walk)};walk(node)
  }else ts.forEachChild(node,find)};find(source);assert.ok(callback)
  const executable=ts.transpileModule(`const close=${callback.getText(source)};close()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const check=(overrides={})=>{
    const observed={confirmation:0,closed:0,discarded:0}
    runInNewContext(executable,{saving:false,saveInFlight:{current:false},deleteInFlight:{current:false},personal:{busy:false},files:{busy:false},templateOpen:false,discardIntent:{current:null},editorAccount:{isCurrent:()=>true,ownsAccount:()=>true},creationAttempted:false,externalCreationPending:false,pendingStrength:null,bypassWorkoutNavigationGuard:action=>action(),dirty:false,isNew:true,model:{steps:[{id:"generated-step"}]},recovered:false,status:"draft",mobile:false,setDiscardOpen:()=>{observed.confirmation++},onClose:()=>{observed.closed++},discardAndClose:()=>{observed.discarded++},...overrides})
    return observed
  }
  assert.deepEqual(check(),{confirmation:1,closed:0,discarded:0})
  assert.deepEqual(check({model:{steps:[]}}),{confirmation:0,closed:0,discarded:1})
  assert.deepEqual(check({isNew:false}),{confirmation:0,closed:0,discarded:1})
  assert.deepEqual(check({saving:true}),{confirmation:0,closed:0,discarded:0})
  assert.deepEqual(check({dirty:true,isNew:false}),{confirmation:1,closed:0,discarded:0})
})
