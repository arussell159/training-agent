self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try {const response=await fetch('/');if(response.ok && new URL(response.url).origin===self.location.origin && response.headers.get('content-type')?.includes('text/html'))await (await caches.open('training-agent-shell-v2')).put('/__app_shell__',response)}catch{ /* Existing shell still works offline. */ }
    await self.skipWaiting()
  })())
})
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()))
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url)
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return
  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open('training-agent-shell-v2')
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
      const cache=await caches.open('training-agent-shell-v2'),cached=await cache.match(event.request)
      if(cached)return cached
      const response=await fetch(event.request)
      if(response.ok)event.waitUntil(cache.put(event.request,response.clone()))
      return response
    })())
  }
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title:"Daily workout review", body:event.data?.text() || "Your coaching review is ready." }
  }
  event.waitUntil(self.registration.showNotification(data.title || "Daily workout review", {
    body:data.body || "Your coaching review is ready.",
    tag:data.tag || "daily-workout-review",
    renotify:false,
    data:{ url:data.url || "/coach", reviewId:data.reviewId || null },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || "/coach", self.location.origin).href
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type:"window", includeUncontrolled:true })
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.navigate(targetUrl)
      return existing.focus()
    }
    return self.clients.openWindow(targetUrl)
  })())
})
