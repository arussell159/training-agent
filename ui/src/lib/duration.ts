/** Workout durations use hours/minutes; pace and chart timestamps remain precise. */
export function formatDuration(minutes:number){
 if(!Number.isFinite(minutes))return '—'
 const rounded=Math.max(0,Math.round(minutes))
 return `${String(Math.floor(rounded/60)).padStart(2,'0')}h ${String(rounded%60).padStart(2,'0')}m`
}

export function formatPace(seconds:number){
 if(!Number.isFinite(seconds))return '—'
 const rounded=Math.max(0,Math.round(seconds))
 if(rounded>=3600)return formatDuration(rounded/60)
 return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}`
}
