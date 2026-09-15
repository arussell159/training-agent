import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIntervalsClient,fetchIntervalsContext,moveIntervalsEvent,changeIntervalsEvent,applyIntervalsPatch,validDate} from './intervals.mjs';
import {createIntervalsCoachAdapter} from './triathlon-coach-adapter.mjs';

test('personal key stays in Authorization and response secrets are removed',async()=>{
  const request=createIntervalsClient({INTERVALS_API_KEY:'fixture-key'},async(url,options)=>{
    assert.equal(url,'https://intervals.icu/api/v1/athlete/0');
    assert.equal(options.headers.Authorization,`Basic ${Buffer.from('API_KEY:fixture-key').toString('base64')}`);
    return {ok:true,text:async()=>JSON.stringify({id:'i1',api_key:'private',nested:{access_token:'private',ftp:250}})};
  });
  assert.deepEqual(await request('/athlete/0'),{id:'i1',nested:{ftp:250}});
  const failed=createIntervalsClient({INTERVALS_API_KEY:'fixture-key'},async()=>({ok:false,status:401}));
  await assert.rejects(failed('/athlete/0'),error=>error.status===401 && !error.message.includes('fixture-key'));
});

test('context maps seconds and m/s, deduplicates paired activities and uses athlete timezone',async()=>{
  const data={
    '/athlete/0':{id:'i1',name:'Test athlete',timezone:'America/Chicago',sportSettings:[{types:['Ride'],ftp:250},{types:['Run'],threshold_pace:3.42,lthr:170},{types:['Swim'],threshold_pace:1}]},
    activities:[{id:'a1',type:'Ride',name:'Completed',start_date_local:'2026-09-14T08:00:00',moving_time:3600,icu_training_load:50},{id:'a2',type:'Run',start_date_local:'2026-09-15T08:00:00',moving_time:1800}],
    events:[{id:1,type:'Ride',category:'WORKOUT',name:'Planned',start_date_local:'2026-09-14T00:00:00',moving_time:4000,paired_activity_id:'a1'}],
    wellness:[{id:'2026-09-14',ctl:50,atl:60,hrv:45,restingHR:50}],
  };
  const context=await fetchIntervalsContext(async path=>data[path] || data[path.includes('/activities')?'activities':path.includes('/events')?'events':'wellness'],{now:new Date('2026-09-15T02:00:00Z')});
  assert.equal(context.history.length,1);
  assert.equal(context.history[0].id,'event:1');
  assert.equal(context.history[0].actualDurationMinutes,60);
  const activity=context.planned.find(w=>w.id==='activity:a2');
  assert.equal(activity.editable,false);
  assert.equal(context.athlete.zones.run_threshold_pace,'4:52 min/km');
  assert.equal(context.athlete.zones.swim_css,'1:40 min/100 m');
  assert.equal(context.metrics.form,-10);
});

test('calendar move preserves time, multiday span and prescription using date-only patch',async()=>{
  let stored={id:1,start_date_local:'2026-09-15T08:30:00',end_date_local:'2026-09-17T08:30:00',description:'- 20m 60%',moving_time:1200};
  const request=async(path,options)=>{
    assert.equal(path,'/athlete/0/events/1');
    if(options?.method==='PUT') {
      const patch=JSON.parse(options.body);
      assert.deepEqual(Object.keys(patch).sort(),['end_date_local','start_date_local']);
      stored={...stored,...patch};
    }
    return stored;
  };
  assert.equal((await moveIntervalsEvent(request,'event:1','2026-09-20')).verified,true);
  assert.equal(stored.start_date_local,'2026-09-20T08:30:00');
  assert.equal(stored.end_date_local,'2026-09-22T08:30:00');
  assert.equal(stored.description,'- 20m 60%');
  assert.equal(stored.moving_time,1200);
});

test('invalid calendar IDs, invalid dates and unconfirmed moves cannot report success',async()=>{
  const noCall=async()=>{throw new Error('should not request');};
  await assert.rejects(moveIntervalsEvent(noCall,'activity:a1','2026-09-20'),/read-only/);
  for(const date of ['2026-02-30','2026-99-99','bad']) assert.throws(()=>validDate(date),/valid calendar date/);
  await assert.rejects(moveIntervalsEvent(async()=>({start_date_local:'2026-09-15T00:00:00'}),'event:1','2026-09-20'),/did not confirm/);
});

test('copy strips pairing and identity; deletion requires a verified 404',async()=>{
  const original={id:1,uid:'old',paired_activity_id:'a1',category:'WORKOUT',type:'Ride',name:'Bike',start_date_local:'2026-09-15T00:00:00',description:'- 30m 60%'};
  const request=async(path,options)=>{
    if(options?.method==='POST') {
      const body=JSON.parse(options.body);
      assert.equal(body.id,undefined);assert.equal(body.uid,undefined);assert.equal(body.paired_activity_id,undefined);
      assert.equal(body.description,original.description);
      return {...body,id:2};
    }
    return path.endsWith('/2')?{...original,id:2}:original;
  };
  assert.equal((await changeIntervalsEvent(request,'event:1','copy')).workoutId,'event:2');
  let deleted=false;
  assert.equal((await changeIntervalsEvent(async(path,options)=>{
    if(options?.method==='DELETE'){deleted=true;return null;}
    if(deleted){const error=new Error('404');error.status=404;throw error;}
    return original;
  },'event:1','delete')).verified,true);
  await assert.rejects(changeIntervalsEvent(async()=>original,'event:1','delete'),/did not confirm/);
});

test('coach routes upstream reads to Intervals.icu and never executes chat writes',async()=>{
  const paths=[];
  const read=createIntervalsCoachAdapter(async path=>{paths.push(path);return [{id:1}];});
  assert.equal((await read('listEvents',{oldest:'2026-09-15',newest:'2026-09-16'})).source,'intervals');
  assert.equal(paths[0],'/athlete/0/events?oldest=2026-09-15&newest=2026-09-16');
  const preview=await read('createEvent',{body:{name:'Ride'}});
  assert.equal(preview.not_applied,true);assert.equal(paths.length,1);
});

test('legacy review duration is converted to seconds and verified, unsafe structure refused',async()=>{
  let stored={name:'Ride',start_date_local:'2099-01-01T00:00:00'};
  const request=async(path,options)=>{if(path==='/athlete/0')return {timezone:'America/Chicago'};if(options)stored={...stored,...JSON.parse(options.body)};return stored;};
  assert.equal((await applyIntervalsPatch(request,'event:1',{title:'Easy ride',totalTimePlanned:1})).verified,true);
  assert.equal(stored.moving_time,3600);
  await assert.rejects(applyIntervalsPatch(request,'event:1',{structure:'old provider structure'}),/cannot be applied/);
});
