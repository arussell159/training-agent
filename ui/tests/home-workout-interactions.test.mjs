import test from 'node:test'
import assert from 'node:assert/strict'
import {createDaySwipeGesture} from '../src/lib/home-workout-interactions.ts'

test('a day swipe suppresses its own synthesized click exactly once',()=>{
  const gesture=createDaySwipeGesture()
  gesture.begin({id:1,x:150,y:40})
  assert.equal(gesture.end({id:1,x:60,y:45}),1)
  assert.equal(gesture.consumeClick(),true)
  assert.equal(gesture.consumeClick(),false)
})
test('a fresh intentional tap opens immediately after a swipe even when no synthesized click arrived',()=>{
  const gesture=createDaySwipeGesture()
  gesture.begin({id:1,x:50,y:40});assert.equal(gesture.end({id:1,x:150,y:45}),-1)
  gesture.begin({id:2,x:80,y:40});assert.equal(gesture.end({id:2,x:81,y:42}),0)
  assert.equal(gesture.consumeClick(),false)
})
test('vertical scrolling, canceled gestures, and unrelated pointers cannot turn into day changes',()=>{
  const gesture=createDaySwipeGesture()
  gesture.begin({id:1,x:50,y:40});assert.equal(gesture.end({id:1,x:120,y:140}),0)
  assert.equal(gesture.consumeClick(),false)
  gesture.begin({id:2,x:50,y:40});gesture.cancel();assert.equal(gesture.end({id:2,x:150,y:40}),0)
  gesture.begin({id:3,x:50,y:40});assert.equal(gesture.end({id:4,x:150,y:40}),0)
  assert.equal(gesture.consumeClick(),false)
})
