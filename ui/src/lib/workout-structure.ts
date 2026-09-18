export function hasWorkoutStructure(value?: string | null): boolean {
  if (!value) return false
  try {
    const parsed = JSON.parse(value)
    const steps = Array.isArray(parsed) ? parsed : parsed?.steps ?? parsed?.structure
    return Array.isArray(steps) && steps.length > 0
  } catch {
    return false
  }
}

type Target = { value?: number; start?: number; end?: number; units?: string }
export type WorkoutStep = { duration?: number; distance?: number; distance_meters?: number; distance_units?: string; length?: number; reps?: number; steps?: WorkoutStep[]; power?: Target; pace?: Target; intensity?: string; ramp?: boolean; text?: string }
type Step = WorkoutStep

// Render the provider's actual steps. Descriptions and titles are never used to
// invent a profile. Both axes are relative: width is elapsed seconds and height
// is target intensity normalized within the session.
export function structuredWorkoutProfile(value?: string | null): {position:number;intensity:number}[] {
  if (!value) return []
  try {
    const parsed=JSON.parse(value)
    const steps:Step[]=Array.isArray(parsed)?parsed:parsed?.steps ?? parsed?.structure
    if (!Array.isArray(steps)) return []
    const segments:{duration:number;score:number}[]=[]
    const walk=(items:Step[],depth=0)=>{
      if(depth>8 || segments.length>20000)return
      for(const step of items){
        if(step.steps){for(let i=0;i<Math.min(1000,Math.max(1,Number(step.reps || 1)));i++)walk(step.steps,depth+1);continue}
        const duration=Number(step.duration)
        if(!(duration>0))continue
        const target=step.power ?? step.pace
        const start=Number(target?.value ?? target?.start)
        const end=Number(target?.value ?? target?.end ?? start)
        const score=(n:number)=>{
          if(step.intensity==='rest')return 0
          if(!Number.isFinite(n) || n<=0)return 0
          if(step.power)return n
          if(target?.units==='pace_zone')return n
          if(target?.units?.startsWith('secs'))return 1/n
          return n
        }
        const pieces=step.ramp?8:1
        for(let i=0;i<pieces;i++)segments.push({duration:duration/pieces,score:score(start+(end-start)*(i+.5)/pieces)})
      }
    }
    walk(steps)
    const maximum=Math.max(...segments.map(s=>s.score),0)
    let position=0
    return segments.flatMap(s=>{
      const intensity=s.score>0 && maximum>0?15+s.score/maximum*80:5
      const start={position,intensity};position+=s.duration
      return [start,{position,intensity}]
    })
  } catch {return []}
}

export function workoutProfileSegments(value?:string|null){
  const points=structuredWorkoutProfile(value)
  const metadata:{step:Step;repeatCount:number;group:Step[];setId:string}[]=[]
  try {
    const parsed=JSON.parse(value || 'null'),steps:Step[]=Array.isArray(parsed)?parsed:parsed?.steps ?? parsed?.structure
    if(!Array.isArray(steps))return []
    let nextSetId=0
    const walk=(items:Step[],repeatCount=1,group:Step[]=[],setId='',depth=0)=>{
      if(depth>8 || metadata.length>20000)return
      for(const step of items){
        if(step.steps){
          const repeatSetId=setId||`repeat-${nextSetId++}`
          for(let i=0;i<Math.min(1000,Math.max(1,Number(step.reps || 1)));i++)walk(step.steps,Number(step.reps || 1),group.length?group:step.steps,repeatSetId,depth+1)
          continue
        }
        if(!(Number(step.duration)>0))continue
        const leafSetId=setId||`step-${nextSetId++}`
        for(let i=0;i<(step.ramp?8:1);i++)metadata.push({step,repeatCount,group:group.length?group:[step],setId:leafSetId})
      }
    }
    walk(steps)
    return metadata.map((info,i)=>({...info,width:points[i*2+1].position-points[i*2].position,intensity:points[i*2].intensity}))
  }catch{return []}
}

export function workoutStepLabel(step:WorkoutStep,sport:string){
  const clock=(n:number)=>{const secs=Math.round(n);return `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`}
  const intervalTime=(n:number)=>{const secs=Math.max(0,Math.round(n));if(secs<60)return `${secs} ${secs===1?'sec':'secs'}`;if(secs%60===0)return `${secs/60} min`;return clock(secs)}
  const duration=Number(step.duration || 0)
  const swim=/swim/i.test(sport)
  const distance=Number(step.distance ?? step.distance_meters ?? step.length)
  // ICU swim steps may carry a duration for execution but their prescription
  // is distance-based. Never present that execution duration as the interval
  // amount when ICU supplied no usable distance.
  const amount=distance>0?(swim?`${Math.round(distance).toLocaleString()} yd`:`${(distance/1609.344).toFixed(2)} mi`):step.intensity==='rest'?intervalTime(duration):swim?'Distance unavailable':intervalTime(duration)
  if(step.intensity==='rest')return `${amount} rest`
  const target=step.power ?? step.pace
  if(!target)return amount
  const format=(n:number)=>target.units?.includes('zone')?`Z${n}`:step.power?`${Math.round(n)}w`:target.units?.startsWith('secs')?clock(n):`${Math.round(n)}%`
  const goal=target.value!=null?format(target.value):`${format(target.start || 0)}${step.ramp?' → ':'–'}${format(target.end || 0)}`
  const unit=target.units==='secs/mi'?' min/mile':target.units==='secs/km'?' min/km':target.units==='secs/100y'||swim&&target.units==='secs'?' /100 yd':''
  return `${amount} at ${goal}${unit}`
}
