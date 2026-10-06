const DB_NAME = 'training-agent-device-v1'
export function deviceCacheScope() {
  try {return JSON.parse(localStorage.getItem('training-agent-startup-v2') || 'null')?.cache_scope || 'initial'}catch{return 'initial'}
}
let database: Promise<IDBDatabase | null> | undefined
function openDatabase() {
  if (!database) database = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let finished = false
    const timer = setTimeout(() => { finished = true; resolve(null) }, 1000)
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => { clearTimeout(timer); if(finished)request.result.close();else {finished=true;resolve(request.result)} }
    request.onerror = request.onblocked = () => { clearTimeout(timer);finished=true;resolve(null) }
  })
  return database
}
export async function readDeviceCache<T>(key: string, maxAgeMs = Infinity): Promise<T | null> {
  try {
    const db = await openDatabase()
    if (!db) return null
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 1000)
      const request = db.transaction('records').objectStore('records').get(key)
      request.onsuccess = () => {
        clearTimeout(timer)
        if(request.result && Date.now()-request.result.savedAt>=maxAgeMs){db.transaction('records','readwrite').objectStore('records').delete(key);resolve(null)}
        else resolve(request.result?.value ?? null)
      }
      request.onerror = () => { clearTimeout(timer);resolve(null) }
    })
  } catch { return null }
}
export async function writeDeviceCache(key: string, value: unknown) {
  try {
    const db = await openDatabase()
    if (!db) return
    await new Promise<void>(resolve => {
      const transaction = db.transaction('records', 'readwrite')
      const store = transaction.objectStore('records')
      store.put({value, savedAt: Date.now()}, key)
      // Bound cached chart views without expiring the useful startup snapshot.
      if (key.startsWith('activity:') || key.startsWith('nutrition:')) {
        const request = store.openCursor()
        const charts: {key: IDBValidKey; savedAt: number}[] = []
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) {
            const sameKind=String(cursor.key).startsWith(key.startsWith('activity:')?'activity:':'nutrition:')
            if(sameKind){
              if(key.startsWith('nutrition:') && Date.now()-cursor.value.savedAt>=15*60_000)cursor.delete()
              else charts.push({key:cursor.key,savedAt:cursor.value.savedAt})
            }
            cursor.continue()
          }
          else charts.sort((a,b)=>b.savedAt-a.savedAt).slice(key.startsWith('activity:')?40:14).forEach(row=>store.delete(row.key))
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
  } catch { /* Device cache failure must never block the app or a durable save. */ }
}
export async function clearDeviceCache() {
  window.dispatchEvent(new Event('device-cache-cleared'))
  try { const db=await openDatabase(); if(db)db.transaction('records','readwrite').objectStore('records').clear() } catch { /* Best effort. */ }
}
export async function deleteDeviceCachePrefix(prefix:string) {
  try {
    const db=await openDatabase();if(!db)return
    const store=db.transaction('records','readwrite').objectStore('records')
    const request=store.openCursor()
    request.onsuccess=()=>{const cursor=request.result;if(cursor){if(String(cursor.key).startsWith(prefix))cursor.delete();cursor.continue()}}
  }catch{/* Cache invalidation is best effort. */}
}
