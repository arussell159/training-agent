import {useEffect,useMemo,useRef} from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

import {mapboxConfig} from '@/lib/mapbox-config'

export type MapRoutePoint={time:number;latitude:number;longitude:number}

const line=(points:MapRoutePoint[])=>({type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates:points.map(point=>[point.longitude,point.latitude])}})

export function MapboxRouteMap({points,highlightRange,className,interactive=true,topPadding=0,bottomPadding=0}:{points:MapRoutePoint[];highlightRange?:[number,number]|null;className:string;interactive?:boolean;topPadding?:number;bottomPadding?:number}){
 const container=useRef<HTMLDivElement>(null),mapRef=useRef<mapboxgl.Map|null>(null),highlightedRef=useRef<MapRoutePoint[]>([])
 const valid=useMemo(()=>points.filter(point=>Number.isFinite(point.time)&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=85&&Math.abs(point.longitude)<=180),[points])
 const highlighted=useMemo(()=>highlightRange?valid.filter(point=>point.time>=highlightRange[0]&&point.time<=highlightRange[1]):[],[highlightRange,valid])
 highlightedRef.current=highlighted
 useEffect(()=>{
  if(!container.current||!mapboxConfig||valid.length<2)return
  mapboxgl.accessToken=mapboxConfig.accessToken
  const map=new mapboxgl.Map({container:container.current,style:mapboxConfig.style,center:[valid[0].longitude,valid[0].latitude],zoom:12,interactive,attributionControl:true,logoPosition:'bottom-left'})
  mapRef.current=map
  if(interactive)map.addControl(new mapboxgl.NavigationControl({showCompass:false}),'top-left')
  const start=document.createElement('div');start.className='size-4 rounded-full border-[3px] border-white bg-lime-600 shadow-sm'
  const finish=document.createElement('div');finish.className='size-[18px] rounded-full border-[3px] border-white shadow-sm';finish.style.background='conic-gradient(#111827 0 25%, white 0 50%, #111827 0 75%, white 0)';finish.style.backgroundSize='6px 6px'
  const startMarker=new mapboxgl.Marker({element:start}).setLngLat([valid[0].longitude,valid[0].latitude]),finishMarker=new mapboxgl.Marker({element:finish}).setLngLat([valid.at(-1)!.longitude,valid.at(-1)!.latitude])
  map.on('load',()=>{
   map.addSource('recorded-route',{type:'geojson',data:line(valid)})
   map.addLayer({id:'recorded-route-casing',type:'line',source:'recorded-route',paint:{'line-color':'#ffffff','line-width':8,'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}})
   map.addLayer({id:'recorded-route-line',type:'line',source:'recorded-route',paint:{'line-color':'#1677b8','line-width':4.5},layout:{'line-cap':'round','line-join':'round'}})
   map.addSource('highlighted-route',{type:'geojson',data:line(highlightedRef.current)})
   map.addLayer({id:'highlighted-route-casing',type:'line',source:'highlighted-route',paint:{'line-color':'#ffffff','line-width':9},layout:{'line-cap':'round','line-join':'round'}})
   map.addLayer({id:'highlighted-route-line',type:'line',source:'highlighted-route',paint:{'line-color':'#f4511e','line-width':5.5},layout:{'line-cap':'round','line-join':'round'}})
   startMarker.addTo(map);finishMarker.addTo(map)
   const bounds=new mapboxgl.LngLatBounds();for(const point of valid)bounds.extend([point.longitude,point.latitude])
   map.fitBounds(bounds,{padding:{top:36+topPadding,right:36,bottom:36+bottomPadding,left:36},animate:false,maxZoom:16})
  })
  const observer=new ResizeObserver(()=>map.resize());observer.observe(container.current)
  return()=>{observer.disconnect();startMarker.remove();finishMarker.remove();map.remove();mapRef.current=null}
 },[bottomPadding,interactive,topPadding,valid])
 useEffect(()=>{
  const map=mapRef.current,source=map?.getSource('highlighted-route') as mapboxgl.GeoJSONSource|undefined
  if(source)source.setData(line(highlighted))
 },[highlighted])
 if(!mapboxConfig)return <div className={`${className} flex items-center justify-center bg-muted/25 text-xs text-muted-foreground`}>Mapbox is not configured.</div>
 return <div ref={container} className={className} aria-label="Activity route"/>
}
