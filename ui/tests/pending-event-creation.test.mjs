import assert from "node:assert/strict"
import {test} from "node:test"
import {readPendingEventCreation,rememberPendingEventCreation,clearPendingEventCreation} from "../src/lib/pending-event-creation.ts"
const entry={name:"City event",date:"2026-10-24",priority:"",eventType:"RunningRoad",description:"Meet at the gate"}
const pending={creationId:"pending-event-original-identity",submitted:entry,draft:entry,customGoal:"Finish comfortably",goalsOpen:true}
function storage() {const records=new Map();return {records,getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)}}

test("pending Event identity and complete draft survive a fresh reader only in their account",()=>{
  const disk=storage();rememberPendingEventCreation(disk,"account-a",pending)
  const loaded=readPendingEventCreation(disk,"account-a")
  assert.deepEqual(loaded,pending)
  assert.equal(readPendingEventCreation(disk,"account-b"),null)
  loaded.draft.name="Changed in reader"
  assert.equal(readPendingEventCreation(disk,"account-a").draft.name,entry.name)
  assert.throws(()=>rememberPendingEventCreation(disk,"initial",pending),/account calendar/)
})
test("an unresolved Event prevents replacing its identity or submitted request but permits incomplete retained edits",()=>{
  const disk=storage();rememberPendingEventCreation(disk,"a",pending)
  assert.throws(()=>rememberPendingEventCreation(disk,"a",{...pending,creationId:"other-event-request-identity"}),/still needs confirmation/)
  assert.throws(()=>rememberPendingEventCreation(disk,"a",{...pending,submitted:{...entry,name:"Different request"}}),/still needs confirmation/)
  rememberPendingEventCreation(disk,"a",{...pending,draft:{...entry,name:"",description:"Retained new prose"},replayEventId:"event:42"})
  const read=readPendingEventCreation(disk,"a")
  assert.equal(read.submitted.name,entry.name)
  assert.equal(read.draft.name,"")
  assert.equal(read.draft.description,"Retained new prose")
  assert.equal(read.replayEventId,"event:42")
})
test("only the matching confirmed identity clears a pending Event",()=>{
  const disk=storage();rememberPendingEventCreation(disk,"a",pending)
  assert.equal(clearPendingEventCreation(disk,"a","other-identity"),false)
  assert.deepEqual(readPendingEventCreation(disk,"a"),pending)
  assert.equal(clearPendingEventCreation(disk,"a",pending.creationId),true)
  assert.equal(readPendingEventCreation(disk,"a"),null)
})
test("corrupt or unreadable recovery state fails closed instead of permitting another creation",()=>{
  const disk=storage();rememberPendingEventCreation(disk,"a",pending)
  const name=[...disk.records.keys()][0]
  for(const raw of ["{broken",JSON.stringify({version:2,input:pending}),JSON.stringify({version:1,input:{...pending,replayEventId:"https://example.com"}}),JSON.stringify({version:1,input:{...pending,draft:{...entry,goals:{custom:"invalid"}}}})]) {
    disk.records.set(name,raw)
    assert.throws(()=>readPendingEventCreation(disk,"a"),/could not be verified/)
    assert.throws(()=>rememberPendingEventCreation(disk,"a",pending),/could not be verified/)
  }
  assert.throws(()=>readPendingEventCreation({getItem(){throw Error("Storage denied")}},"a"),/could not be read/)
})
test("failed retention throws before a caller can start its native create request",()=>{
  let nativeRequests=0
  const disk={getItem:()=>null,setItem(){throw Error("Quota")}}
  assert.throws(()=>{rememberPendingEventCreation(disk,"a",pending);nativeRequests++},/No new Event request was sent/)
  assert.equal(nativeRequests,0)
})
test("a valid but excessively escaped recovery payload is rejected before it can become unreadable on reopen",()=>{
  const disk=storage(),large={...entry,description:"\u0000".repeat(12000)}
  assert.throws(()=>rememberPendingEventCreation(disk,"a",{...pending,submitted:large,draft:large}),/too large to retain/)
  assert.equal(disk.records.size,0)
})
