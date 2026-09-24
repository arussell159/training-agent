import {lazy,Suspense,useMemo} from 'react'
import {mapboxConfig} from '@/lib/mapbox-config'

export type MapRoutePoint={time:number;latitude:number;longitude:number}

type MapCanvasProps={points:MapRoutePoint[];center?:[number,number];highlightRange?:[number,number]|null;className:string;interactive?:boolean;topPadding?:number;bottomPadding?:number}

const MapCanvas=lazy(()=>import('@/components/mapbox-route-map-canvas').then(module=>({default:module.MapboxRouteMapCanvas})))

export function MapboxRouteMap(props:MapCanvasProps){
 const available=useMemo(()=>{
  let valid=0
  for(const point of props.points){
   if(Number.isFinite(point.time)&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=85&&Math.abs(point.longitude)<=180&&++valid===2)return true
  }
  return false
 },[props.points])
 if(!mapboxConfig)return <div className={`${props.className} flex items-center justify-center bg-muted/25 text-xs text-muted-foreground`}>Mapbox is not configured.</div>
 if(!available&&!props.center)return <div className={props.className} aria-hidden="true"/>
 return <Suspense fallback={<div className={props.className} aria-label="Loading activity map"/>}><MapCanvas {...props}/></Suspense>
}

/* The implementation stays in its own deferred chunk so route-less workout
details do not download Mapbox GL. */
export type {MapCanvasProps as MapboxRouteMapProps}
