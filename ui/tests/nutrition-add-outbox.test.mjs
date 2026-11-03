import test from 'node:test';
import assert from 'node:assert/strict';
import {createNutritionAddOutbox} from '../src/lib/nutrition-add-outbox.ts';
import {pendingNutritionWrite} from '../src/lib/pending-nutrition-write.ts';
function memory(){const values=new Map();return{get length(){return values.size},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
const food=id=>({id,name:id,meal:'lunch',quantity:1,unit:'bowl',calories:100,protein:5,carbs:20,fat:1,fiber:null,source:'manual',notes:'',barcode:null,imageUrl:null});
const project=(view,entries)=>({...view,day:{...view.day,entries:[...new Map([...view.day.entries,...entries].map(entry=>[entry.id,entry])).values()]}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
 const storage=overrides.storage||memory(),scope=overrides.scope||'account-'+Math.random(),calls=[],painted=[],states=[],receipts=new Map();let current=true,revision=0,entries=[];
 const view=()=>({date:'2026-10-26',day:{revision,entries:structuredClone(entries)},week:[]});
 const send=async input=>{calls.push(structuredClone(input));if(receipts.has(input.operationId))return receipts.get(input.operationId);if(input.revision!==revision)throw Object.assign(Error('Changed in another view'),{status:409});entries=[...entries,...input.entries];revision++;const result={day:null,committed:true,revision,changedEntries:input.entries};receipts.set(input.operationId,result);return result};
 const options={storage,scope,current:()=>current,readView:async()=>view(),resolveEntries:async entries=>entries,send,project,publish:(view,pending)=>painted.push({view:structuredClone(view),pending}),changed:state=>states.push(state)};
 const make=extra=>createNutritionAddOutbox({...options,...extra});
 return{storage,scope,calls,painted,states,view,send,make,setCurrent:value=>current=value,external:entry=>{entries.push(entry);revision++}};
}
test('rapid additions paint immediately and deliver in order with confirmed revisions',async()=>{
 const f=fixture(),gate=deferred();let first=true;const queue=f.make({send:async input=>{if(first){first=false;await gate.promise}return f.send(input)}});
 queue.enqueue(f.view(),[food('food-one')],'operation-one');assert.equal(f.painted.at(-1).view.day.entries.length,1);assert.equal(f.calls.length,0);
 const draining=queue.drain();await tick();queue.enqueue(f.painted.at(-1).view,[food('food-two')],'operation-two');queue.enqueue(f.painted.at(-1).view,[food('food-three')],'operation-three');
 assert.equal(f.painted.at(-1).view.day.entries.length,3);assert.equal(queue.rows().length,3);gate.resolve();await draining;
 assert.deepEqual(f.calls.map(input=>input.revision),[0,1,2]);assert.equal(f.view().day.entries.length,3);assert.equal(queue.rows().length,0);assert.equal(pendingNutritionWrite(f.storage,f.scope),null);assert.equal(f.painted.at(-1).pending,false);
});
test('a lost response survives a new delivery owner and replays the same immutable ID once',async()=>{
 const f=fixture();let lost=true;const send=async input=>{const result=await f.send(input);if(lost){lost=false;throw Error('Connection lost after commit')}return result};
 const original=f.make({send});original.enqueue(f.view(),[food('food-one')],'operation-one');await assert.rejects(original.drain(),/Connection lost/);
 assert.equal(f.view().day.entries.length,1);assert.equal(original.rows()[0].prepared.revision,0);
 const recovered=f.make({send});await recovered.drain();assert.equal(f.view().day.entries.length,1);assert.deepEqual(f.calls.map(row=>[row.operationId,row.revision]),[['operation-one',0],['operation-one',0]]);assert.equal(recovered.rows().length,0);
});
test('a conflict refreshes canonical state before rebasing a rejected intent',async()=>{
 const f=fixture(),stale=f.view(),queue=f.make();f.external(food('external-food'));queue.enqueue(stale,[food('food-one')],'operation-one');await queue.drain();
 assert.deepEqual(f.calls.map(input=>input.revision),[0,1]);assert.deepEqual(f.view().day.entries.map(entry=>entry.id),['external-food','food-one']);assert.equal(queue.rows().length,0);
});
test('a rejected food does not remain in totals or block other valid additions',async()=>{
 const f=fixture();let reject=true;const queue=f.make({send:async input=>{if(reject&&input.entries[0].id==='bad-food')throw Object.assign(Error('Serving unavailable'),{status:422});return f.send(input)}});
 queue.enqueue(f.view(),[food('bad-food')],'operation-bad');queue.enqueue(f.painted.at(-1).view,[food('good-food')],'operation-good');await queue.drain();
 assert.deepEqual(f.view().day.entries.map(entry=>entry.id),['good-food']);assert.equal(queue.rows()[0].failed,'Serving unavailable');assert.deepEqual(f.painted.at(-1).view.day.entries.map(entry=>entry.id),['good-food']);
 reject=false;await queue.retry();assert.equal(queue.rows().length,0);assert.equal(f.view().day.entries.length,2);
});
test('account changes stop publication and leave the original intent recoverable',async()=>{
 const f=fixture(),gate=deferred(),queue=f.make({send:async input=>{await gate.promise;return f.send(input)}});queue.enqueue(f.view(),[food('food-one')],'operation-one');const draining=queue.drain();await tick();const painted=f.painted.length;f.setCurrent(false);gate.resolve();await draining;
 assert.equal(f.painted.length,painted);assert.equal(queue.rows().length,1);f.setCurrent(true);await f.make().drain();assert.equal(f.view().day.entries.length,1);
});
test('storage failures cannot look like successful additions or send a request',()=>{
 const storage=memory();storage.setItem=()=>{throw Error('quota')};const f=fixture({storage}),queue=f.make();assert.throws(()=>queue.enqueue(f.view(),[food('food-one')],'operation-one'),/nothing was sent/);assert.equal(f.painted.length,0);assert.equal(f.calls.length,0);
});
test('a fresh screen can retain an addition before its first diary read finishes',async()=>{
 const f=fixture(),gate=deferred(),queue=f.make({readView:async()=>{await gate.promise;return f.view()}});queue.enqueue('2026-10-26',[food('food-one')],'operation-one');const draining=queue.drain();await tick();assert.equal(queue.rows().length,1);assert.equal(f.calls.length,0);gate.resolve();await draining;assert.equal(f.view().day.entries.length,1);
});

test('the success callback waits for verification and is never fired for a rejected delivery',async()=>{
 const f=fixture(),gate=deferred(),confirmed=[]
 const queue=f.make({send:async input=>{await gate.promise;return f.send(input)},confirmed:(input,result)=>confirmed.push({id:input.operationId,revision:result.revision})})
 queue.enqueue(f.view(),[food('one')],'operation-one');const draining=queue.drain();await tick()
 assert.deepEqual(confirmed,[]);gate.resolve();await draining
 assert.deepEqual(confirmed,[{id:'operation-one',revision:1}])
 const rejected=f.make({send:async()=>{throw Error('Connection lost')},confirmed:()=>confirmed.push('wrong')})
 rejected.enqueue(f.view(),[food('two')],'operation-two');await assert.rejects(rejected.drain(),/Connection lost/)
 assert.equal(confirmed.length,1);assert.equal(rejected.rows().length,1)
})
