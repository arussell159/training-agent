import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFoodKeyboardSubmit} from '../src/lib/nutrition-keyboard-submit.ts';

function setup(ios = true) {
  const window = Object.assign(new EventTarget(), {navigator:{userAgent:ios?'iPhone':'Windows',platform:ios?'iPhone':'Win32',maxTouchPoints:ios?5:0}});
  const document = Object.assign(new EventTarget(), {defaultView:window,visibilityState:'visible',body:{},documentElement:{},activeElement:null});
  const input = Object.assign(new EventTarget(), {ownerDocument:document});
  let saved = 0, valid = true;
  const cleanup = bindFoodKeyboardSubmit(input,{valid:()=>valid,submit:()=>saved++});
  const focus = () => {document.activeElement=input;input.dispatchEvent(new Event('focus'));};
  const blur = (relatedTarget=null) => {document.activeElement=relatedTarget||document.body;const event=new Event('blur');Object.defineProperty(event,'relatedTarget',{value:relatedTarget});input.dispatchEvent(event);};
  const enter = (isComposing=false) => {const event = new Event('keydown',{cancelable:true});Object.assign(event,{key:'Enter',isComposing});input.dispatchEvent(event);return event;};
  return {window,document,input,focus,blur,enter,cleanup,count:()=>saved,invalid:()=>{valid=false;}};
}
const tick = () => new Promise(resolve=>setTimeout(resolve,5));

test('native iPhone Done without Enter logs once; a following blur cannot double submit',async()=>{
  const ui=setup();ui.focus();ui.blur();await tick();assert.equal(ui.count(),1);ui.blur();await tick();assert.equal(ui.count(),1);ui.cleanup();
});
test('Enter submits once and suppresses the enclosing form submit',async()=>{
  const ui=setup();ui.focus();assert.equal(ui.enter().defaultPrevented,true);ui.blur();await tick();assert.equal(ui.count(),1);ui.cleanup();
});
test('invalid portions and IME composition never log a food',async()=>{
  const invalid=setup();invalid.invalid();invalid.focus();invalid.enter();invalid.blur();await tick();assert.equal(invalid.count(),0);invalid.cleanup();
  const ime=setup();ime.focus();assert.equal(ime.enter(true).defaultPrevented,false);assert.equal(ime.count(),0);ime.cleanup();
});
test('tapping elsewhere or moving to another field does not log a food',async()=>{
  const tap=setup();tap.focus();tap.document.dispatchEvent(new Event('pointerdown'));tap.blur();await tick();assert.equal(tap.count(),0);tap.cleanup();
  const next=setup();next.focus();next.blur({});await tick();assert.equal(next.count(),0);next.cleanup();
  const lateFocus=setup();lateFocus.focus();lateFocus.blur();lateFocus.document.activeElement={};lateFocus.document.dispatchEvent(new Event('focusin'));await tick();assert.equal(lateFocus.count(),0);lateFocus.cleanup();
});
test('closing the app, switching windows and unmounting do not log a food',async()=>{
  for(const action of ['hidden','blur','pagehide','unmount']){
    const ui=setup();ui.focus();ui.blur();
    if(action==='hidden'){ui.document.visibilityState='hidden';ui.document.dispatchEvent(new Event('visibilitychange'));}
    else if(action==='unmount')ui.cleanup();else ui.window.dispatchEvent(new Event(action));
    await tick();assert.equal(ui.count(),0,action);ui.cleanup();
  }
});
test('desktop blur stays in the editor and Done can submit an unchanged valid portion',async()=>{
  const desktop=setup(false);desktop.focus();desktop.blur();await tick();assert.equal(desktop.count(),0);desktop.cleanup();
  const ios=setup();ios.focus();ios.blur();await tick();assert.equal(ios.count(),1);ios.cleanup();
});
