import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import {
  readWorkoutLocalMetadata,
  moveWorkoutLocalMetadata,
  removeWorkoutLocalMetadata,
  saveWorkoutLocalMetadata,
  savedWorkoutEquipment,
  hasWorkoutPersonalFields,
  mergeWorkoutPersonalRead,
} from "../src/lib/workout-local-metadata.ts"

let records
beforeEach(() => {
  records = new Map()
  globalThis.localStorage = {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key),
    key: index => [...records.keys()][index] ?? null,
    get length() { return records.size },
  }
})
const fields = {
  privateNotes: "Keep the final rep controlled.",
  tags: ["race prep", "track"],
  equipment: "Daily trainers",
  autoCalculate: false,
}
test("bike-only and shoes-only drafts require durable personal-field migration", () => {
  const empty = {privateNotes:"",tags:[],equipment:"",autoCalculate:true}
  assert.equal(hasWorkoutPersonalFields(empty),false)
  assert.equal(hasWorkoutPersonalFields({...empty,bikeEquipment:"Race bike"}),true)
  assert.equal(hasWorkoutPersonalFields({...empty,shoeEquipment:"Running shoes"}),true)
  assert.equal(hasWorkoutPersonalFields({...empty,bikeEquipment:"",shoeEquipment:""}),false)
  assert.equal(hasWorkoutPersonalFields({...empty,autoCalculate:false}),true)
})
test("a delayed default response retains new equipment typed during the read and accepts unrelated remote updates", async () => {
  const before={privateNotes:"",tags:[],equipment:"",autoCalculate:true}
  let finishRead
  const pending=new Promise(resolve=>{finishRead=resolve})
  const edited={...before,bikeEquipment:"Time trial bike",shoeEquipment:"Race shoes"}
  finishRead({...before,privateNotes:"Remote note"})
  const merged=mergeWorkoutPersonalRead(edited,before,await pending)
  assert.equal(merged.bikeEquipment,"Time trial bike")
  assert.equal(merged.shoeEquipment,"Race shoes")
  assert.equal(merged.privateNotes,"Remote note")
  const cleared=mergeWorkoutPersonalRead({...merged,bikeEquipment:""},merged,{...merged,bikeEquipment:"Other device bike"})
  assert.equal(cleared.bikeEquipment,"")
  assert.equal(cleared.shoeEquipment,"Race shoes")
})
test("Brick bike and shoes remain independent through draft migration and account-specific suggestions",()=>{
  const brick={...fields,bikeEquipment:"Time trial bike",shoeEquipment:"Race shoes"}
  saveWorkoutLocalMetadata("athlete-a","draft:brick",brick)
  moveWorkoutLocalMetadata("athlete-a","draft:brick","event:88",brick)
  assert.deepEqual(readWorkoutLocalMetadata("athlete-a","event:88"),brick)
  saveWorkoutLocalMetadata("athlete-a","event:88",{...brick,bikeEquipment:""})
  assert.equal(readWorkoutLocalMetadata("athlete-a","event:88").shoeEquipment,"Race shoes")
  assert.equal(readWorkoutLocalMetadata("athlete-a","event:88").equipment,fields.equipment)
  assert.deepEqual(savedWorkoutEquipment("athlete-a"),["Daily trainers","Race shoes"])
  assert.deepEqual(savedWorkoutEquipment("athlete-b"),[])
})

test("personal fields reopen only for their athlete and workout", () => {
  saveWorkoutLocalMetadata("athlete-a", "event:12", fields)
  assert.deepEqual(readWorkoutLocalMetadata("athlete-a", "event:12"), fields)
  assert.equal(readWorkoutLocalMetadata("athlete-b", "event:12").privateNotes, "")
  assert.equal(readWorkoutLocalMetadata("athlete-a", "event:13").privateNotes, "")
  assert.equal(readWorkoutLocalMetadata("athlete-a", "event:12").autoCalculate, false)
})

test("created-workout metadata can move from a draft without exposing another athlete's equipment", () => {
  saveWorkoutLocalMetadata("athlete-a", "draft:abc", fields)
  saveWorkoutLocalMetadata("athlete-b", "event:9", { ...fields, equipment: "Other athlete's bike" })
  moveWorkoutLocalMetadata("athlete-a", "draft:abc", "event:14", readWorkoutLocalMetadata("athlete-a", "draft:abc"))
  assert.equal(readWorkoutLocalMetadata("athlete-a", "draft:abc").privateNotes, "")
  assert.deepEqual(readWorkoutLocalMetadata("athlete-a", "event:14"), fields)
  assert.deepEqual(savedWorkoutEquipment("athlete-a"), ["Daily trainers"])
  removeWorkoutLocalMetadata("athlete-a", "event:14")
  assert.equal(readWorkoutLocalMetadata("athlete-a", "event:14").privateNotes, "")
  assert.equal(readWorkoutLocalMetadata("athlete-b", "event:9").equipment, "Other athlete's bike")
})

test("blocked storage reports a failed personal save instead of silently claiming success", () => {
  localStorage.setItem = () => { throw new Error("Storage denied") }
  assert.throws(() => saveWorkoutLocalMetadata("a", "event:12", fields), /could not be saved on this device/)
})

test("draft migration at storage capacity replaces rather than duplicates its notes", () => {
  saveWorkoutLocalMetadata("a", "draft:long-creation-id", { ...fields, privateNotes: "a".repeat(2000) })
  const capacity = [...records.values()].reduce((total, value) => total + value.length, 0)
  localStorage.setItem = (key, value) => {
    const size = [...records].filter(([existing]) => existing !== key).reduce((total, [, value]) => total + value.length, value.length)
    if (size > capacity) throw new Error("QuotaExceededError")
    records.set(key, value)
  }
  moveWorkoutLocalMetadata("a", "draft:long-creation-id", "event:14", readWorkoutLocalMetadata("a", "draft:long-creation-id"))
  assert.equal(readWorkoutLocalMetadata("a", "event:14").privateNotes.length, 2000)
  assert.equal(readWorkoutLocalMetadata("a", "draft:long-creation-id").privateNotes, "")
})

test("failed atomic migration keeps the recoverable personal draft intact", () => {
  saveWorkoutLocalMetadata("a", "draft:abc", fields)
  localStorage.setItem = () => { throw new Error("Storage denied") }
  assert.throws(() => moveWorkoutLocalMetadata("a", "draft:abc", "event:14", fields), /original personal draft is retained/)
  assert.deepEqual(readWorkoutLocalMetadata("a", "draft:abc"), fields)
  assert.equal(readWorkoutLocalMetadata("a", "event:14").privateNotes, "")
})

test("corrupt local values do not prevent opening the workout", () => {
  saveWorkoutLocalMetadata("a", "event:12", fields)
  for (const key of records.keys()) records.set(key, "{")
  assert.deepEqual(readWorkoutLocalMetadata("a", "event:12"), {
    privateNotes: "", tags: [], equipment: "", autoCalculate: true,
  })
})
