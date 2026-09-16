import {providerConnection} from './completed-workout-store.mjs';
import {validDate} from './intervals.mjs';

export function validateMutation(input) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.operationId || ''))throw Error('A valid operation ID is required');
  if(!/^(event:\d+|activity:i?\d+)$/.test(input.id || ''))throw Error('Invalid workout');
  if(input.type==='move') {if(!input.id.startsWith('event:'))throw Error('Only planned events can be moved');validDate(input.date);}
  else if(input.type==='description') {if(typeof input.description!=='string'||input.description.length>30000)throw Error('Description must be text under 30,000 characters');}
  else throw Error('Only idempotent moves and description edits can be queued');
  return {operationId:input.operationId,id:input.id,type:input.type,...(input.type==='move'?{date:input.date}:{description:input.description})};
}

export function pendingMutationContext(context,mutation) {
  let found=false;
  const map=workout=>{
    if(workout.id!==mutation.id)return workout;
    found=true;
    const patch=mutation.type==='description'?{details:mutation.description,goal:mutation.description}:{workout_date:mutation.date,day:new Date(`${mutation.date}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'}).toUpperCase(),date:new Date(`${mutation.date}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})};
    return {...workout,...patch,sync_status:'pending',sync_operation:mutation.operationId,app_updated_at:new Date().toISOString()};
  };
  // Keep the updated item in both collections until the projection repartitions
  // by its new date. This avoids losing an item moved across today's boundary.
  const sessions=[...new Map([...(context.history || []),...(context.planned || [])].map(w=>[w.id,map(w)])).values()];
  if(!found)throw Error('Workout is not in the saved calendar; refresh before editing');
  return {...context,history:sessions,planned:sessions};
}

export function createMutationQueue(config,store) {
  const prefix=`mutation:v1:${providerConnection(config)}:`;
  const write=(id,cursor)=>store.upsert('sync_state',[{athlete_id:prefix+id,status:'mutation',cursor,updated_at:new Date().toISOString()}]);
  return {
    async enqueue(input) {
      const mutation=validateMutation(input);
      const previous=await store.getSyncRecord(prefix+mutation.operationId);
      if(previous){if(JSON.stringify(previous.mutation)!==JSON.stringify(mutation))throw Error('Operation ID cannot be reused for a different edit');return previous;}
      const older=await store.listSyncRecords(prefix);
      const job={mutation,state:'pending',attempts:0,created_at:new Date().toISOString()};
      await write(mutation.operationId,job);
      for(const row of older)if(row.cursor.mutation.id===mutation.id && row.cursor.mutation.type===mutation.type)await write(row.cursor.mutation.operationId,{...row.cursor,state:'superseded'});
      return job;
    },
    async drain(apply,{retryFailed=false,now=Date.now()}={}) {
      const rows=(await store.listSyncRecords(prefix)).sort((a,b)=>a.cursor.created_at.localeCompare(b.cursor.created_at));
      let synced=0,failed=0,pending=0;
      const blocked=new Set();
      for(const row of rows){
        const job=row.cursor;
        if(blocked.has(job.mutation.id)){pending++;continue;}
        if(job.state==='failed'&&!retryFailed){failed++;blocked.add(job.mutation.id);continue;}
        if(job.next_retry_at>now&&!retryFailed){pending++;blocked.add(job.mutation.id);continue;}
        try {
          await apply(job.mutation);
          await write(job.mutation.operationId,{...job,state:'synced',error:null,synced_at:new Date().toISOString()});synced++;
        }catch(error){
          const attempts=job.attempts+1;
          const retryable=error.status==null || error.status===429 || error.status>=500;
          const state=retryable && attempts<5?'retry':'failed';
          await write(job.mutation.operationId,{...job,attempts,state,error:error.message,next_retry_at:now+Math.min(1800000,60000*2**attempts)});
          if(state==='failed')failed++;else pending++;
          // Do not apply later edits out of order after an uncertain failure.
          blocked.add(job.mutation.id);
        }
      }
      return {synced,failed,pending};
    },
  };
}
