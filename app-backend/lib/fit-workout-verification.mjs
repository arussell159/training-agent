// Independently inspect exported FIT workout_step messages, not calendar JSON.
function readFitWorkoutMessages(b,global){
 if(b.toString('ascii',8,12)!=='.FIT')throw new Error('Not a FIT workout');
 let p=b[0];const end=p+b.readUInt32LE(4),definitions=new Map(),steps=[];
 while(p<end){
  const h=b[p++];if(h&128)throw new Error('Unexpected compressed workout record');const local=h&15;
  if(h&64){p++;const big=b[p++],global=big?b.readUInt16BE(p):b.readUInt16LE(p);p+=2;const count=b[p++],fields=[];for(let i=0;i<count;i++){fields.push({id:b[p],size:b[p+1],type:b[p+2]});p+=3;}let extra=0;if(h&32){const n=b[p++];for(let i=0;i<n;i++){extra+=b[p+1];p+=3;}}definitions.set(local,{big,global,fields,extra});}
  else {const d=definitions.get(local);if(!d)throw new Error('Unknown FIT record');const values={};for(const f of d.fields){const type=f.type&31;values[f.id]=type===7?b.toString('utf8',p,p+f.size).replace(/\0.*$/s,''):f.size===1?b[p]:f.size===2?(d.big?b.readUInt16BE(p):b.readUInt16LE(p)):f.size===4?(d.big?b.readUInt32BE(p):b.readUInt32LE(p)):null;p+=f.size;}p+=d.extra;if(d.global===global)steps.push(values);}
 }
 return steps;
}

export function readFitWorkoutSteps(b){
 return readFitWorkoutMessages(b,27).map(v=>({index:v[254],name:v[0],durationType:v[1],durationValue:v[2],targetType:v[3],targetValue:v[4],targetLow:v[5],targetHigh:v[6],intensity:v[7]}));
}

export function readFitWorkoutMetadata(b){
 return readFitWorkoutMessages(b,26).map(v=>({sport:v[4],poolLengthMeters:v[14]!=null&&v[14]!==65535?v[14]/100:null,poolLengthUnit:v[15]===1?'yards':v[15]===0?'meters':null}));
}

export function expandFitWorkoutSteps(steps){
 const expanded=[],starts=new Map();
 for(const step of steps){
  starts.set(step.index,expanded.length);
  if(step.durationType===6){
   const start=starts.get(step.durationValue);
   if(start==null || !(step.targetValue>0) || step.targetValue>1000)throw new Error('Invalid FIT repeat');
   const block=expanded.slice(start);
   for(let i=1;i<step.targetValue;i++)expanded.push(...block);
  }else expanded.push(step);
 }
 return expanded;
}
