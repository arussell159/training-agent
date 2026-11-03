import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMobileSheetGesture} from '../src/lib/mobile-sheet-gesture.ts';

function setup() {
  let time=0, closed=0, expanded=0;
  const window=Object.assign(new EventTarget(),{performance:{now:()=>time},innerHeight:844,visualViewport:{height:500},getComputedStyle:()=>({maxHeight:'460px'})});
  const document=Object.assign(new EventTarget(),{defaultView:window,visibilityState:'visible',documentElement:{dataset:{mobileKeyboardOpen:'false'}}});
  const style={removeProperty(key){delete this[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]}};
  const root=Object.assign(new EventTarget(),{ownerDocument:document});
  const sheet={style,getBoundingClientRect:()=>({height:300})},scroll={scrollTop:0};
  const target=(kind='handle')=>({
    closest(selector){
      if(selector==='.sheet-modal')return sheet;
      if(selector==='[data-sheet-scroll]')return ['reader','input','chart'].includes(kind)?scroll:null;
      if(selector==='.detail-sheet-handle, .terms-metric-sheet-heading')return kind==='handle'?this:null;
      return ['input','chart'].includes(kind)?this:null;
    },setPointerCapture(){}
  });
  const handle=target(), reader=target('reader');
  const fire=(type,properties={},node=handle)=>{
    const event=new Event(type,{cancelable:true});
    Object.assign(event,{isPrimary:true,button:0,pointerType:'touch',pointerId:1,clientX:100,clientY:100,...properties});
    Object.defineProperty(event,'target',{value:node});root.dispatchEvent(event);return event;
  };
  const touch=(type,y=100,extra={},node=reader)=>{
    const point={identifier:7,clientX:100,clientY:y};
    return fire(type,{touches:type==='touchend'?[]:[point],changedTouches:[point],...extra},node);
  };
  const cleanup=bindMobileSheetGesture(root,()=>closed++,{onExpand:()=>expanded++});
  return {root,document,window,sheet,scroll,target,fire,touch,cleanup,clock:n=>{time=n},closed:()=>closed,expanded:()=>expanded};
}

test('mobile sheet follows downward drag, dismisses once and clears inline styles',()=>{
  const ui=setup();ui.fire('pointerdown');const move=ui.fire('pointermove',{clientY:200});
  assert.equal(move.defaultPrevented,true);assert.equal(ui.sheet.style.transform,'translate3d(0, 100px, 0)');
  ui.clock(400);ui.fire('pointerup');ui.fire('pointerup');assert.equal(ui.closed(),1);assert.equal(ui.sheet.style.transform,undefined);ui.cleanup();
});
test('cancel, lost capture, background and a second finger never dismiss or leave a shifted sheet',()=>{
  for(const reason of ['pointercancel','lostpointercapture','hidden','blur','pagehide','second-finger']){
    const ui=setup();ui.fire('pointerdown');ui.fire('pointermove',{clientY:200});
    if(reason==='hidden'){ui.document.visibilityState='hidden';ui.document.dispatchEvent(new Event('visibilitychange'));}
    else if(reason==='blur'||reason==='pagehide')ui.window.dispatchEvent(new Event(reason));
    else if(reason==='second-finger')ui.touch('touchstart',100,{touches:[{identifier:7},{identifier:8}]});
    else ui.fire(reason);
    ui.fire('pointerup');assert.equal(ui.closed(),0,reason);assert.equal(ui.sheet.style.transform,undefined,reason);ui.cleanup();
  }
});
test('form controls, charts, native back edge and open keyboard keep their gestures',()=>{
  for(const kind of ['input','chart','edge','keyboard']){
    const ui=setup(),node=ui.target(kind==='edge'||kind==='keyboard'?'handle':kind);
    if(kind==='keyboard')ui.document.documentElement.dataset.mobileKeyboardOpen='true';
    ui.fire('pointerdown',{clientX:kind==='edge'?15:100},node);
    const move=ui.fire('pointermove',{clientY:220},node);ui.fire('pointerup',{},node);
    assert.equal(move.defaultPrevented,false,kind);assert.equal(ui.closed(),0,kind);ui.cleanup();
  }
});
test('native reading, sideways movement and scrolled readers do not dismiss',()=>{
  for(const kind of ['up','horizontal','scrolled','scroll-changed']){
    const ui=setup();if(kind==='scrolled')ui.scroll.scrollTop=40;
    ui.touch('touchstart');if(kind==='scroll-changed')ui.scroll.scrollTop=5;
    const move=ui.touch('touchmove',kind==='up'?50:200,kind==='horizontal'?{touches:[{identifier:7,clientX:260,clientY:120}]}:{});
    ui.touch('touchend',200);assert.equal(move.defaultPrevented,false,kind);assert.equal(ui.closed(),0,kind);ui.cleanup();
  }
});
test('reader top can swipe down; cancellation and multitouch restore it',()=>{
  for(const finish of ['touchend','touchcancel','multitouch']){
    const ui=setup();ui.touch('touchstart');const move=ui.touch('touchmove',200);
    assert.equal(move.defaultPrevented,true);assert.ok(ui.sheet.style.transform);
    if(finish==='multitouch')ui.touch('touchmove',220,{touches:[{identifier:7},{identifier:8}]});else ui.touch(finish,200);
    assert.equal(ui.closed(),finish==='touchend'?1:0);assert.equal(ui.sheet.style.transform,undefined);ui.cleanup();
  }
});
test('short slow drags snap back, quick intentional swipes dismiss',()=>{
  for(const [elapsed,expected] of [[800,0],[50,1]]){
    const ui=setup();ui.fire('pointerdown');ui.fire('pointermove',{clientY:135});ui.clock(elapsed);ui.fire('pointerup');assert.equal(ui.closed(),expected);ui.cleanup();
  }
});
test('upward expansion respects CSS safe-area height and releases its drag styles',()=>{
  const ui=setup();ui.fire('pointerdown');ui.fire('pointermove',{clientY:-300});assert.equal(ui.sheet.style.height,'460px');
  ui.fire('pointerup');assert.equal(ui.expanded(),1);assert.equal(ui.closed(),0);assert.equal(ui.sheet.style.height,undefined);ui.cleanup();
});
test('cleanup cancels a drag and detaches all action handlers',()=>{
  const ui=setup();ui.fire('pointerdown');ui.fire('pointermove',{clientY:220});ui.cleanup();assert.equal(ui.sheet.style.transform,undefined);
  ui.fire('pointerup');ui.fire('pointerdown');ui.fire('pointermove',{clientY:220});ui.fire('pointerup');assert.equal(ui.closed(),0);
});
