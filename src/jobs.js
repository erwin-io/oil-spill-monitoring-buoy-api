import {firebase} from './firebase.js';
import {canRead,retryDelay,alertKey,httpError} from './domain.js';
import {accessLevel} from './access.js';
const iso=()=>new Date().toISOString();
function requireJobAuth(req){const secret=process.env.CRON_SECRET;const presented=req.get('authorization');if(!secret||secret.length<24||presented!==`Bearer ${secret}`)throw httpError('JOB_UNAUTHORIZED',401)}
/**
 * Paginate tokens instead of truncating notifications at the first 1,000.
 * Scope EVERY recipient against their current ACTIVE profile. FCM receipts
 * prevent repeating already-confirmed deliveries on ordinary job retries.
 * They cannot guarantee exactly-once delivery across a process crash between
 * the FCM send and the receipt write.
 */
export async function pushAlert(db,messaging,job,ref){
 const alert=await db.collection('alerts').doc(job.payload.alertId).get();
 if(!alert.exists)return;
 const userCache=new Map();
 let cursor=null;
 let firstFailure=null;
 do {
  let query=db.collection('notificationTokens').where('active','==',true).limit(250);
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get();
  if(page.empty)break;
  const eligible=[];
  for(const token of page.docs){
   const value=token.data(), uid=value.uid;
   if(typeof uid!=='string'||!value.token)continue;
   if(!userCache.has(uid)){
    const user=await db.collection('users').doc(uid).get();
    userCache.set(uid,user.exists?{...user.data(),uid}:null);
   }
   const user=userCache.get(uid);
   if(!user||user.status!=='ACTIVE'||await accessLevel(db,user,job.deviceId)==='NONE')continue;
   const receipt=ref.collection('fcmReceipts').doc(token.id);
   if((await receipt.get()).exists)continue;
   eligible.push({token,receipt});
  }
  if(eligible.length){
   const result=await messaging.sendEachForMulticast({
    tokens:eligible.map(x=>x.token.data().token),
    notification:{title:process.env.FIRESTORE_EMULATOR_HOST&&job.deviceId.startsWith('sim_')?'SIMULATION ONLY - Oil Spill Buoy':'Oil Spill Monitoring Buoy alert',body:`${alert.data().type} on ${job.deviceId}`},
    data:{alertId:alert.id,deviceId:job.deviceId,type:alert.data().type},
   });
   for(let i=0;i<eligible.length;i++){
    const entry=result.responses[i], {token,receipt}=eligible[i];
    if(entry.success){
     await receipt.set({status:'SENT',sentAt:iso()});
    }else if(['messaging/invalid-registration-token','messaging/registration-token-not-registered'].includes(entry.error?.code)){
     await token.ref.update({active:false,updatedAt:iso()});
     await receipt.set({status:'INVALID_TOKEN',checkedAt:iso()});
    }else firstFailure??=entry.error??new Error('FCM_DELIVERY_FAILED');
   }
  }
  cursor=page.docs.at(-1);
  if(page.size<250)break;
 }while(cursor);
 if(firstFailure)throw firstFailure;
}
async function sendRealtime(job){if(process.env.PUSHER_ENABLED!=='true')return;
 const {default:Pusher}=await import('pusher');const p=new Pusher({appId:process.env.PUSHER_APP_ID,key:process.env.PUSHER_KEY,secret:process.env.PUSHER_SECRET,cluster:process.env.PUSHER_CLUSTER});
 const channel=job.type==='alert.acknowledged'?`private-user-${job.payload.uid}`:`private-device-${job.deviceId}`;
 await p.trigger(channel,job.type,job.payload);
}
async function dispatchOne(db,messaging,ref){let job;const lease=new Date(Date.now()+90000).toISOString();
 await db.runTransaction(async tx=>{const d=await tx.get(ref);if(!d.exists)return;const v=d.data();
  if(v.status==='SENT'||v.status==='FAILED'||(v.nextAttemptAt&&v.nextAttemptAt>iso())||(v.status==='CLAIMED'&&v.leaseUntil>iso()))return;
  job={...v,attempts:(v.attempts??0)+1};
  tx.update(ref,{status:'CLAIMED',leaseUntil:lease,attempts:job.attempts});
 });if(!job)return false;
 try{
  if(!job.realtimeDelivered){
   await sendRealtime(job);
   // Best-effort Pusher checkpoint: duplicates remain possible in the crash window.
   await ref.update({realtimeDelivered:true});
  }
  if(job.type==='alert.created'&&process.env.FCM_ENABLED==='true')await pushAlert(db,messaging,job,ref);
  await ref.update({status:'SENT',sentAt:iso(),leaseUntil:null});
 }
 catch(e){const permanent=job.attempts>=5;await ref.update({status:permanent?'FAILED':'PENDING',lastError:String(e.code??'DELIVERY_FAILED').slice(0,90),nextAttemptAt:new Date(Date.now()+retryDelay(job.attempts)).toISOString(),leaseUntil:null});}
 return true;
}
/**
 * No-cost alternative to Firestore's billable TTL deletes.
 * Called only by the existing CRON_SECRET-protected dispatcher; bounded
 * and idempotent, and never scans live sensor measurements.
 */
export async function pruneRateLimitWindows(db,limit=100){
 const page=await db.collection('_rateLimitWindows')
  .where('expiresAt','<=',new Date()).orderBy('expiresAt','asc')
  .limit(Math.min(200,Math.max(1,limit))).get();
 if(page.empty)return 0;
 const batch=db.batch();
 for(const doc of page.docs)batch.delete(doc.ref);
 await batch.commit();
 return page.size;
}
export async function dispatch(req,res){requireJobAuth(req);const {db,messaging}=firebase();const limit=Math.min(50,Math.max(1,Number(process.env.MAX_WORKER_JOBS)||20));
 const cutoff=iso();
 const candidates=(await db.collection('notificationOutbox').where('status','==','PENDING').where('nextAttemptAt','<=',cutoff).orderBy('nextAttemptAt','asc').limit(limit).get()).docs;
 const recovered=(await db.collection('notificationOutbox').where('status','==','CLAIMED').where('leaseUntil','<=',cutoff).orderBy('leaseUntil','asc').limit(limit).get()).docs;
 let handled=0;for(const d of [...candidates,...recovered].slice(0,limit)){if(await dispatchOne(db,messaging,d.ref))handled++};const prunedRateWindows=await pruneRateLimitWindows(db);res.json({processed:handled,scanned:candidates.length+recovered.length,prunedRateWindows});
}
/**
 * Scan an ordered, resumable page of ACTIVE buoys each tick. The previous
 * first-1000-only scan could permanently starve later document IDs.
 * Checkpoint only after all page mutations have committed. Reprocessing a page
 * after a crash is safe because alert/episode state is transactional.
 * Concurrent ticks may scan the same page; alert IDs prevent duplicate alerts.
 */
export async function offlineSweep(req,res){
 requireJobAuth(req);
 const db=firebase().db;
 const age=(Number(process.env.OFFLINE_MINUTES)||60)*60000;
 const configured=Number(process.env.MAX_OFFLINE_SWEEP_DEVICES);
 const pageSize=Number.isInteger(configured)&&configured>=1?Math.min(configured,1000):1000;
 const progressRef=db.collection('_workerState').doc('offlineSweep');
 const state=await progressRef.get();
 const cursor=state.exists?state.data()?.lastDeviceId:null;
 const base=db.collection('devices').where('status','==','ACTIVE').orderBy('__name__').limit(pageSize);
 let page=await (cursor?base.startAfter(cursor):base).get();
 // A page at the tail may be empty after device deactivation/removal.
 if(page.empty&&cursor)page=await base.get();
 let marked=0,recovered=0;
 for(const doc of page.docs){
  const last=doc.data().lastSeenAt??doc.data().registeredAt;
  const offline=!!last&&new Date(last).getTime()<Date.now()-age;
  const ref=db.collection('alerts').doc(alertKey('OFFLINE',doc.id,'ACTIVE'));
  const outcome=await db.runTransaction(async tx=>{
   const existing=await tx.get(ref);
   if(offline&&!existing.exists){
    tx.create(ref,{deviceId:doc.id,type:'OFFLINE',severity:'HIGH',status:'OPEN',createdAt:iso(),episode:0});
    tx.create(db.collection('notificationOutbox').doc(alertKey('alert.created',doc.id,ref.id)),{
     type:'alert.created',deviceId:doc.id,payload:{deviceId:doc.id,alertId:ref.id,type:'OFFLINE'},
     status:'PENDING',attempts:0,nextAttemptAt:iso(),createdAt:iso(),leaseUntil:null
    });
    return 'marked';
   }
   if(offline&&existing.exists&&existing.data().status==='RESOLVED'){
    const episode=(existing.data().episode??0)+1;
    tx.update(ref,{status:'OPEN',createdAt:iso(),resolvedAt:null,episode});
    tx.create(db.collection('notificationOutbox').doc(alertKey('alert.created',doc.id,ref.id+'_'+episode)),{
     type:'alert.created',deviceId:doc.id,payload:{deviceId:doc.id,alertId:ref.id,type:'OFFLINE'},
     status:'PENDING',attempts:0,nextAttemptAt:iso(),createdAt:iso(),leaseUntil:null
    });
    return 'marked';
   }
   if(!offline&&existing.exists&&['OPEN','ACKNOWLEDGED'].includes(existing.data().status)){
    tx.update(ref,{status:'RESOLVED',resolvedAt:iso()});
    return 'recovered';
   }
   return null;
  });
  if(outcome==='marked')marked++;
  if(outcome==='recovered')recovered++;
 }
 // An undersized page completes a pass. The next tick starts at the beginning.
 const nextCursor=page.size===pageSize?page.docs.at(-1)?.id:null;
 await progressRef.set({lastDeviceId:nextCursor??null,updatedAt:iso()},{merge:true});
 res.json({checked:page.size,newOffline:marked,recovered,morePages:!!nextCursor});
}
