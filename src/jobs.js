import {firebase} from './firebase.js';
import {canRead,retryDelay,alertKey,httpError} from './domain.js';
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
   if(!user||user.status!=='ACTIVE'||!canRead(user,job.deviceId))continue;
   const receipt=ref.collection('fcmReceipts').doc(token.id);
   if((await receipt.get()).exists)continue;
   eligible.push({token,receipt});
  }
  if(eligible.length){
   const result=await messaging.sendEachForMulticast({
    tokens:eligible.map(x=>x.token.data().token),
    notification:{title:'BlueWatch alert',body:`${alert.data().type} on ${job.deviceId}`},
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
export async function dispatch(req,res){requireJobAuth(req);const {db,messaging}=firebase();const limit=Math.min(50,Math.max(1,Number(process.env.MAX_WORKER_JOBS)||20));
 const cutoff=iso();
 const candidates=(await db.collection('notificationOutbox').where('status','==','PENDING').where('nextAttemptAt','<=',cutoff).orderBy('nextAttemptAt','asc').limit(limit).get()).docs;
 const recovered=(await db.collection('notificationOutbox').where('status','==','CLAIMED').where('leaseUntil','<=',cutoff).orderBy('leaseUntil','asc').limit(limit).get()).docs;
 let handled=0;for(const d of [...candidates,...recovered].slice(0,limit)){if(await dispatchOne(db,messaging,d.ref))handled++};res.json({processed:handled,scanned:candidates.length+recovered.length});
}
export async function offlineSweep(req,res){requireJobAuth(req);const db=firebase().db;const age=(Number(process.env.OFFLINE_MINUTES)||60)*60000;const devices=(await db.collection('devices').where('status','==','ACTIVE').limit(1000).get()).docs;let marked=0,recovered=0;
 for(const doc of devices){const last=doc.data().lastSeenAt??doc.data().registeredAt;const offline=!!last&&new Date(last).getTime()<Date.now()-age;const ref=db.collection('alerts').doc(alertKey('OFFLINE',doc.id,'ACTIVE'));
  await db.runTransaction(async tx=>{const existing=await tx.get(ref);if(offline&&!existing.exists){tx.create(ref,{deviceId:doc.id,type:'OFFLINE',severity:'HIGH',status:'OPEN',createdAt:iso(),episode:0});tx.create(db.collection('notificationOutbox').doc(alertKey('alert.created',doc.id,ref.id)),{type:'alert.created',deviceId:doc.id,payload:{deviceId:doc.id,alertId:ref.id,type:'OFFLINE'},status:'PENDING',attempts:0,nextAttemptAt:iso(),createdAt:iso(),leaseUntil:null});marked++}
   else if(offline&&existing.exists&&existing.data().status==='RESOLVED'){
    const episode=(existing.data().episode??0)+1;
    tx.update(ref,{status:'OPEN',createdAt:iso(),resolvedAt:null,episode});
    tx.create(db.collection('notificationOutbox').doc(alertKey('alert.created',doc.id,ref.id+'_'+episode)),{type:'alert.created',deviceId:doc.id,payload:{deviceId:doc.id,alertId:ref.id,type:'OFFLINE'},status:'PENDING',attempts:0,nextAttemptAt:iso(),createdAt:iso(),leaseUntil:null});
    marked++;
   }
   else if(!offline&&existing.exists&&['OPEN','ACKNOWLEDGED'].includes(existing.data().status)){tx.update(ref,{status:'RESOLVED',resolvedAt:iso()});recovered++}
  });
 }res.json({checked:devices.length,newOffline:marked,recovered});
}
