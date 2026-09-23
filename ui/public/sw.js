self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try {const response=await fetch('/');if(response.ok && new URL(response.url).origin===self.location.origin && response.headers.get('content-type')?.includes('text/html'))await (await caches.open('training-agent-shell-v3')).put('/__app_shell__',response)}catch{ /* Existing shell still works offline. */ }
    try {await (await caches.open('training-agent-shell-v3')).addAll(['/ar-performance-background.png','/ar-performance-favicon.png'])}catch{ /* Branding assets can be fetched again when online. */ }
    await self.skipWaiting()
  })())
})
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('training-agent-shell-')&&key!=='training-agent-shell-v3')await caches.delete(key)
  try {
    const subscription=await self.registration.pushManager?.getSubscription()
    if(subscription)await subscription.unsubscribe()
  } catch { /* Retiring push delivery must not block the app shell update. */ }
  await self.clients.claim()
})()))
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url)
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return
  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open('training-agent-shell-v3')
      const cached=await cache.match('/__app_shell__')
      const fresh=fetch(event.request).then(async response=>{
        if(response.ok && new URL(response.url).origin===self.location.origin && response.headers.get('content-type')?.includes('text/html'))await cache.put('/__app_shell__',response.clone())
        return response
      })
      // Prefer current HTML online so it never points to chunks removed by a
      // deployment. The saved shell remains available when the network fails.
      try {return await fresh} catch(error){if(cached)return cached;throw error}
    })())
  }else if(url.pathname.startsWith('/assets/')){
    event.respondWith((async()=>{
      const cache=await caches.open('training-agent-shell-v3'),cached=await cache.match(event.request)
      if(cached)return cached
      const response=await fetch(event.request)
      if(response.ok)event.waitUntil(cache.put(event.request,response.clone()))
      return response
    })())
  }
})
