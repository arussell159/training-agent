/** Bounded, account-scoped read cache. Writes invalidate before and after completion. */
export function createRequestCache({ttl=60000,maxEntries=100,now=Date.now}={}){
 const entries=new Map();let generation=0;
 return {
  clear(){generation++;entries.clear()},
  wrap(request,account){return async (path,options={})=>{
   if((options.method || 'GET').toUpperCase()!=='GET'){
    generation++;entries.clear();try{return await request(path,options)}finally{generation++;entries.clear()}
   }
   const key=account+'\0'+path,cached=entries.get(key);
   if(cached&&now()-cached.time<ttl)return structuredClone(await cached.promise);
   const epoch=generation,entry={time:now(),promise:null};
   entry.promise=Promise.resolve().then(()=>request(path,options)).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error});
   entries.delete(key);if(entries.size>=maxEntries)entries.delete(entries.keys().next().value);
   if(epoch===generation)entries.set(key,entry);
   return structuredClone(await entry.promise);
  }}
 }
}
