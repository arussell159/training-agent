import {gunzipSync} from 'node:zlib';

export function readFitLaps(buffer){
  const b=buffer[0]===31 && buffer[1]===139?gunzipSync(buffer):buffer;
  if(b.length<14 || b.toString('ascii',8,12)!=='.FIT')throw new Error('Not a FIT recording');
  const defs=new Map(),laps=[];let p=b[0];const end=p+b.readUInt32LE(4);
  while(p<end){const h=b[p++],compressed=!!(h&128),local=compressed?(h>>5)&3:h&15;
    if(!compressed && h&64){p++;const big=b[p++];const global=big?b.readUInt16BE(p):b.readUInt16LE(p);p+=2;const n=b[p++],fields=[];for(let i=0;i<n;i++){fields.push({id:b[p],size:b[p+1]});p+=3;}let extra=0;if(h&32){const n=b[p++];for(let i=0;i<n;i++){extra+=b[p+1];p+=3;}}defs.set(local,{big,global,fields,extra});}
    else{const d=defs.get(local);if(!d)throw new Error('Invalid FIT definition');const v={};for(const f of d.fields){if(compressed && f.id===253)continue;const val=f.size===1?b[p]:f.size===2?(d.big?b.readUInt16BE(p):b.readUInt16LE(p)):f.size===4?(d.big?b.readUInt32BE(p):b.readUInt32LE(p)):null;if(val!==null && val!==Math.pow(256,f.size)-1)v[f.id]=val;p+=f.size;}p+=d.extra;if(d.global===19 && v[2]!=null && v[7]!=null)laps.push({timestamp:v[2],duration:v[7]/1000,power:v[19]??null,heartRate:v[15]??null,distance:v[9]!=null?v[9]/100:null});}
  }return laps;
}

export function normalizeAnalysis(activity,streams,fitLaps=[]){
  const byType=new Map(streams.map(s=>[s.type,s.data || []])),times=byType.get('time') || [];
  const numeric=v=>typeof v==='number' && Number.isFinite(v)?v:null;
  const points=times.map((time,i)=>({time:numeric(time),power:numeric(byType.get('watts')?.[i]),heartRate:numeric(byType.get('heartrate')?.[i]),cadence:numeric(byType.get('cadence')?.[i]),speed:numeric(byType.get('velocity_smooth')?.[i]),distance:numeric(byType.get('distance')?.[i])})).filter(p=>p.time!==null);
  const epoch=Date.UTC(1989,11,31)/1000,start=Date.parse(activity.start_date)/1000-epoch;
  const laps=fitLaps.filter(l=>Number.isFinite(start)).map((l,i)=>({id:`lap-${i}`,label:`Lap ${i+1}`,start:Math.max(0,l.timestamp-start),end:l.timestamp-start+l.duration,power:l.power,heartRate:l.heartRate,distance:l.distance,kind:'lap'}));
  const intervals=(activity.icu_intervals || []).filter(l=>Number.isFinite(l.start_time)&&Number.isFinite(l.end_time)).map((l,i)=>({id:`interval-${i}`,label:l.label || `${l.type==='WORK'?'Work':'Recovery'} ${i+1}`,start:l.start_time,end:l.end_time,power:l.average_watts??null,heartRate:l.average_heartrate??null,distance:l.distance??null,kind:'interval'}));
  return {activityId:activity.id,points,laps,intervals,duration:points.at(-1)?.time || 0};
}
