import {createHash} from 'node:crypto';
import {firebase} from './firebase.js';
import {CONFIG_DEFAULT,makeKey,keyHash,canRead,canOperate,httpError,parseTime,latestWins,alertKey,configNext,tokenId,healthAlerts} from './domain.js';
import {validate,measurement,health,newDevice,editDevice,editConfig,pushToken,deviceId} from './schemas.js';
const now=()=>new Date().toISOString();
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(stable(x)).digest('hex');
const maxPage=(n,def=30)=>Math.min(100,Math.max(1,Number.isInteger(Number(n))?Number(n):def));
const clean=d=>({id:d.id,...d.data()});
const safeDevice=d=>{const {keyHash:_,...rest}=d;return rest};
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
 const p=(await ref.get()).data();res.json({uid:id.uid,email:p.email,displayName:p.displayName,role:p.role,status:p.status,allowedDeviceIds:p.allowedDeviceIds??[]});
}
export async function me(req,res){const {uid,role,status,email,displayName,allowedDeviceIds}=req.user;res.json({uid,role,status,email,displayName,allowedDeviceIds:allowedDeviceIds??[]})}
export async function listDevices(req,res){const db=firebase().db;
 const all=req.user.role==='ADMIN';const ids=all?null:(req.user.allowedDeviceIds??[]);
 const docs=all?(await db.collection('devices').limit(100).get()).docs:await Promise.all(ids.slice(0,100).map(id=>db.collection('devices').doc(id).get()));
 res.json({items:docs.filter(d=>d.exists).map(d=>safeDevice(clean(d))),nextCursor:null});
}
export async function getDevice(req,res){const doc=await firebase().db.collection('devices').doc(req.params.deviceId).get();if(!doc.exists)throw httpError('NOT_FOUND',404);res.json(safeDevice(clean(doc)))}
export async function registerDevice(req,res){const input=validate(newDevice,req.body);const {db}=firebase();const id=input.deviceId;
 const secret=makeKey();const pepper=process.env.DEVICE_KEY_PEPPER;const hash=keyHash(secret,pepper);
 await db.runTransaction(async tx=>{const ref=db.collection('devices').doc(id),cref=db.collection('deviceCredentials').doc(id);if((await tx.get(ref)).exists)throw httpError('DEVICE_EXISTS',409);
 tx.create(ref,{...input,status:'ACTIVE',registeredAt:now(),lastSeenAt:null,lastMeasurementAt:null,latestClassification:null,confidence:null});
 tx.create(cref,{keyHash:hash,enabled:true,rotatedAt:now()});
 tx.create(ref.collection('config').doc('current'),{...CONFIG_DEFAULT,configVersion:1,updatedAt:now()});
 });res.status(201).json({deviceId:id,deviceKey:secret,warning:'Store the key securely; it will not be shown again.'});
}
export async function updateDevice(req,res){
 const p=validate(editDevice,req.body);const {db}=firebase(),id=req.params.deviceId;
 const ref=db.collection('devices').doc(id),credential=db.collection('deviceCredentials').doc(id);
 await db.runTransaction(async tx=>{
  const [device,cred]=await Promise.all([tx.get(ref),p.status?tx.get(credential):Promise.resolve(null)]);
  if(!device.exists)throw httpError('NOT_FOUND',404);
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
  tx.update(ref,{keyHash:keyHash(secret,process.env.DEVICE_KEY_PEPPER),rotatedAt:now(),enabled:dev.data().status==='ACTIVE'});
 });
 res.json({deviceId:id,deviceKey:secret,warning:'Old key is immediately revoked; store the new key securely.'});
}
export async function ingestMeasurement(req,res){const m=validate(measurement,req.body);const db=firebase().db;const devId=req.deviceId;
 const measured=parseTime(m.measuredAt);if(measured>Date.now()+10*60*1000||measured<Date.now()-365*86400000)throw httpError('TIMESTAMP_OUT_OF_RANGE',422);
 const ref=db.collection('devices').doc(devId),sample=ref.collection('measurements').doc(m.measurementId);let replay=false;
 await db.runTransaction(async tx=>{
  const activeOil=db.collection('alerts').doc(alertKey('PETROLEUM',devId,'ACTIVE'));
  const [existing,dev,conf,oilAlert]=await Promise.all([tx.get(sample),tx.get(ref),tx.get(ref.collection('config').doc('current')),tx.get(activeOil)]);
  if(existing.exists){const x=existing.data();if(x.payloadDigest!==digest(m))throw httpError('MEASUREMENT_CONFLICT',409);replay=true;return}
  if(!dev.exists||dev.data().status!=='ACTIVE')throw httpError('DEVICE_DISABLED',403);
  tx.create(sample,{...m,deviceId:devId,receivedAt:now(),payloadDigest:digest(m),source:'RAW_SEAWATER'});
  if(latestWins(dev.data(),m.measuredAt))tx.update(ref,{lastMeasurementAt:m.measuredAt,lastSeenAt:now(),latestClassification:m.classification,confidence:m.confidence,batteryPercent:m.batteryPercent??null,signalStrengthDbm:m.signalStrengthDbm??null,totalFluorescence:m.totalFluorescence,cellStatus:m.cellStatus??null,firmwareVersion:m.firmwareVersion??null,modelVersion:m.modelVersion??null,latestMeasurementId:m.measurementId});
  else tx.update(ref,{lastSeenAt:now()});
  const threshold=conf.exists?(conf.data().oilConfidenceThreshold??CONFIG_DEFAULT.oilConfidenceThreshold):CONFIG_DEFAULT.oilConfidenceThreshold;
  if(latestWins(dev.data(),m.measuredAt)&&m.classification==='PETROLEUM'&&m.confidence>=threshold&&(!oilAlert.exists||oilAlert.data().status==='RESOLVED')){
   const alert={deviceId:devId,measurementId:m.measurementId,type:'PETROLEUM',severity:'CRITICAL',status:'OPEN',createdAt:now(),resolvedAt:null};
   if(oilAlert.exists)tx.update(activeOil,alert);else tx.create(activeOil,alert);
   enqueue(tx,db,'alert.created',devId,activeOil.id,{alertId:activeOil.id,deviceId:devId,type:'PETROLEUM',severity:'CRITICAL'});
  }else if(m.classification==='NORMAL'&&oilAlert.exists&&['OPEN','ACKNOWLEDGED'].includes(oilAlert.data().status)&&latestWins(dev.data(),m.measuredAt)){tx.update(activeOil,{status:'RESOLVED',resolvedAt:now()})}
  // Restore legacy CELL_MAINTENANCE_REQUIRED detection from measurement telemetry.
  if(m.cellStatus==='MAINTENANCE_REQUIRED'){
   const alertId=alertKey('CELL_MAINTENANCE_REQUIRED',devId,m.measurementId);
   tx.create(db.collection('alerts').doc(alertId),{deviceId:devId,measurementId:m.measurementId,type:'CELL_MAINTENANCE_REQUIRED',severity:'HIGH',status:'OPEN',createdAt:now()});
   enqueue(tx,db,'alert.created',devId,alertId,{alertId,deviceId:devId,type:'CELL_MAINTENANCE_REQUIRED',severity:'HIGH'});
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
  tx.create(ref,{...h,deviceId:req.deviceId,receivedAt:now(),payloadDigest});
  if(!dev.data().lastHealthAt||latestWins({lastMeasurementAt:dev.data().lastHealthAt},h.measuredAt)){
   tx.update(d,{lastSeenAt:now(),lastHealthAt:h.measuredAt,batteryPercent:h.batteryPercent??dev.data().batteryPercent??null,signalStrengthDbm:h.signalStrengthDbm??dev.data().signalStrengthDbm??null,cellStatus:h.cellStatus??dev.data().cellStatus??null});
  }else tx.update(d,{lastSeenAt:now()});
  const threshold=conf.exists?conf.data().lowBatteryThreshold??CONFIG_DEFAULT.lowBatteryThreshold:CONFIG_DEFAULT.lowBatteryThreshold;
  for(const issue of healthAlerts(h,threshold)){
   const alertId=alertKey(issue.type,req.deviceId,h.healthId);
   tx.create(db.collection('alerts').doc(alertId),{deviceId:req.deviceId,healthId:h.healthId,type:issue.type,severity:issue.severity,status:'OPEN',createdAt:now()});
   enqueue(tx,db,'alert.created',req.deviceId,alertId,{deviceId:req.deviceId,alertId,type:issue.type,severity:issue.severity});
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
export async function alerts(req,res){const db=firebase().db;const ids=req.user.role==='ADMIN'?null:req.user.allowedDeviceIds??[];if(ids?.length===0)return res.json({items:[],nextCursor:null,openCount:0});
 let docs;if(ids===null){docs=(await db.collection('alerts').orderBy('createdAt','desc').limit(100).get()).docs;}else{
  const groups=await Promise.all(ids.slice(0,100).map(id=>db.collection('alerts').where('deviceId','==',id).limit(100).get()));docs=groups.flatMap(g=>g.docs).sort((a,b)=>b.data().createdAt.localeCompare(a.data().createdAt));}
 if(req.query.status)docs=docs.filter(d=>d.data().status===req.query.status);
 res.json({items:docs.slice(0,maxPage(req.query.limit)).map(clean),nextCursor:null,openCount:docs.filter(d=>d.data().status==='OPEN').length});
}
export async function alertDetail(req,res){const doc=await firebase().db.collection('alerts').doc(req.params.alertId).get();if(!doc.exists)throw httpError('NOT_FOUND',404);if(!canRead(req.user,doc.data().deviceId))throw httpError('FORBIDDEN',403);res.json(clean(doc))}
export async function acknowledge(req,res){const db=firebase().db,ref=db.collection('alerts').doc(req.params.alertId);let alert;
 await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw httpError('NOT_FOUND',404);alert=snap.data();if(!canRead(req.user,alert.deviceId))throw httpError('FORBIDDEN',403);if(alert.status==='RESOLVED')throw httpError('ALERT_ALREADY_RESOLVED',409);if(alert.status!=='ACKNOWLEDGED'){tx.update(ref,{status:'ACKNOWLEDGED',acknowledgedAt:now(),acknowledgedBy:req.user.uid});enqueue(tx,db,'alert.acknowledged',alert.deviceId,ref.id,{alertId:ref.id,deviceId:alert.deviceId,uid:req.user.uid})}});res.json({alertId:ref.id,status:'ACKNOWLEDGED'})}
export async function registerPush(req,res){const p=validate(pushToken,req.body),db=firebase().db,id=tokenId(p.token);const ref=db.collection('notificationTokens').doc(id);
 await db.runTransaction(async tx=>{const existing=await tx.get(ref);if(existing.exists&&existing.data().uid!==req.user.uid&&existing.data().active)throw httpError('TOKEN_ALREADY_REGISTERED',409);tx.set(ref,{...p,uid:req.user.uid,active:true,updatedAt:now()})});res.status(201).json({registered:true})}
export async function unregisterPush(req,res){const {token}=validate(pushToken,req.body),ref=firebase().db.collection('notificationTokens').doc(tokenId(token));await firebase().db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists){if(s.data().uid!==req.user.uid)throw httpError('FORBIDDEN',403);tx.update(ref,{active:false,updatedAt:now()})}});res.json({unregistered:true})}
export async function pusherAuth(req,res){const {channel_name, socket_id}=req.body??{};if(typeof channel_name!=='string'||typeof socket_id!=='string'||!/^[0-9]+\.[0-9]+$/.test(socket_id))throw httpError('BAD_REQUEST',400);
 let permitted=false;if(channel_name===`private-user-${req.user.uid}`)permitted=true;if(channel_name==='private-fleet-all'&&req.user.role==='ADMIN')permitted=true;
 if(channel_name.startsWith('private-device-'))permitted=canRead(req.user,channel_name.slice('private-device-'.length));if(!permitted)throw httpError('FORBIDDEN',403);
 const {default:Pusher}=await import('pusher');const p=new Pusher({appId:process.env.PUSHER_APP_ID,key:process.env.PUSHER_KEY,secret:process.env.PUSHER_SECRET,cluster:process.env.PUSHER_CLUSTER});res.json(p.authorizeChannel(socket_id,channel_name))}
export async function readiness(req,res){try{const db=firebase().db;await db.collection('_readiness').doc('ping').get();res.json({status:'ok',service:'bluewatch-api',database:'ready'})}catch{res.status(503).json({status:'unavailable',service:'bluewatch-api',database:'unavailable'})}}
