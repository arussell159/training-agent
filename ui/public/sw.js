self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title:"Today’s workout review", body:event.data?.text() || "Your coaching review is ready." }
  }
  event.waitUntil(self.registration.showNotification(data.title || "Today’s workout review", {
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
