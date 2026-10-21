import assert from "node:assert/strict"
import { test } from "node:test"
import { setApiAuthenticated } from "../src/lib/api-client.ts"
import { saveRaceEvent } from "../src/lib/race-event-details.ts"

const entry={name:"City event",date:"2026-10-24",priority:"",eventType:"RunningRoad",description:"Meet at the gate"}

test("Event retries preserve submitted identity and expose a validated replay recovery ID",async t=>{
  setApiAuthenticated(true,true)
  const bodies=[]
  t.mock.method(globalThis,"fetch",async(_url,options)=>{
    bodies.push(JSON.parse(options.body))
    return new Response(JSON.stringify(bodies.length===1 ? {error:"Invalid draft"} :
      {error:"Reload current Event",code:"EVENT_REPLAY_CHANGED",eventId:"event:42"}),{status:bodies.length===1?400:409})
  })
  const identity=Object.freeze({creationId:"immutable-event-request"})
  await assert.rejects(saveRaceEvent(entry,identity),{status:400})
  await assert.rejects(saveRaceEvent(entry,identity),{status:409,code:"EVENT_REPLAY_CHANGED",eventId:"event:42"})
  assert.deepEqual(bodies.map(body=>body.creationId),[identity.creationId,identity.creationId])
})

test("untrusted replay IDs never become a recovery navigation target",async t=>{
  setApiAuthenticated(true,true)
  let candidate
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:"Conflict",code:"EVENT_REPLAY_CHANGED",eventId:candidate}),{status:409}))
  for(candidate of ["https://example.com","event:0","event:-1","event:4/path","event:4?x=1",42,null])
    await assert.rejects(saveRaceEvent(entry,{creationId:"unchanged"}),error=>error.status===409 && error.eventId===undefined)
})

test("only a replay-changed409 can expose an existing Event identity",async t=>{
  setApiAuthenticated(true,true)
  let status=409,code="OTHER_CONFLICT"
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:"Conflict",code,eventId:"event:42"}),{status}))
  await assert.rejects(saveRaceEvent(entry,{creationId:"unchanged"}),error=>error.eventId===undefined)
  status=503;code="EVENT_REPLAY_CHANGED"
  await assert.rejects(saveRaceEvent(entry,{creationId:"unchanged"}),error=>error.eventId===undefined)
})
