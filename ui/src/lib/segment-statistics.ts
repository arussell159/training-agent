export type RecordedPoint={dfaA1?:number|null;dfaArtifacts?:number|null;time:number;power:number|null;heartRate:number|null;speed:number|null;distance:number|null;cadence?:number|null;elevation?:number|null;latitude?:number|null;longitude?:number|null}

// Time-weight samples, including recorded zeros. Missing signals never become zeros.
export function segmentStatistics(points:RecordedPoint[],start:number,end:number){
  const sums={power:0,heartRate:0,speed:0,cadence:0},weights={...sums}
  for(let i=0;i<points.length-1;i++){
    const p=points[i],weight=Math.max(0,Math.min(end,points[i+1].time)-Math.max(start,p.time))
    if(!weight)continue
    for(const key of ['power','heartRate','speed','cadence'] as const){const v=p[key];if(v!=null&&Number.isFinite(v)){sums[key]+=v*weight;weights[key]+=weight}}
  }
  const mean=(key:keyof typeof sums)=>weights[key]?sums[key]/weights[key]:null
  return {power:mean('power'),heartRate:mean('heartRate'),speed:mean('speed'),cadence:mean('cadence'),duration:Math.max(0,end-start)}
}
