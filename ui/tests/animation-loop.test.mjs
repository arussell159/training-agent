import assert from "node:assert/strict"
import { test } from "node:test"
import { startAnimationLoop } from "../src/lib/animation-loop.ts"

function clock() {
  let id=0
  const queued=new Map()
  return {
    schedule(callback) {queued.set(++id,callback);return id},
    cancel(frame) {queued.delete(frame)},
    take() {const [frame,callback]=queued.entries().next().value;queued.delete(frame);return callback},
    get pending() {return queued.size},
  }
}

test("animation cleanup during its own state update cannot leave a queued pan",()=>{
  const frames=clock()
  let calls=0
  const stop=startAnimationLoop(()=>{calls++;stop()},frames.schedule,frames.cancel)
  frames.take()(0)
  assert.equal(calls,1)
  assert.equal(frames.pending,0)
})

test("a browser callback already dequeued before cancellation cannot scroll or restart",()=>{
  const frames=clock()
  let pixels=0
  const stop=startAnimationLoop(()=>{pixels+=12},frames.schedule,frames.cancel)
  const dequeued=frames.take()
  stop()
  dequeued(0)
  assert.equal(pixels,0)
  assert.equal(frames.pending,0)
})

test("a running pan owns one frame and repeated cancellation releases it",()=>{
  const frames=clock()
  let pixels=0
  const stop=startAnimationLoop(()=>{pixels+=12},frames.schedule,frames.cancel)
  for(let count=0;count<5;count++) {frames.take()(count);assert.equal(frames.pending,1)}
  assert.equal(pixels,60)
  stop();stop()
  assert.equal(frames.pending,0)
})
