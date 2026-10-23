import {firebase} from './firebase.js';
import {canRead,retryDelay,alertKey,httpError} from './domain.js';
const iso=()=>new Date().toISOString();
function requireJobAuth(req){const secret=process.env.CRON_SECRET;const presented=req.get('authorization');if(!secret||secret.length<24||presented!==`Bearer ${secret}`)throw httpError('JOB_UNAUTHORIZED',401)}
async function pushAlert(db,messaging,job){
 const alert=await db.collection('alerts').doc(job.payload.alertId).get();if(!alert.exists)return;
 const users=(await db.collection('users').where('status','==','ACTIVE').limit(500).get()).docs;
 const eligible=new Set(users.filter(d=>canRead({...d.data(),uid:d.id},job.deviceId)).map(d=>d.id));
 if(!eligible.size)return;
 const tokens=(await db.collection('notificationTokens').where('active','==',true).limit(1000).get()).docs.filter(d=>eligible.has(d.data().uid));
 for(let i=0;i<tokens.length;i+=500){const group=tokens.slice(i,i+500);if(!group.length)continue;
  const result=await messaging.sendEachForMulticast({tokens:group.map(t=>t.data().token),notification:{title:'BlueWatch alert',body:`${alert.data().type} on ${job.deviceId}`},data:{alertId:alert.id,deviceId:job.deviceId,type:alert.data().type}});
  for(let j=0;j<result.responses.length;j++){const entry=result.responses[j];const code=entry.error?.code;
   if(!entry.success&&['messaging/invalid-registration-token','messaging/registration-token-not-registered'].includes(code))await group[j].ref.update({active:false,updatedAt:iso()});
   else if(!entry.success)throw entry.error;
  }
 }
}
async function sendRealtime(job){if(process.env.PUSHER_ENABLED!=='true')return;
 const {default:Pusher}=await import('pusher');const p=new Pusher({appId:process.env.PUSHER_APP_ID,key:process.env.PUSHER_KEY,secret:process.env.PUSHER_SECRET,cluster:process.env.PUSHER_CLUSTER});
 const channel=job.type==='alert.acknowledged'?`private-user-${job.payload.uid}`:`private-device-${job.deviceId}`;
 await p.trigger(channel,job.type,job.payload);
}
async function dispatchOne(db,messaging,ref){let job;const lease=new Date(Date.now()+90000).toISOString();
 await db.runTransaction(async tx=>{const d=await tx.get(ref);if(!d.exists)return;const v=d.data();if(v.status==='SENT'||v.status==='FAILED'||v.nextAttemptAt>iso()||v.status==='CLAIMED'&&v.leaseUntil>iso())return;job=v;tx.update(ref,{status:'CLAIMED',leaseUntil:lease,attempts:v.attempts+1})});if(!job)return false;
 try{await sendRealtime(job);if(job.type==='alert.created'&&process.env.FCM_ENABLED==='true')await pushAlert(db,messaging,job);await ref.update({status:'SENT',sentAt:iso(),leaseUntil:null});}
 catch(e){const permanent=job.attempts>=5;await ref.update({status:permanent?'FAILED':'PENDING',lastError:String(e.code??'DELIVERY_FAILED').slice(0,90),nextAttemptAt:new Date(Date.now()+retryDelay(job.attempts+1)).toISOString(),leaseUntil:null});}
 return true;
}
export async function dispatch(req,res){requireJobAuth(req);const {db,messaging}=firebase();const limit=Math.min(50,Math.max(1,Number(process.env.MAX_WORKER_JOBS)||20));
 const candidates=(await db.collection('notificationOutbox').where('status','==','PENDING').limit(limit).get()).docs;
 const recovered=(await db.collection('notificationOutbox').where('status','==','CLAIMED').limit(limit).get()).docs.filter(d=>d.data().leaseUntil<iso());
 let handled=0;for(const d of [...candidates,...recovered].slice(0,limit)){if(await dispatchOne(db,messaging,d.ref))handled++};res.json({processed:handled,scanned:candidates.length+recovered.length});
}
export async function offlineSweep(req,res){requireJobAuth(req);const db=firebase().db;const age=(Number(process.env.OFFLINE_MINUTES)||60)*60000;const devices=(await db.collection('devices').where('status','==','ACTIVE').limit(1000).get()).docs;let marked=0,recovered=0;
 for(const doc of devices){const last=doc.data().lastSeenAt??doc.data().registeredAt;const offline=!!last&&new Date(last).getTime()<Date.now()-age;const ref=db.collection('alerts').doc(alertKey('OFFLINE',doc.id,'ACTIVE'));
  await db.runTransaction(async tx=>{const existing=await tx.get(ref);if(offline&&!existing.exists){tx.create(ref,{deviceId:doc.id,type:'OFFLINE',severity:'HIGH',status:'OPEN',createdAt:iso()});tx.create(db.collection('notificationOutbox').doc(alertKey('alert.created',doc.id,ref.id)),{type:'alert.created',deviceId:doc.id,payload:{deviceId:doc.id,alertId:ref.id,type:'OFFLINE'},status:'PENDING',attempts:0,nextAttemptAt:iso(),createdAt:iso(),leaseUntil:null});marked++}
   else if(offline&&existing.exists&&existing.data().status==='RESOLVED'){tx.update(ref,{status:'OPEN',createdAt:iso(),resolvedAt:null});marked++}
   else if(!offline&&existing.exists&&['OPEN','ACKNOWLEDGED'].includes(existing.data().status)){tx.update(ref,{status:'RESOLVED',resolvedAt:iso()});recovered++}
  });
 }res.json({checked:devices.length,newOffline:marked,recovered});
}
