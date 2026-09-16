import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIntervalsClient,fetchIntervalsContext,moveIntervalsEvent,changeIntervalsEvent,applyIntervalsPatch,mapIntervalsWorkout,validDate} from './intervals.mjs';
import {createIntervalsCoachAdapter} from './triathlon-coach-adapter.mjs';
import {pairIntervalsWorkouts} from './intervals.mjs';

test('unique same-day named swim pairs without upstream links and retains the plan and actual',async()=>{
 const event={id:1,type:'Swim',category:'WORKOUT',name:'Aerobic Swim with Strong Repeats',start_date_local:'2026-09-15T00:00:00',moving_time:3231,description:'3 x 400y',distance:2651.76};
 const activity={id:'i1',type:'Swim',name:event.name,start_date_local:'2026-09-15T16:22:49',moving_time:2930,distance:2651.76};
 const context=await fetchIntervalsContext(async path=>path==='/athlete/0'?{id:'i1'}:path.includes('/activities')?[activity]:path.includes('/events')?[event]:[],{now:new Date('2026-09-15T23:00:00Z')});
 assert.equal(context.history.length,1);
 assert.equal(context.history[0].activity_id,'i1');
 assert.equal(context.history[0].status,'completed');
 assert.equal(context.history[0].details,'3 x 400y');
 assert.equal(context.history[0].workout_summary.planned.duration_seconds,3231);
 assert.equal(context.history[0].workout_summary.completed.duration_seconds,2930);
});

test('inferred pairing refuses ambiguous, different-day, different-sport and note matches',()=>{
 const e={id:1,type:'Swim',category:'WORKOUT',name:'Swim',start_date_local:'2026-09-15'};
 const a={id:'a1',type:'Swim',name:'Swim',start_date_local:'2026-09-15'};
 assert.equal(pairIntervalsWorkouts([e,{...e,id:2}],[a]).size,0);
 assert.equal(pairIntervalsWorkouts([e],[a,{...a,id:'a2'}]).size,0);
 for(const change of [{start_date_local:'2026-09-14'},{type:'Run'},{name:'Other'}])assert.equal(pairIntervalsWorkouts([e],[{...a,...change}]).size,0);
 assert.equal(pairIntervalsWorkouts([{...e,category:'NOTE'}],[a]).size,0);
 assert.equal(pairIntervalsWorkouts([e],[{...a,paired_event_id:99}]).size,0);
 assert.equal(pairIntervalsWorkouts([{...e,paired_activity_id:'missing'}],[a]).size,0);
 assert.equal(pairIntervalsWorkouts([{...e,name:'Different'}],[{...a,paired_event_id:1}]).get('1').id,'a1');
});

test('historical and paired completed workouts retain actual Intervals summary values',()=>{
 const activity={id:'i123',start_date_local:'2026-09-06T08:00:00',type:'Ride',moving_time:6075,distance:49880.28,average_speed:8.205,max_speed:12.447,calories:910,total_elevation_gain:143,total_elevation_loss:141,icu_training_load:76,icu_intensity:52.8,icu_joules:764608,icu_average_watts:126,average_heartrate:151,max_heartrate:171};
 const historical=mapIntervalsWorkout(activity,'2026-09-15',null,true).workout_summary;
 const paired=mapIntervalsWorkout({id:42,start_date_local:'2026-09-06T08:00:00',type:'Ride',moving_time:6000},'2026-09-15',activity).workout_summary;
 assert.equal(historical.planned,null);
 assert.deepEqual(paired.completed,historical.completed);
 assert.equal(historical.completed.duration_seconds,6075);
 assert.equal(historical.completed.calories,910);
 assert.equal(historical.completed.intensity_factor,.528);
 assert.equal(historical.completed.work_kj,764.608);
 assert.equal(historical.completed.average_hr,151);
 assert.equal(historical.completed.average_power,126);
 assert.equal(paired.planned.duration_seconds,6000);
 assert.equal(paired.planned.calories,null);
});

test('app descriptions hide device definitions and use plain workout section headings',()=>{
 const description='**Warm Up:**\n10 mins in Z2.\n\n**Main Set:**\n4 x (2 mins in Z4 + 2 mins recovery in Z2).\n\n**Warm Down:**\n5 mins in Z2.\n\nIntervals.icu device definition:\n- 600s Z2';
 const mapped=mapIntervalsWorkout({id:42,start_date_local:'2026-09-16T00:00:00',type:'Ride',description},'2026-09-16');
 assert.equal(mapped.details,'Warm Up:\n10 mins in Z2.\n\nMain Set:\n4 x (2 mins in Z4 + 2 mins recovery in Z2).\n\nWarm Down:\n5 mins in Z2.');
 assert.equal(mapped.goal,mapped.details);
});

test('app structure retains repeat sets and normalizes parsed yard distances for hover details',()=>{
 const workout_doc={options:{pool_length:'25y'},steps:[{reps:3,steps:[{distance:400,duration:439,pace:{value:100,units:'secs'}},{duration:20,intensity:'rest'}]}]};
 const mapped=mapIntervalsWorkout({id:43,start_date_local:'2026-09-16T00:00:00',type:'Swim',workout_doc},'2026-09-16');
 const structure=JSON.parse(mapped.structure);
 assert.equal(structure.steps[0].reps,3);
 assert.equal(structure.steps[0].steps.length,2);
 assert.equal(structure.steps[0].steps[0].distance,400);
 assert.equal(structure.steps[0].steps[0].distance_units,'yards');
});

test('calendar range fetches only the requested week of workouts',async()=>{
  const paths=[];
  await fetchIntervalsContext(async path=>{paths.push(path);return path==='/athlete/0'?{id:'i1'}:[];},{range:{start:'2026-09-14',end:'2026-09-20'}});
  assert.ok(paths.includes('/athlete/0/activities?oldest=2026-09-14&newest=2026-09-20'));
  assert.ok(paths.includes('/athlete/0/events?oldest=2026-09-14&newest=2026-09-20'));
});

test('browsing a historical week still uses current Intervals fitness metrics',async()=>{
  const context=await fetchIntervalsContext(async path=>path==='/athlete/0'?{id:'i1',timezone:'America/Chicago'}:path.includes('oldest=2026-09-15')?[{id:'2026-09-15',ctl:61,atl:70}]:path.includes('/wellness')?[{id:'2026-08-20',ctl:20,atl:30}]:[],{now:new Date('2026-09-15T18:00:00Z'),range:{start:'2026-08-17',end:'2026-08-23'}});
  assert.deepEqual(context.metrics,{fitness:61,fatigue:70,form:-9});
});

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
  assert.equal(context.athlete.zones.swim_css,'1:31 min/100 yd');
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
