import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {generateCoachResponse} from './coach-response.mjs';
import {loadCoachingInstructions} from './coaching-policy.mjs';
import {createIntervalsCoachAdapter,triathlonCoachTools} from './triathlon-coach-adapter.mjs';

test('production policy is byte-for-byte upstream instructions',async()=>{
  assert.equal(await loadCoachingInstructions(),await fs.readFile(new URL('../vendor/open-triathlon-coach/API instructions.md',import.meta.url),'utf8'));
});
test('coach requests Intervals.icu tools and excludes old memory and fixed context',async()=>{
  const requests=[];
  const result=await generateCoachResponse({OPENAI_API_KEY:'test'},{guide:'Upstream policy',currentDate:'2026-09-15',context:{},memory:[{content:'OLD POLICY'}],history:[],message:'Review today',executeTool:async(name,args)=>({title:'Actual planned workout',name,args})},async(url,options)=>{
    requests.push(JSON.parse(options.body));
    return {ok:true,json:async()=> requests.length===1 ? {output:[{type:'function_call',call_id:'call1',name:'listEvents',arguments:'{"oldest":"2026-09-15","newest":"2026-09-16"}'}]} : {output_text:'Specific coaching answer'}};
  });
  assert.equal(result,'Specific coaching answer');
  assert.ok(requests[0].instructions.startsWith('Upstream policy'));
  assert.equal(requests[0].reasoning.effort,'high');
  assert.doesNotMatch(JSON.stringify(requests),/OLD POLICY|recent_training_history|Personalize training answers/);
  assert.match(JSON.stringify(requests[1].input),/Actual planned workout/);
});
test('upstream operation catalogue is complete and includes write body schemas',async()=>{
  const tools=await triathlonCoachTools();
  assert.equal(tools.length,22);
  assert.ok(tools.find(tool=>tool.name==='createEvent').parameters.properties.body);
});
test('unconnected reads and write previews do not fabricate or apply data',async()=>{
  const read=createIntervalsCoachAdapter();
  assert.match((await read('getAthlete')).unavailable,/Connect Intervals/);
  const preview=await read('createEvent',{body:{category:'WORKOUT',type:'Ride',name:'Ride',start_date_local:'2026-09-16T00:00:00',moving_time:3600}});
  assert.equal(preview.status,'preview_only');
  assert.equal(preview.not_applied,true);
  assert.equal(preview.proposed.moving_time,3600);
});
