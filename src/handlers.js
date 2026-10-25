import {createHash} from 'node:crypto';
import {firebase} from './firebase.js';
import {CONFIG_DEFAULT,makeKey,keyHash,canRead,canOperate,httpError,parseTime,latestWins,alertKey,configNext,tokenId,healthAlerts} from './domain.js';
import {validate,measurement,health,newDevice,editDevice,editConfig,pushToken,deviceId,profileEdit} from './schemas.js';
import {reissueClaimCode,startPairing,requestClaim,confirmPairing,pairingStatus} from './pairing.js';
import {accessibleDeviceIds,accessLevel,requireAccess} from './access.js';
import {requirePushSession,isEligiblePushSession} from './push-sessions.js';
import {inviteViewer,myInvitations,acceptInvitation,revokeViewer} from './sharing.js';
const now=()=>new Date().toISOString();
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(stable(x)).digest('hex');
const maxPage=(n,def=30)=>Math.min(100,Math.max(1,Number.isInteger(Number(n))?Number(n):def));
const clean=d=>({id:d.id,...d.data()});
const safeDevice=d=>{const {keyHash:_,ownerUid:__,...rest}=d;return rest};
const parseQuery=(req)=>({limit:maxPage(req.query.limit),startAfter:req.query.cursor});
async function listPage(collection,req,sort='measuredAt'){
 const {limit,startAfter}=parseQuery(req);
 let q=collection.orderBy(sort,'desc').limit(limit+1);
 if(startAfter){const c=await collection.doc(startAfter).get();if(!c.exists)throw httpError('INVALID_CURSOR',400);q=q.startAfter(c)}
 const result=await q.get();const docs=result.docs.slice(0,limit);
 return {items:docs.map(clean),nextCursor:result.docs.length>limit?docs.at(-1)?.id:null};
}
async function recordAlert(tx,db,alert){
 const ref=db.collection('alerts').doc(alert.id);
 if(!(await tx.get(ref)).exists){tx.create(ref,{...alert,status:'OPEN',createdAt:now()});enqueue(tx,db,'alert.created',alert.deviceId,alert.id,{alertId:alert.id,deviceId:alert.deviceId,type:alert.type,severity:alert.severity})}
}
function enqueue(tx,db,type,deviceId,eventId,payload){
 const id=alertKey(type,deviceId,eventId);
 tx.set(db.collection('notificationOutbox').doc(id),{type,deviceId,payload,status:'PENDING',attempts:0,nextAttemptAt:now(),createdAt:now(),leaseUntil:null},{merge:false});
}
export async function bootstrap(req,res){
 const match=/^Bearer (\S+)$/i.exec(req.get('authorization')??'');if(!match)throw httpError('AUTH_REQUIRED',401);
 const {auth,db}=firebase();const id=await auth.verifyIdToken(match[1],true);
 if(!id.email||!id.email_verified)throw httpError('EMAIL_NOT_VERIFIED',403);
 if(!['google.com','password'].includes(id.firebase?.sign_in_provider))throw httpError('PROVIDER_NOT_ALLOWED',403);
 const ref=db.collection('users').doc(id.uid);
 await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists){tx.create(ref,{email:id.email,displayName:id.name??id.email.split('@')[0],role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[],createdAt:now()})}else if(snap.data().status!=='ACTIVE'){throw httpError('ACCOUNT_DISABLED',403)}});
 const p=(await ref.get()).data(),accessible=await accessibleDeviceIds(db,{...p,uid:id.uid});
 res.json({uid:id.uid,email:p.email,displayName:p.displayName,role:p.role,status:p.status,avatarUrl:p.avatarUrl??null,allowedDeviceIds:accessible,accessibleDeviceIds:accessible});
}
export async function me(req,res){const {uid,role,status,email,displayName}=req.user,accessible=await accessibleDeviceIds(firebase().db,req.user);res.json({uid,role,status,email,displayName,avatarUrl:req.user.avatarUrl??null,allowedDeviceIds:accessible,accessibleDeviceIds:accessible})}
export async function updateOwnProfile(req,res){
 const {displayName}=validate(profileEdit,req.body);
 const db=firebase().db,ref=db.collection('users').doc(req.user.uid);
 await db.runTransaction(async tx=>{
  const profile=await tx.get(ref);
  if(!profile.exists||profile.data().status!=='ACTIVE')throw httpError('ACCOUNT_DISABLED',403);
  tx.update(ref,{displayName,profileUpdatedAt:now()});
 });
 const profile=await ref.get();
 const allowedDeviceIds=await accessibleDeviceIds(db,{...profile.data(),uid:req.user.uid});
 res.json({uid:req.user.uid,email:profile.data().email,role:profile.data().role,status:profile.data().status,
  displayName:profile.data().displayName,avatarUrl:profile.data().avatarUrl??null,allowedDeviceIds,accessibleDeviceIds:allowedDeviceIds});
}
export async function listDevices(req,res){
 const db=firebase().db,limit=maxPage(req.query.limit,100);
 const ids=(await accessibleDeviceIds(db,req.user)).sort();
 const after=req.query.cursor;
 if(after!==undefined&&(typeof after!=='string'||!ids.includes(after)))
  throw httpError('INVALID_CURSOR',400);
 const start=after===undefined?0:ids.indexOf(after)+1;
 const pageIds=ids.slice(start,start+limit),remaining=ids.length>start+pageIds.length;
 const docs=await Promise.all(pageIds.map(id=>db.collection('devices').doc(id).get()));
 const visible=docs.filter(d=>d.exists);
 res.json({items:await Promise.all(visible.map(async d=>({...safeDevice(clean(d)),access:await accessLevel(db,req.user,d.id)}))),
  nextCursor:remaining?pageIds.at(-1):null});
}
export async function getDevice(req,res){const db=firebase().db,doc=await db.collection('devices').doc(req.params.deviceId).get();if(!doc.exists)throw httpError('NOT_FOUND',404);res.json({...safeDevice(clean(doc)),access:await accessLevel(db,req.user,doc.id)})}
export async function registerDevice(req,res){const input=validate(newDevice,req.body);const {db}=firebase();const id=input.deviceId;
 const secret=makeKey(),claimCode=makeKey();const pepper=process.env.DEVICE_KEY_PEPPER;const hash=keyHash(secret,pepper);
 await db.runTransaction(async tx=>{const ref=db.collection('devices').doc(id),cref=db.collection('deviceCredentials').doc(id);if((await tx.get(ref)).exists)throw httpError('DEVICE_EXISTS',409);
 tx.create(ref,{...input,status:'ACTIVE',registeredAt:now(),lastSeenAt:null,lastMeasurementAt:null,latestClassification:null,confidence:null});
 tx.create(cref,{keyHash:hash,claimCodeHash:keyHash('claim:v1:'+claimCode,pepper),claimCodeVersion:1,enabled:true,rotatedAt:now()});
 tx.create(ref.collection('config').doc('current'),{...CONFIG_DEFAULT,configVersion:1,updatedAt:now()});
 });res.status(201).json({deviceId:id,deviceKey:secret,claimCode,warning:'Store the upload key outside the QR; place only the device ID and claim code inside the protected internal QR. Neither secret is shown again.'});
}
export {reissueClaimCode,startPairing,requestClaim,confirmPairing,pairingStatus};
export {inviteViewer,myInvitations,acceptInvitation,revokeViewer};
export async function updateDevice(req,res){
 const p=validate(editDevice,req.body);const {db}=firebase(),id=req.params.deviceId;
 const ref=db.collection('devices').doc(id),credential=db.collection('deviceCredentials').doc(id);
 await db.runTransaction(async tx=>{
  const [device,cred]=await Promise.all([tx.get(ref),p.status?tx.get(credential):Promise.resolve(null)]);
  if(!device.exists)throw httpError('NOT_FOUND',404);
  if(device.data().ownerUid)throw httpError('DEVICE_OWNED',403);
  if(p.status&&!cred.exists)throw httpError('DEVICE_CREDENTIALS_MISSING',409);
  tx.update(ref,{...p,updatedAt:now()});
  if(p.status)tx.update(credential,{enabled:p.status==='ACTIVE'});
 });
 res.json({deviceId:id,...p});
}
export async function rotateKey(req,res){
 const db=firebase().db,id=req.params.deviceId,secret=makeKey();
 const ref=db.collection('deviceCredentials').doc(id),device=db.collection('devices').doc(id);
 await db.runTransaction(async tx=>{
  const [dev,cred]=await Promise.all([tx.get(device),tx.get(ref)]);
  if(!dev.exists||!cred.exists)throw httpError('NOT_FOUND',404);
  if(dev.data().ownerUid)throw httpError('DEVICE_OWNED',403);
  tx.update(ref,{keyHash:keyHash(secret,process.env.DEVICE_KEY_PEPPER),rotatedAt:now(),enabled:dev.data().status==='ACTIVE'});
 });
 res.json({deviceId:id,deviceKey:secret,warning:'Old key is immediately revoked; store the new key securely.'});
}
export async function ingestMeasurement(req,res){const m=validate(measurement,req.body);const db=firebase().db;const devId=req.deviceId;
 const measured=parseTime(m.measuredAt);if(measured>Date.now()+10*60*1000||measured<Date.now()-365*86400000)throw httpError('TIMESTAMP_OUT_OF_RANGE',422);
 const ref=db.collection('devices').doc(devId),sample=ref.collection('measurements').doc(m.measurementId);let replay=false;
 await db.runTransaction(async tx=>{
  const activeOil=db.collection('alerts').doc(alertKey('PETROLEUM',devId,'ACTIVE'));
  const maintenanceRef=db.collection('alerts').doc(alertKey('MEASUREMENT_CELL_MAINTENANCE',devId,'ACTIVE'));
  const [existing,dev,conf,oilAlert,maintenanceAlert]=await Promise.all([
   tx.get(sample),tx.get(ref),tx.get(ref.collection('config').doc('current')),tx.get(activeOil),tx.get(maintenanceRef)
  ]);
  if(existing.exists){const x=existing.data();if(x.payloadDigest!==digest(m))throw httpError('MEASUREMENT_CONFLICT',409);replay=true;return}
  if(!dev.exists||dev.data().status!=='ACTIVE')throw httpError('DEVICE_DISABLED',403);
  tx.create(sample,{...m,deviceId:devId,receivedAt:now(),payloadDigest:digest(m),source:'RAW_SEAWATER'});
  if(latestWins(dev.data(),m.measuredAt))tx.update(ref,{lastMeasurementAt:m.measuredAt,lastSeenAt:now(),latestClassification:m.classification,confidence:m.confidence,batteryPercent:m.batteryPercent??null,signalStrengthDbm:m.signalStrengthDbm??null,totalFluorescence:m.totalFluorescence,cellStatus:m.cellStatus??null,firmwareVersion:m.firmwareVersion??null,modelVersion:m.modelVersion??null,latestMeasurementId:m.measurementId});
  else tx.update(ref,{lastSeenAt:now()});
  const threshold=conf.exists?(conf.data().oilConfidenceThreshold??CONFIG_DEFAULT.oilConfidenceThreshold):CONFIG_DEFAULT.oilConfidenceThreshold;
  if(latestWins(dev.data(),m.measuredAt)&&m.classification==='PETROLEUM'&&m.confidence>=threshold&&(!oilAlert.exists||oilAlert.data().status==='RESOLVED')){
   const episode=oilAlert.exists?(oilAlert.data().episode??0)+1:0;
   const alert={deviceId:devId,measurementId:m.measurementId,type:'PETROLEUM',severity:'CRITICAL',status:'OPEN',createdAt:now(),resolvedAt:null,episode};
   if(oilAlert.exists)tx.update(activeOil,alert);else tx.create(activeOil,alert);
   // Unique delivery job on each recurrence, while preserving the stable active alert ID.
   enqueue(tx,db,'alert.created',devId,activeOil.id+'_'+episode,{alertId:activeOil.id,deviceId:devId,type:'PETROLEUM',severity:'CRITICAL'});
  }else if(m.classification==='NORMAL'&&oilAlert.exists&&['OPEN','ACKNOWLEDGED'].includes(oilAlert.data().status)&&latestWins(dev.data(),m.measuredAt)){tx.update(activeOil,{status:'RESOLVED',resolvedAt:now()})}
  // Dedicated maintenance episodes for measurement telemetry are handled only for latest data.
  if(latestWins(dev.data(),m.measuredAt)&&m.cellStatus!==undefined){
   const maintenance=maintenanceAlert;
   if(m.cellStatus==='MAINTENANCE_REQUIRED'&&(!maintenance.exists||maintenance.data().status==='RESOLVED')){
    const episode=maintenance.exists?(maintenance.data().episode??0)+1:0;
    const value={deviceId:devId,measurementId:m.measurementId,type:'CELL_MAINTENANCE_REQUIRED',severity:'HIGH',status:'OPEN',createdAt:now(),resolvedAt:null,episode};
    if(maintenance.exists)tx.update(maintenanceRef,value);else tx.create(maintenanceRef,value);
    enqueue(tx,db,'alert.created',devId,maintenanceRef.id+'_'+episode,{alertId:maintenanceRef.id,deviceId:devId,type:'CELL_MAINTENANCE_REQUIRED',severity:'HIGH'});
   }else if(m.cellStatus!=='MAINTENANCE_REQUIRED'&&maintenance.exists&&['OPEN','ACKNOWLEDGED'].includes(maintenance.data().status)){
    tx.update(maintenanceRef,{status:'RESOLVED',resolvedAt:now()});
   }
  }
  enqueue(tx,db,'measurement.created',devId,m.measurementId,{deviceId:devId,measurementId:m.measurementId,classification:m.classification,confidence:m.confidence});
 });const stored=await sample.get();res.status(replay?200:201).json({accepted:true,duplicate:replay,deviceId:devId,measurementId:m.measurementId,receivedAt:stored.data()?.receivedAt});
}
export async function ingestHealth(req,res){
 const h=validate(health,req.body),db=firebase().db,d=db.collection('devices').doc(req.deviceId),ref=d.collection('health').doc(h.healthId);
 const payloadDigest=digest(h);let replay=false;
 await db.runTransaction(async tx=>{
  const [existing,dev,conf]=await Promise.all([tx.get(ref),tx.get(d),tx.get(d.collection('config').doc('current'))]);
  if(existing.exists){
   // Backward-compatible with historical health documents written before digests.
   if(existing.data().payloadDigest&&existing.data().payloadDigest!==payloadDigest)throw httpError('HEALTH_CONFLICT',409);
   replay=true;return;
  }
  if(!dev.exists||dev.data().status!=='ACTIVE')throw httpError('DEVICE_DISABLED',403);
  const latestHealth=!dev.data().lastHealthAt||
   latestWins({lastMeasurementAt:dev.data().lastHealthAt},h.measuredAt);
  const threshold=conf.exists?conf.data().lowBatteryThreshold??CONFIG_DEFAULT.lowBatteryThreshold:CONFIG_DEFAULT.lowBatteryThreshold;
  const issues=healthAlerts(h,threshold);
  const observed=[
   ...(h.batteryPercent!==undefined?['LOW_BATTERY']:[]),
   ...(h.sensor!==undefined?['SENSOR_FAULT']:[]),
   ...(h.cellStatus!==undefined?['CELL_MAINTENANCE_REQUIRED']:[]),
  ];
  // Read active states before any transaction writes (Firestore transaction requirement).
  const refs=observed.map(type=>db.collection('alerts').doc(alertKey(type,req.deviceId,'ACTIVE')));
  const states=latestHealth?await Promise.all(refs.map(ref=>tx.get(ref))):[];
  tx.create(ref,{...h,deviceId:req.deviceId,receivedAt:now(),payloadDigest});
  if(latestHealth){
   tx.update(d,{lastSeenAt:now(),lastHealthAt:h.measuredAt,batteryPercent:h.batteryPercent??dev.data().batteryPercent??null,signalStrengthDbm:h.signalStrengthDbm??dev.data().signalStrengthDbm??null,cellStatus:h.cellStatus??dev.data().cellStatus??null});
   for(let i=0;i<observed.length;i++){
    const type=observed[i],alertRef=refs[i],current=states[i],issue=issues.find(x=>x.type===type);
    if(issue&&(!current.exists||current.data().status==='RESOLVED')){
     const episode=current.exists?(current.data().episode??0)+1:0;
     const payload={deviceId:req.deviceId,healthId:h.healthId,type,severity:issue.severity,status:'OPEN',createdAt:now(),resolvedAt:null,episode};
     if(current.exists)tx.update(alertRef,payload);else tx.create(alertRef,payload);
     enqueue(tx,db,'alert.created',req.deviceId,alertRef.id+'_'+episode,{deviceId:req.deviceId,alertId:alertRef.id,type,severity:issue.severity});
    }else if(!issue&&current.exists&&['OPEN','ACKNOWLEDGED'].includes(current.data().status)){
     tx.update(alertRef,{status:'RESOLVED',resolvedAt:now()});
    }
   }
  }else{
   // Preserve historical telemetry but never create current alerts from stale uploads.
   tx.update(d,{lastSeenAt:now()});
  }
  enqueue(tx,db,'health.updated',req.deviceId,h.healthId,{deviceId:req.deviceId,healthId:h.healthId});
 });
 const stored=await ref.get();
 res.status(replay?200:201).json({accepted:true,duplicate:replay,healthId:h.healthId,receivedAt:stored.data()?.receivedAt});
}
export async function history(req,res){res.json(await listPage(firebase().db.collection('devices').doc(req.params.deviceId).collection('measurements'),req,'measuredAt'))}
export async function latest(req,res){const dev=await firebase().db.collection('devices').doc(req.params.deviceId).get();if(!dev.exists)throw httpError('NOT_FOUND',404);const id=dev.data().latestMeasurementId;if(!id)throw httpError('NO_MEASUREMENTS',404);const doc=await dev.ref.collection('measurements').doc(id).get();res.json(clean(doc))}
export async function healthHistory(req,res){res.json(await listPage(firebase().db.collection('devices').doc(req.params.deviceId).collection('health'),req,'measuredAt'))}
export async function deviceConfig(req,res){const doc=await firebase().db.collection('devices').doc(req.deviceId).collection('config').doc('current').get();if(!doc.exists)throw httpError('NOT_FOUND',404);res.json(doc.data())}
export async function userConfig(req,res){const doc=await firebase().db.collection('devices').doc(req.params.deviceId).collection('config').doc('current').get();if(!doc.exists)throw httpError('NOT_FOUND',404);res.json(doc.data())}
export async function putConfig(req,res){const input=validate(editConfig,req.body);const {configVersion,...changes}=input;const ref=firebase().db.collection('devices').doc(req.params.deviceId).collection('config').doc('current');let next;
 await firebase().db.runTransaction(async tx=>{const doc=await tx.get(ref);if(!doc.exists)throw httpError('NOT_FOUND',404);next={...configNext(doc.data(),configVersion,changes),updatedAt:now()};tx.set(ref,next)});res.json(next);
}
// Alert paging uses snapshot cursors (the last visible document ID), so ties
// on createdAt remain stable across pages without offset-based duplicates.
export async function alerts(req,res){
 const db=firebase().db;
 const allowed=await accessibleDeviceIds(db,req.user),allowedSet=new Set(allowed);
 if(allowed?.length===0)return res.json({items:[],nextCursor:null,openCount:0,unreadCount:0});
 const status=req.query.status;
 if(status!==undefined&&!['OPEN','ACKNOWLEDGED','RESOLVED'].includes(status))throw httpError('INVALID_ALERT_STATUS',422);
 const limit=maxPage(req.query.limit),cursorId=req.query.cursor;
 let cursor=null;
 if(cursorId!==undefined){
  if(typeof cursorId!=='string'||!/^[A-Za-z0-9_-]{1,500}$/.test(cursorId))throw httpError('INVALID_CURSOR',400);
  cursor=await db.collection('alerts').doc(cursorId).get();
  if(!cursor.exists||!allowedSet.has(cursor.data().deviceId)||status&&cursor.data().status!==status)throw httpError('INVALID_CURSOR',400);
 }
 const makeQuery=(deviceId)=>{
  let q=db.collection('alerts');
  if(deviceId!==null)q=q.where('deviceId','==',deviceId);
  if(status)q=q.where('status','==',status);
  q=q.orderBy('createdAt','desc').limit(limit+1);
  return cursor?q.startAfter(cursor):q;
 };
 // Fetch at most one page PER authorized buoy; merge globally in deterministic
 // createdAt/ID order. Unlike the previous 100-record cap, a scoped device with
 // old alerts can still appear even when unrelated buoys have recent alerts.
 const chunks=allowed;
 const pages=[];
 for(let i=0;i<chunks.length;i+=10){
  const batch=await Promise.all(chunks.slice(i,i+10).map(id=>makeQuery(id).get()));
  for(const result of batch)pages.push(...result.docs);
 }
 const items=pages.sort((a,b)=>b.data().createdAt.localeCompare(a.data().createdAt)||b.id.localeCompare(a.id)).slice(0,limit);
 const extra=pages.length>limit;
 const names=[...new Set(items.map(d=>d.data().deviceId))];
 const nameDocs=await Promise.all(names.map(id=>db.collection('devices').doc(id).get()));
 const deviceNames=new Map(nameDocs.filter(d=>d.exists).map(d=>[d.id,d.data().name]));
 const readDocs=await db.collection('users').doc(req.user.uid).collection('readAlerts').get();
 const readThroughDocs=await db.collection('users').doc(req.user.uid).collection('notificationReadThrough').get();
 const readThrough=new Map(readThroughDocs.docs.filter(d=>allowedSet.has(d.id)).map(d=>[d.id,d.data().readAt]));
 const readEpisodes=new Map(readDocs.docs.map(d=>[d.id,d.data().episode??0]));
 const output=items.map(d=>({...clean(d),deviceName:deviceNames.get(d.data().deviceId)??d.data().deviceId,
  unread:readEpisodes.get(d.id)!==(d.data().episode??0)&&!(readThrough.get(d.data().deviceId)&&d.data().createdAt<=readThrough.get(d.data().deviceId))}));
 // Open alerts are an independent count; never derive this from a partial page.
 const countQuery=(id)=>{
  let q=db.collection('alerts').where('status','==','OPEN');
  if(id!==null)q=q.where('deviceId','==',id);
  return q.count().get();
 };
 let openCount=0;
 for(let i=0;i<chunks.length;i+=10){
  const counts=await Promise.all(chunks.slice(i,i+10).map(countQuery));
  openCount+=counts.reduce((n,c)=>n+c.data().count,0);
 }
 // Personal unread count includes every incident status, not just OPEN.
 // The separately returned openCount preserves the operational metric.
 // A per-buoy Mark All Read watermark excludes prior episodes while later
 // incidents and reopened episodes remain eligible.
 let unreadCandidates=0;
 for(let i=0;i<allowed.length;i+=10){
  const counts=await Promise.all(allowed.slice(i,i+10).map(id=>{
   let q=db.collection('alerts').where('deviceId','==',id);
   const readAt=readThrough.get(id);
   if(typeof readAt==='string')q=q.where('createdAt','>',readAt);
   return q.count().get();
  }));
  unreadCandidates+=counts.reduce((n,c)=>n+c.data().count,0);
 }
 const countedRead=new Set();
 for(let i=0;i<readDocs.docs.length;i+=20){
  const batch=await Promise.all(readDocs.docs.slice(i,i+20).map(d=>db.collection('alerts').doc(d.id).get()));
  for(let n=0;n<batch.length;n++){
   const alert=batch[n],receipt=readDocs.docs[i+n];
   if(!alert.exists||!allowedSet.has(alert.data().deviceId)||
    (receipt.data().episode??0)!==(alert.data().episode??0))continue;
   const readAt=readThrough.get(alert.data().deviceId);
   if(typeof readAt!=='string'||alert.data().createdAt>readAt)countedRead.add(alert.id);
  }
 }
 res.json({items:output,nextCursor:extra?items.at(-1)?.id:null,openCount,
  unreadCount:Math.max(0,unreadCandidates-countedRead.size)});
}
export async function markAlertRead(req,res){
 const db=firebase().db,ref=db.collection('alerts').doc(req.params.alertId),alert=await ref.get();
 if(!alert.exists)throw httpError('NOT_FOUND',404);
 await requireAccess(db,req.user,alert.data().deviceId);
 await db.collection('users').doc(req.user.uid).collection('readAlerts').doc(alert.id)
  .set({alertId:alert.id,deviceId:alert.data().deviceId,episode:alert.data().episode??0,readAt:now()},{merge:true});
 res.json({alertId:alert.id,unread:false});
}
export async function markAllAlertsRead(req,res){
 const db=firebase().db,ids=await accessibleDeviceIds(db,req.user),readAt=now();
 const collection=db.collection('users').doc(req.user.uid).collection('notificationReadThrough');
 // Watermarks apply only to devices accessible at this moment. They never
 // acknowledge an incident, nor permanently mark future incoming invitations.
 for(let i=0;i<ids.length;i+=400){
  const batch=db.batch();
  for(const id of ids.slice(i,i+400))batch.set(collection.doc(id),{readAt,deviceId:id});
  await batch.commit();
 }
 res.json({readAt,deviceCount:ids.length});
}
export async function alertDetail(req,res){const db=firebase().db,doc=await db.collection('alerts').doc(req.params.alertId).get();if(!doc.exists)throw httpError('NOT_FOUND',404);await requireAccess(db,req.user,doc.data().deviceId);res.json(clean(doc))}
export async function acknowledge(req,res){const db=firebase().db,ref=db.collection('alerts').doc(req.params.alertId);let alert;
 await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw httpError('NOT_FOUND',404);alert=snap.data();await requireAccess(db,req.user,alert.deviceId,'OPERATE',tx);if(alert.status==='RESOLVED')throw httpError('ALERT_ALREADY_RESOLVED',409);if(alert.status!=='ACKNOWLEDGED'){tx.update(ref,{status:'ACKNOWLEDGED',acknowledgedAt:now(),acknowledgedBy:req.user.uid});enqueue(tx,db,'alert.acknowledged',alert.deviceId,ref.id,{alertId:ref.id,deviceId:alert.deviceId,uid:req.user.uid})}});res.json({alertId:ref.id,status:'ACKNOWLEDGED'})}
export async function registerPush(req,res){
 const {sessionId,sessionSecret,...p}=validate(pushToken,req.body);
 const db=firebase().db,id=tokenId(p.token),ref=db.collection('notificationTokens').doc(id);
 // A new installation registration is accepted only against an authenticated
 // active server session. Legacy records remain read-only compatibility for
 // unclaimed devices until the approved P2_STRICT_OWNERSHIP cutover.
 if(sessionId||sessionSecret)await requirePushSession(db,req.user.uid,sessionId,sessionSecret);
 else if(process.env.P2_STRICT_OWNERSHIP==='true')throw httpError('SESSION_REQUIRED',403);
 // A single Android installation keeps its FCM token across account switches.
 // Only an OLD, provably ineligible session token may be rebound to another UID.
 const old=await ref.get();
 const previousActiveForAnother=old.exists&&old.data().uid!==req.user.uid&&old.data().active;
 if(previousActiveForAnother&&(!old.data().sessionId||
    await isEligiblePushSession(db,old.data())))throw httpError('TOKEN_ALREADY_REGISTERED',409);
 await db.runTransaction(async tx=>{
  const previous=await tx.get(ref);
  if(previous.exists&&previous.data().uid!==req.user.uid&&previous.data().active&&
   (!previous.data().sessionId||previous.data().sessionId!==old.data()?.sessionId))
   throw httpError('TOKEN_ALREADY_REGISTERED',409);
  tx.set(ref,{...p,sessionId:sessionId??null,uid:req.user.uid,active:true,updatedAt:now()});
 });
 res.status(201).json({registered:true});
}
export async function unregisterPush(req,res){const {token}=validate(pushToken,req.body),ref=firebase().db.collection('notificationTokens').doc(tokenId(token));await firebase().db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists){if(s.data().uid!==req.user.uid)throw httpError('FORBIDDEN',403);tx.update(ref,{active:false,updatedAt:now()})}});res.json({unregistered:true})}
export async function pusherAuth(req,res){const {channel_name, socket_id}=req.body??{};if(typeof channel_name!=='string'||typeof socket_id!=='string'||!/^[0-9]+\.[0-9]+$/.test(socket_id))throw httpError('BAD_REQUEST',400);
 let permitted=false;if(channel_name===`private-user-${req.user.uid}`)permitted=true;
 if(channel_name==='private-fleet-all'&&req.user.role==='ADMIN'&&process.env.P2_STRICT_OWNERSHIP!=='true')permitted=true;
 if(channel_name.startsWith('private-device-'))permitted=await requireAccess(firebase().db,req.user,channel_name.slice('private-device-'.length)).then(()=>true,()=>false);if(!permitted)throw httpError('FORBIDDEN',403);
 const {default:Pusher}=await import('pusher');const p=new Pusher({appId:process.env.PUSHER_APP_ID,key:process.env.PUSHER_KEY,secret:process.env.PUSHER_SECRET,cluster:process.env.PUSHER_CLUSTER});res.json(p.authorizeChannel(socket_id,channel_name))}
export async function readiness(req,res){try{const db=firebase().db;await db.collection('_readiness').doc('ping').get();res.json({status:'ok',service:'oil-spill-monitoring-buoy-api',database:'ready'})}catch{res.status(503).json({status:'unavailable',service:'oil-spill-monitoring-buoy-api',database:'unavailable'})}}
