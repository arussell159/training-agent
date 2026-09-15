import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {generateCoachResponse} from './coach-response.mjs';
import {loadCoachingInstructions} from './coaching-policy.mjs';
import {createTrainingPeaksCoachAdapter,triathlonCoachTools} from './triathlon-coach-adapter.mjs';

test('production policy is byte-for-byte upstream instructions',async()=>{
  assert.equal(await loadCoachingInstructions(),await fs.readFile(new URL('../vendor/open-triathlon-coach/API instructions.md',import.meta.url),'utf8'));
});
test('coach requests TrainingPeaks tools and excludes old memory and fixed context',async()=>{
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
test('snapshot reads preserve source values, date range and avoid fabricated capabilities',async()=>{
  const read=createTrainingPeaksCoachAdapter({athlete:{name:'Alex',phase:'legacy'},planned:[{id:'1',workout_date:'2026-09-15',title:'Today'}],history:[{id:'2',workout_date:'2026-09-01',status:'completed',completed_data:{duration_minutes:60}}]});
  assert.equal((await read('listEvents',{oldest:'2026-09-15',newest:'2026-09-15'})).data.length,1);
  assert.equal((await read('getAthleteProfile')).data.phase,undefined);
  assert.match((await read('getPowerCurves')).unavailable,/no verified equivalent/);
  assert.equal((await read('createEvent',{body:{category:'WORKOUT',type:'Ride',name:'Ride',start_date_local:'2026-09-16',moving_time:3600}})).trainingpeaks_payload.totalTimePlanned,1);
});
