import { toFunctionUrl } from "../../../app-backend/lib/api-routing.mjs"
import {readDeviceCache,writeDeviceCache,deviceCacheScope,clearDeviceCache} from './device-cache'

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const activity=/^\/api\/activities\/(i?\d+)\/(analysis|summary|route)/.test(path) && (!options?.method || options.method==='GET')
  const key=`activity:${deviceCacheScope()}:${path}`
  if(activity){
    const cached=await readDeviceCache(key)
    if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError')
    if(cached)return new Response(JSON.stringify(cached),{headers:{'Content-Type':'application/json'}})
  }
  const response=await fetch(toFunctionUrl(path), options)
  if(response.ok && path==='/api/config' && options?.method==='POST' && typeof options.body==='string') {
    try {if(JSON.parse(options.body).INTERVALS_API_KEY){localStorage.removeItem('training-agent-startup-v2');void clearDeviceCache();window.dispatchEvent(new Event('training-cache-reset'))}}catch{ /* Not a connection change. */ }
  }
  if(activity && response.ok)void response.clone().json().then(value=>writeDeviceCache(key,value)).catch(()=>{})
  return response
}
