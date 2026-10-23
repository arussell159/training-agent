import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const compile = name => ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const cacheSource=compile("shared-request-cache"),readSource=compile("workout-read-cache")
function fixture() {
  let scope="account-a",revision="app:1",local,fail=false
  const requests=[]
  const context={Promise,Map,Set,Array,JSON,Number,Math,Date,Error,TypeError,DOMException,AbortController,decodeURIComponent,encodeURIComponent,setTimeout,clearTimeout}
  const cacheModule={exports:{}}
  runInNewContext(cacheSource,{...context,module:cacheModule,exports:cacheModule.exports})
  const module={exports:{}}
  runInNewContext(readSource,{...context,module,exports:module.exports,require:name=>{
    if(name==="./api-client")return {apiFetch:async(url)=>{requests.push({url,scope});return {ok:!fail,json:async()=>fail?{error:"Canonical store unavailable"}:{revision,model:{name:scope,steps:[]},scheduledTime:"",comments:[{id:"comment-1",body:`${scope} saved comment`,type:"pre",created_at:"2026-10-23T12:00:00Z"}]}}}}
    if(name==="./device-cache")return {deviceCacheScope:()=>scope}
    if(name==="./shared-request-cache")return cacheModule.exports
    if(name==="./training-context-validation")return {validatedTrainingWorkout:value=>value,validatedLibraryWorkout:value=>value}
    if(name==="./training-context")return {cachedTrainingContext:()=>({version:"fixture"})}
    if(name==="./workspace-reads")return {}
    if(name==="./workout-commits")return {restoreWorkoutCommits:async()=>{},localCommittedWorkout:()=>local,committedEditorRead:()=>local?.deleted?null:local}
    throw Error(`Unexpected import ${name}`)
  }})
  return {client:module.exports,requests,setScope:value=>{scope=value},setRevision:value=>{revision=value},setLocal:value=>{local=value},fail:()=>{fail=true}}
}

test("fresh-device editor reads use canonical revisions, share requests and expose the same cached result",async()=>{
  const env=fixture(),url="/api/workouts/event%3A201/editor"
  const [first,second]=await Promise.all([env.client.loadWorkoutEditor(url),env.client.loadWorkoutEditor(url)])
  assert.equal(first.revision,"app:1");assert.equal(first,second)
  assert.equal(env.requests.length,1)
  assert.equal(env.requests[0].url,"/api/workout-commits/event%3A201/editor")
  assert.equal(env.client.cachedWorkoutEditor(url),first)
  env.setRevision("app:2")
  assert.equal((await env.client.loadWorkoutEditor(url,undefined,true)).revision,"app:2")
  assert.equal(env.requests.length,2)
})

test("canonical reads preserve local accepted edits and isolate accounts",async()=>{
  const env=fixture(),url="/api/workouts/activity%3Ai201/editor"
  const local={revision:"local:2",model:{name:"Retained draft",steps:[]}}
  env.setLocal(local)
  assert.equal(await env.client.loadWorkoutEditor(url),local)
  assert.equal(env.requests.length,0)
  env.setLocal(undefined)
  const first=await env.client.loadWorkoutEditor(url)
  assert.equal(first.model.name,"account-a")
  env.setScope("account-b")
  assert.equal(env.client.cachedWorkoutEditor(url),undefined)
  assert.equal((await env.client.loadWorkoutEditor(url)).model.name,"account-b")
  assert.equal(env.requests[1].url,"/api/workout-commits/activity%3Ai201/editor")
})

test("new workouts retain their creation route and canonical failures never read a stale provider fallback",async()=>{
  const env=fixture(),url="/api/workouts/new/editor?date=2026-10-23&sport=Ride"
  await env.client.loadWorkoutEditor(url)
  assert.equal(env.requests[0].url,url)
  env.fail()
  await assert.rejects(env.client.loadWorkoutEditor("/api/workouts/event%3A201/editor"),/Canonical store unavailable/)
  assert.equal(env.requests.length,2)
  assert.equal(env.requests[1].url,"/api/workout-commits/event%3A201/editor")
})

test("durable deletion blocks cached, ordinary and forced editor reads before server handoff",async()=>{
  const env=fixture(),url="/api/workouts/event%3A201/editor"
  assert.equal((await env.client.loadWorkoutEditor(url)).revision,"app:1")
  env.setLocal({deleted:true,revision:"local:2"})
  assert.equal(env.client.cachedWorkoutEditor(url),undefined)
  const deleted=error=>error.status===404&&error.code==="DELETED"&&/deleted/.test(error.message)
  await assert.rejects(env.client.loadWorkoutEditor(url),deleted)
  await assert.rejects(env.client.loadWorkoutEditor(url,undefined,true),deleted)
  assert.equal(env.requests.length,1,"A pending deletion must not fall through to an older server/provider model")
})

test("fresh-device app-created workout comments use the canonical read and remain account scoped",async()=>{
  const env=fixture(),id="app:11111111-1111-4111-8111-111111111111"
  const [first,second]=await Promise.all([env.client.loadWorkoutComments(id),env.client.loadWorkoutComments(id)])
  assert.equal(first.comments[0].body,"account-a saved comment")
  assert.equal(first.comments[0].workout_id,id)
  assert.equal(first.comments[0].type,"pre")
  assert.equal(first.comments[0].created_at,"2026-10-23T12:00:00Z")
  assert.equal(second.comments[0].body,first.comments[0].body)
  assert.equal(env.requests.length,1)
  assert.equal(env.requests[0].url,`/api/workout-commits/${encodeURIComponent(id)}/editor`)
  env.setScope("account-b")
  assert.equal((await env.client.loadWorkoutComments(id)).comments[0].body,"account-b saved comment")
  assert.equal(env.requests.length,2)
})

test("app comment reads surface storage failures and respect pending deletion",async()=>{
  const id="app:11111111-1111-4111-8111-111111111111",env=fixture()
  env.fail()
  await assert.rejects(env.client.loadWorkoutComments(id),/Canonical store unavailable/)
  env.setLocal({deleted:true})
  await assert.rejects(env.client.loadWorkoutComments(id),error=>error.code==="DELETED")
  assert.equal(env.requests.length,1)
})
