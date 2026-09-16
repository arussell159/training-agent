import {useMemo,useRef,useState} from 'react'
import {formatSignalClock,intervalSignals,type RecordedLap} from '@/lib/interval-signals'
import type {RecordedPoint} from '@/lib/segment-statistics'

export function WorkoutLapChart({points,laps,sport,selected,onSelect}:{points:RecordedPoint[];laps:RecordedLap[];sport:string;selected:RecordedLap|null;onSelect:(lap:RecordedLap)=>void}){
  const scroll=useRef<HTMLDivElement>(null)
  const touchStart=useRef<{id:number;x:number;y:number}|null>(null)
  const [tooltipLeft,setTooltipLeft]=useState(150)
  const swim=/swim/i.test(sport),pace=/swim|run/i.test(sport)
  const intervals=useMemo(()=>intervalSignals(points,laps),[points,laps])
  const signal=(point:RecordedPoint)=>pace?point.speed!=null&&point.speed>.15?(swim?91.44:1609.344)/point.speed:null:point.power
  const bars=intervals.map((item,index)=>({...item,index,value:signal(item.point)})).filter((item):item is typeof item & {value:number}=>item.value!=null&&Number.isFinite(item.value))
  if(!bars.length)return null
  const duration=Math.max(1,bars.reduce((sum,bar)=>sum+bar.lap.end-bar.lap.start,0))
  const width=Math.max(480,bars.length*40)
  const gap=2,plotWidth=width-gap*(bars.length-1)
  let elapsed=0
  const positions=new Map(bars.map((bar,index)=>{
    const left=elapsed/duration*plotWidth+index*gap
    const barWidth=(bar.lap.end-bar.lap.start)/duration*plotWidth
    elapsed+=bar.lap.end-bar.lap.start
    return [bar.lap.id,{left,width:barWidth,center:left+barWidth/2}]
  }))
  const minimum=Math.min(...bars.map(bar=>bar.value)),maximum=Math.max(...bars.map(bar=>bar.value))
  const low=pace?Math.max(0,minimum-10):0,high=pace?Math.max(low+20,maximum+10):Math.max(1,maximum*1.1)
  const y=(value:number)=>pace?20+(value-low)/(high-low)*170:190-(value-low)/(high-low)*170
  const unit=pace?swim?'min/100 yd':'min/mi':'W'
  const format=(value:number)=>pace?formatSignalClock(value):Math.round(value).toLocaleString()
  const inspected=bars.find(bar=>bar.lap.id===selected?.id)
  const position=(left:number)=>{
    const viewport=scroll.current?.clientWidth || 300
    setTooltipLeft(Math.max(92,Math.min(viewport-92,left)))
  }
  const select=(lap:RecordedLap,clientX?:number)=>{
    onSelect(lap)
    const viewport=scroll.current
    if(!viewport)return
    if(clientX!=null)position(clientX-viewport.getBoundingClientRect().left)
    else{
      const center=positions.get(lap.id)!.center
      viewport.scrollTo({left:Math.max(0,center-viewport.clientWidth/2),behavior:'smooth'})
      position(viewport.clientWidth/2)
    }
  }
  return <section aria-label="Lap chart" className="space-y-2 md:hidden">
    <h3 className="text-base font-semibold">{swim?'Swim intervals':'Laps'}</h3>
    <p className="text-xs text-muted-foreground">Tap an interval for details. Scroll left or right.</p>
    <div className="relative pt-[76px]">
      <div className="absolute top-[76px] bottom-0 left-0 z-10 w-12 bg-background" aria-hidden="true">{[0,.25,.5,.75,1].map(f=><span key={f} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{top:20+170*f}}>{format(pace?low+f*(high-low):high-f*(high-low))}</span>)}</div>
      <div className="relative ml-12">
        {inspected&&<div role="status" style={{left:tooltipLeft,transform:'translateX(-50%)'}} className="pointer-events-none absolute -top-[72px] z-20 w-44 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg"><p className="truncate text-muted-foreground">{inspected.lap.label}</p><p className="font-semibold">{format(inspected.value)} {unit}</p><p>Duration {formatSignalClock(inspected.lap.end-inspected.lap.start)}{inspected.lap.distance!=null&&inspected.lap.distance>0?` · ${swim?Math.round(inspected.lap.distance/.9144)+' yd':(inspected.lap.distance/1609.344).toFixed(2)+' mi'}`:''}</p></div>}
        <div ref={scroll} className="overflow-x-auto overscroll-x-contain touch-pan-x pb-1" onScroll={()=>{if(selected&&scroll.current)position((positions.get(selected.id)?.center || 0)-scroll.current.scrollLeft)}}>
          <svg width={width} height="228" viewBox={`0 0 ${width} 228`} className="block select-none" role="group" aria-label="Scrollable interval averages">
            {[0,.25,.5,.75,1].map(f=><line key={f} x1="0" x2={width} y1={20+170*f} y2={20+170*f} stroke="currentColor" opacity=".08"/>)}
            {bars.map(bar=>{
              const position=positions.get(bar.lap.id)!,left=position.left,barWidth=position.width,top=y(bar.value)
              return <g key={bar.lap.id} role="button" tabIndex={0} aria-label={`${bar.lap.label}, ${format(bar.value)} ${unit}, duration ${formatSignalClock(bar.lap.end-bar.lap.start)}`} aria-pressed={selected?.id===bar.lap.id} className="cursor-pointer outline-none focus:opacity-70" onPointerDown={event=>{touchStart.current={id:event.pointerId,x:event.clientX,y:event.clientY}}} onPointerCancel={()=>{touchStart.current=null}} onPointerUp={event=>{const start=touchStart.current;touchStart.current=null;if(start?.id===event.pointerId&&Math.hypot(event.clientX-start.x,event.clientY-start.y)<8){event.stopPropagation();select(bar.lap,event.clientX)}}} onClick={event=>select(bar.lap,event.clientX)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(bar.lap)}}}>
                <rect x={left} y={0} width={barWidth} height="228" fill="transparent"/>
                <rect x={left} y={top} width={barWidth} height={Math.max(2,190-top)} rx={Math.min(7,barWidth/2)} fill={selected?.id===bar.lap.id?'#b8d5f3':'#287ed7'}/>
                {barWidth>22&&<text x={left+barWidth/2} y="214" textAnchor="middle" fontSize="11" fill="currentColor" opacity=".65">{bar.index+1}</text>}
              </g>
            })}
          </svg>
        </div>
      </div>
    </div>
  </section>
}
