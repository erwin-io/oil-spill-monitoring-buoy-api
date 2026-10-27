import {createHash} from 'node:crypto';

// A single in-flight revocation check can serve concurrent requests bearing
// exactly the same JWT. This is NOT a persistent authentication cache:
// after verification (or failure) resolves, the entry is discarded and the
// next request performs a new verifyIdToken(..., true) + user status lookup.
export function createAuthSingleFlight(){
 const inflight=new Map();
 const verify=(token,work)=>{
  const key=createHash('sha256').update(token).digest('hex');
  if(inflight.has(key))return inflight.get(key);
  const pending=Promise.resolve().then(work);
  inflight.set(key,pending);
  // Removal on both success and failure without creating a rejected,
  // unobserved finally() promise.
  void pending.then(
   ()=>{if(inflight.get(key)===pending)inflight.delete(key)},
   ()=>{if(inflight.get(key)===pending)inflight.delete(key)}
  );
  return pending;
 };
 return {verify,active:()=>inflight.size};
}
export const authSingleFlight=createAuthSingleFlight();
