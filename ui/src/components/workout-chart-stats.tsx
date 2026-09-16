import type {WorkoutSummaryValues} from '@/lib/training-context'
import {formatSignalClock} from '@/lib/interval-signals'

export function WorkoutChartStats({track,sport,summary}:{track:string;sport:string;summary?:WorkoutSummaryValues|null}){
  if(!summary)return null
  const swim=/swim/i.test(sport),run=/run/i.test(sport)
  const number=(value:number|null|undefined,unit:string,digits=0)=>value!=null&&Number.isFinite(value)?`${value.toLocaleString('en-US',{maximumFractionDigits:digits})}${unit?' '+unit:''}`:null
  const pace=(speed:number|null|undefined)=>speed!=null&&speed>0?`${formatSignalClock((swim?91.44:1609.344)/speed)} /${swim?'100 yd':'mi'}`:null
  const time=(seconds:number|null|undefined)=>seconds!=null&&Number.isFinite(seconds)?formatSignalClock(seconds):null
  const rows: Array<[string,string|null]>=track==='pace'?[
    ['Avg pace',pace(summary.average_speed)],['Moving time',time(summary.duration_seconds)],
    ['Avg elapsed pace',pace(summary.elapsed_speed)],['Elapsed time',time(summary.elapsed_time_seconds)],
  ]:track==='heartRate'?[
    ['Avg heart rate',number(summary.average_hr,'bpm')],['Max heart rate',number(summary.max_hr,'bpm')],
  ]:track==='cadence'?[
    [swim?'Avg stroke rate':'Avg cadence',number(summary.average_cadence,swim?'strokes/min':run?'spm':'rpm')],
    [swim?'Max stroke rate':'Max cadence',number(summary.max_cadence,swim?'strokes/min':run?'spm':'rpm')],
  ]:track==='power'?[
    ['Avg power',number(summary.average_power,'W')],['Max power',number(summary.max_power,'W')],
    ['Moving time',time(summary.duration_seconds)],['Elapsed time',time(summary.elapsed_time_seconds)],['Work',number(summary.work_kj,'kJ',1)],
  ]:[
    ['Calories',number(summary.calories,'Cal')],['Training load',number(summary.tss,'TSS')],['Intensity factor',number(summary.intensity_factor,'',2)],
    ['Elevation gain',number(summary.elevation_gain==null?null:summary.elevation_gain/.3048,'ft')],
    ['Elevation loss',number(summary.elevation_loss==null?null:summary.elevation_loss/.3048,'ft')],
  ]
  const visible=rows.filter((row):row is [string,string]=>row[1]!=null)
  if(!visible.length)return null
  return <dl aria-label={`${track==='totals'?'Workout':track==='heartRate'?'Heart rate':track==='cadence'?'Cadence':track==='pace'?'Pace':'Power'} statistics`} className="space-y-5 py-5 md:hidden">{visible.map(([label,value])=><div key={label} className="flex items-baseline justify-between gap-4"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-right text-base font-semibold tabular-nums">{value}</dd></div>)}</dl>
}
