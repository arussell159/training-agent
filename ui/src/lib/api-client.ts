import { toFunctionUrl } from "../../../app-backend/lib/api-routing.mjs"
import {readDeviceCache,writeDeviceCache,deviceCacheScope,clearDeviceCache} from './device-cache'

let authenticated = false
let authRevision = 0
export function setApiAuthenticated(value: boolean) {
  if (authenticated !== value) authRevision++
  authenticated = value
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  if (!authenticated) return new Response(JSON.stringify({ error: 'Sign in to your app to continue.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  const revision = authRevision
  const activity=/^\/api\/activities\/(i?\d+)\/(analysis|summary|route)/.test(path) && (!options?.method || options.method==='GET')
  const key=`activity:${deviceCacheScope()}:${path}`
  if(activity){
    const cached=await readDeviceCache(key)
    if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError')
    if(cached && authenticated && revision === authRevision)return new Response(JSON.stringify(cached),{headers:{'Content-Type':'application/json'}})
  }
  const response=await fetch(toFunctionUrl(path), { ...options, credentials: 'same-origin' })
  if (response.status === 401 && authenticated) {
    setApiAuthenticated(false)
    window.dispatchEvent(new Event('app-auth-required'))
  }
  if (revision !== authRevision) return new Response(JSON.stringify({ error: 'Your session has ended.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  if(response.ok && path==='/api/config' && options?.method==='POST' && typeof options.body==='string') {
    try {if(JSON.parse(options.body).INTERVALS_API_KEY){localStorage.removeItem('training-agent-startup-v2');void clearDeviceCache();window.dispatchEvent(new Event('training-cache-reset'))}}catch{ /* Not a connection change. */ }
  }
  if(activity && response.ok)void response.clone().json().then(value=>{if(authenticated && revision === authRevision)return writeDeviceCache(key,value)}).catch(()=>{})
  return response
}
