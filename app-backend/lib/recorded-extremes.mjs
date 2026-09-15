export function recordedExtremes(streams){
 const values=(type,positive=false)=>(streams.find(s=>s.type===type)?.data || []).filter(v=>typeof v==='number'&&Number.isFinite(v)&&(!positive||v>0));
 const result={};
 for(const [type,min,max,positive] of [['heartrate','min_hr','max_hr',true],['velocity_smooth','min_speed','max_speed',true],['watts','min_power','max_power',false],['cadence','min_cadence','max_cadence',false]]){
  const v=values(type,positive);if(v.length){result[min]=v.reduce((a,b)=>Math.min(a,b));result[max]=v.reduce((a,b)=>Math.max(a,b));}
 }
 return result;
}
