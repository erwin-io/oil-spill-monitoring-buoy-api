// BlueGuard warm-instance response cache. Never a substitute for Firebase auth
// or ACL checks, and never shared between Vercel function instances.
const DEFAULT_MAX_ENTRIES=400;
const DEFAULT_MAX_BYTES=8*1024*1024;
const DEFAULT_ENTRY_BYTES=256*1024;
const cacheHeader='X-BlueGuard-Cache';
const timing=(res,kind,started)=>{
 const existing=res.get?.('Server-Timing');
 res.set('Server-Timing',[existing,`cache;desc="${kind}";dur=${Date.now()-started}`].filter(Boolean).join(', '));
};
const queryString=query=>{
 const entries=Object.entries(query??{}).sort(([a],[b])=>a.localeCompare(b));
 return JSON.stringify(entries);
};

export function createReadCache({now=Date.now,maxEntries=DEFAULT_MAX_ENTRIES,
 maxBytes=DEFAULT_MAX_BYTES,maxEntryBytes=DEFAULT_ENTRY_BYTES}={}){
 const records=new Map();
 let bytes=0,epoch=0;
 const remove=key=>{
  const item=records.get(key);
  if(!item)return;
  bytes-=item.size;
  records.delete(key);
 };
 const evict=()=>{
  while(records.size>maxEntries||bytes>maxBytes){
   const key=records.keys().next().value;
   if(key===undefined)break;
   remove(key);
  }
 };
 const hit=key=>{
  const entry=records.get(key);
  if(!entry)return null;
  if(entry.expiresAt<=now()){remove(key);return null;}
  records.delete(key);records.set(key,entry); // LRU
  return entry;
 };
 const put=(key,body,tags,ttlMs,deviceIds=[])=>{
  if(typeof body!=='string')return;
  const size=Buffer.byteLength(body,'utf8');
  if(size>maxEntryBytes||size>maxBytes||!Number.isFinite(ttlMs)||ttlMs<=0)return;
  remove(key);
  records.set(key,{body,size,tags:new Set(tags),deviceIds:[...deviceIds],expiresAt:now()+ttlMs});
  bytes+=size;evict();
 };
 const invalidate=tags=>{
  const selected=new Set(tags.filter(Boolean));
  // Epoch also rejects a response that began before an in-flight mutation.
  epoch++;
  if(!selected.size)return 0;
  let removed=0;
  for(const [key,entry] of records){
   if([...selected].some(tag=>entry.tags.has(tag))){remove(key);removed++;}
  }
  return removed;
 };
 const clear=()=>{epoch++;records.clear();bytes=0;};
 const cache=(scope,ttlMs,handler,validateHit)=>async(req,res)=>{
  const started=Date.now();
  // All protected routes must run userAuth and (where required) deviceScope
  // BEFORE this function. Unknown principals never enter the cache.
  // Emulator integration tests directly create/update Firestore fixtures,
  // bypassing the API's mutation hooks. Keep those tests uncached by default.
  // Production instances cache unless explicitly disabled by configuration.
  const emulator=Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if(process.env.BLUEGUARD_NODE_CACHE_ENABLED==='false'||
     (emulator&&process.env.BLUEGUARD_NODE_CACHE_ENABLED!=='true')||
     !req.user?.uid||req.method!=='GET')return handler(req,res);
  const query=queryString(req.query);
  if(query.length>2048)return handler(req,res);
  const key=JSON.stringify([req.user.uid,req.user.role,scope,req.path,query]);
  // A real Pusher change or explicit user pull-to-refresh must obtain fresh
  // Firestore data even if Vercel routed it to a different warm instance.
  const forceRefresh=req.get?.('x-blueguard-cache-refresh')==='true';
  if(forceRefresh)remove(key);
  const existing=forceRefresh?null:hit(key);
  const hitEpoch=epoch;
  res.set('Cache-Control','private, no-store');
  if(existing){
   // Never bypass a current device-ownership/share check on a warm hit.
   // Expensive alert/count queries are skipped, while the ACL is current.
   const allowed=!validateHit||await validateHit(req,JSON.parse(existing.body),existing.deviceIds);
   // If a mutation completed while ACL revalidation awaited Firestore,
   // do not serve an entry that the writer just invalidated.
   if(allowed&&hitEpoch===epoch&&records.get(key)===existing){
    res.set(cacheHeader,'HIT');
    timing(res,'HIT',started);
    return res.type('json').send(existing.body);
   }
   if(records.get(key)===existing)remove(key);
  }
  res.set(cacheHeader,'MISS');
  const openedAt=epoch;
  const json=res.json.bind(res);
  res.json=function(payload){
   if(res.statusCode===200&&epoch===openedAt&&!res.headersSent){
    try{
     const body=JSON.stringify(payload);
     const tags=['user:'+req.user.uid,'scope:'+scope];
     if(scope==='alerts'||scope==='alert-detail')tags.push('alerts-user:'+req.user.uid);
     if(req.params?.deviceId)tags.push('device:'+req.params.deviceId);
     if(payload&&typeof payload.deviceId==='string')tags.push('device:'+payload.deviceId);
     for(const id of req.cacheDeviceIds??[])if(typeof id==='string')tags.push('device:'+id);
     // An alert details response includes its buoy ID.
     put(key,body,tags,ttlMs,req.cacheDeviceIds);
    }catch{ /* Never fail a response because serialization/cache insertion fails. */ }
   }
   timing(res,'MISS',started);
   return json(payload);
  };
  return handler(req,res);
 };
 const invalidateAfter=(getTags,handler)=>async(req,res)=>{
  const json=res.json.bind(res);
  res.json=function(payload){
   if(res.statusCode>=200&&res.statusCode<300&&!res.headersSent){
    try{
     const tags=typeof getTags==='function'?getTags(req,payload):getTags;
     invalidate(Array.isArray(tags)?tags:[]);
    }catch{
     // Invalidating everything is safer than accidentally serving stale data.
     clear();
    }
   }
   return json(payload);
  };
  return handler(req,res);
 };
 return {cache,invalidate,invalidateAfter,clear,
  stats:()=>({entries:records.size,bytes,epoch}),
  // Test-only observability; not exposed as an HTTP endpoint.
  peek:key=>hit(key)};
}
export const readCache=createReadCache();
export const cached=(scope,ttlMs,handler,validateHit)=>readCache.cache(scope,ttlMs,handler,validateHit);
export const invalidating=(getTags,handler)=>readCache.invalidateAfter(getTags,handler);
export const invalidateCacheTags=(...tags)=>readCache.invalidate(tags);
