import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firebase } from '../../src/firebase.js';
import { ingestMeasurement, ingestHealth, history, alerts, markAlertRead } from '../../src/handlers.js';
import { pushAlert, offlineSweep, pruneRateLimitWindows } from '../../src/jobs.js';
import { CONFIG_DEFAULT, alertKey } from '../../src/domain.js';
import {distributedRateLimit} from '../../src/security.js';

if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-')){
 throw new Error('Integration tests MUST use a demo- Firebase project with FIRESTORE_EMULATOR_HOST');
}
process.env.PUSHER_ENABLED='false';
process.env.FCM_ENABLED='false';
process.env.CRON_SECRET='integration-test-cron-secret-123456789';
const {db}=firebase();
const iso=()=>new Date().toISOString();
const device=()=>`emu_${randomUUID().replaceAll('-','').slice(0,22)}`;
const response=()=>({statusCode:200,payload:null,status(code){this.statusCode=code;return this},json(data){this.payload=data;return this}});
async function seedDevice(id){
 await db.collection('devices').doc(id).set({name:'Emulator buoy',status:'ACTIVE',registeredAt:iso(),lastSeenAt:null,lastMeasurementAt:null});
 await db.collection('devices').doc(id).collection('config').doc('current').set({...CONFIG_DEFAULT,configVersion:1});
}
const spectral={f415:1,f445:2,f480:3,f515:4,f555:5,f590:6};
const measure=(id,measuredAt=iso())=>({measurementId:id,measuredAt,classification:'NORMAL',confidence:.9,spectral,totalFluorescence:12});

test('Firestore: immutable measurement replay and conflicting measurement IDs',async()=>{
 const id=device();await seedDevice(id);
 const body=measure('sample_001'), req={deviceId:id,body};
 const one=response();await ingestMeasurement(req,one);
 assert.equal(one.statusCode,201);
 const replay=response();await ingestMeasurement(req,replay);
 assert.equal(replay.statusCode,200);assert.equal(replay.payload.duplicate,true);
 assert.equal(replay.payload.receivedAt,one.payload.receivedAt);
 await assert.rejects(ingestMeasurement({deviceId:id,body:{...body,confidence:.3}},response()),{code:'MEASUREMENT_CONFLICT',status:409});
 const docs=await db.collection('devices').doc(id).collection('measurements').get();
 assert.equal(docs.size,1);
});

test('Firestore: stale queued measurement cannot overwrite latest projection',async()=>{
 const id=device();await seedDevice(id);
 const later=new Date(Date.now()-60_000).toISOString();
 const earlier=new Date(Date.now()-120_000).toISOString();
 await ingestMeasurement({deviceId:id,body:measure('latest_sample',later)},response());
 await ingestMeasurement({deviceId:id,body:measure('queued_sample',earlier)},response());
 const doc=await db.collection('devices').doc(id).get();
 assert.equal(doc.data().latestMeasurementId,'latest_sample');
 assert.equal(doc.data().lastMeasurementAt,later);
});

test('Firestore: health replay digest, diagnostics and configured threshold',async()=>{
 const id=device();await seedDevice(id);
 await db.collection('devices').doc(id).collection('config').doc('current').update({lowBatteryThreshold:25});
 const body={healthId:'health_001',measuredAt:iso(),batteryPercent:24,sensor:'FAULT',queueDepth:8};
 const one=response();await ingestHealth({deviceId:id,body},one);
 const replay=response();await ingestHealth({deviceId:id,body},replay);
 assert.equal(one.statusCode,201);assert.equal(replay.statusCode,200);
 assert.equal(replay.payload.receivedAt,one.payload.receivedAt);
 await assert.rejects(ingestHealth({deviceId:id,body:{...body,batteryPercent:23}},response()),{code:'HEALTH_CONFLICT',status:409});
 for(const type of ['LOW_BATTERY','SENSOR_FAULT']){
  const alert=await db.collection('alerts').doc(alertKey(type,id,'ACTIVE')).get();
  assert.equal(alert.exists,true,`${type} should be recorded atomically`);
  const intent=await db.collection('notificationOutbox').doc(alertKey('alert.created',id,alert.id+'_0')).get();
  assert.equal(intent.exists,true);
 }
});

test('Firestore: FCM respects per-device users and skips previously delivered tokens',async()=>{
 const id=device();await seedDevice(id);
 const other=device(),viewer='u_'+randomUUID().slice(0,8),outsider='u_'+randomUUID().slice(0,8);
 await db.collection('users').doc(viewer).set({role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[id]});
 await db.collection('users').doc(outsider).set({role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[other]});
 const alertId=alertKey('PETROLEUM',id,'alert_1');
 await db.collection('alerts').doc(alertId).set({deviceId:id,type:'PETROLEUM',status:'OPEN',createdAt:iso()});
 const authorized=db.collection('notificationTokens').doc('tok_'+randomUUID().replaceAll('-',''));
 const forbidden=db.collection('notificationTokens').doc('tok_'+randomUUID().replaceAll('-',''));
 await authorized.set({uid:viewer,active:true,token:'valid-testing-token-placeholder-1'});
 await forbidden.set({uid:outsider,active:true,token:'other-testing-token-placeholder-2'});
 const ref=db.collection('notificationOutbox').doc(alertKey('alert.created',id,alertId));
 await ref.set({deviceId:id,type:'alert.created',status:'CLAIMED'});
 const job={deviceId:id,payload:{alertId},type:'alert.created'};
 const sends=[];
 const messaging={sendEachForMulticast:async message=>{
  sends.push(message.tokens);
  return {responses:message.tokens.map(()=>({success:true}))};
 }};
 await pushAlert(db,messaging,job,ref);
 assert.equal(sends.length,1);
 assert.deepEqual(sends[0],['valid-testing-token-placeholder-1']);
 await pushAlert(db,messaging,job,ref);
 assert.equal(sends.length,1,'delivery receipt should prevent repeat on retry');
});

test('Firestore: offline recovery and recurring outage generate distinct delivery jobs',async()=>{
 const id=device();await seedDevice(id);
 const ref=db.collection('devices').doc(id);
 const request={get:(key)=>key==='authorization'?`Bearer ${process.env.CRON_SECRET}`:undefined};
 await ref.update({lastSeenAt:'2026-10-20T00:00:00.000Z'});
 await offlineSweep(request,response());
 const alertId=alertKey('OFFLINE',id,'ACTIVE');
 const alertRef=db.collection('alerts').doc(alertId);
 assert.equal((await alertRef.get()).data().status,'OPEN');
 await ref.update({lastSeenAt:iso()});
 await offlineSweep(request,response());
 assert.equal((await alertRef.get()).data().status,'RESOLVED');
 await ref.update({lastSeenAt:'2026-10-20T00:00:00.000Z'});
 await offlineSweep(request,response());
 assert.equal((await alertRef.get()).data().status,'OPEN');
 assert.equal((await alertRef.get()).data().episode,1);
 const next=await db.collection('notificationOutbox').doc(alertKey('alert.created',id,alertId+'_1')).get();
 assert.equal(next.exists,true);
});

test('Firestore: repeated health faults do not spam and recovery permits new episode',async()=>{
 const id=device();await seedDevice(id);
 const start=new Date(Date.now()-6000).getTime();
 const upload=async(n,battery,sensor)=>ingestHealth({deviceId:id,body:{
  healthId:'status_'+n,measuredAt:new Date(start+n*1000).toISOString(),batteryPercent:battery,sensor,
 }},response());
 const ref=db.collection('alerts').doc(alertKey('LOW_BATTERY',id,'ACTIVE'));
 await upload(1,10,'OK');
 assert.equal((await ref.get()).data().status,'OPEN');
 assert.equal((await ref.get()).data().episode,0);
 await upload(2,11,'OK');
 assert.equal((await ref.get()).data().episode,0);
 await upload(3,80,'OK');
 assert.equal((await ref.get()).data().status,'RESOLVED');
 await upload(4,7,'OK');
 assert.equal((await ref.get()).data().status,'OPEN');
 assert.equal((await ref.get()).data().episode,1);
 const first=await db.collection('notificationOutbox').doc(alertKey('alert.created',id,ref.id+'_0')).get();
 const repeated=await db.collection('notificationOutbox').doc(alertKey('alert.created',id,ref.id+'_1')).get();
 assert.equal(first.exists,true);
 assert.equal(repeated.exists,true);
 const created=(await db.collection('notificationOutbox').where('deviceId','==',id).get()).docs
  .filter(x=>x.data().type==='alert.created');
 assert.equal(created.length,2,'two fault episodes, not three notifications');
});

test('Firestore: reopened petroleum alarm gets new outbox ID and FCM receipts',async()=>{
 const id=device();await seedDevice(id);
 const start=Date.now()-5000;
 const data=(key,delta,classification)=>({...measure(key,new Date(start+delta).toISOString()),classification,confidence:.93});
 await ingestMeasurement({deviceId:id,body:data('petroleum_1',1000,'PETROLEUM')},response());
 await ingestMeasurement({deviceId:id,body:data('normal_1',2000,'NORMAL')},response());
 await ingestMeasurement({deviceId:id,body:data('petroleum_2',3000,'PETROLEUM')},response());
 const active=db.collection('alerts').doc(alertKey('PETROLEUM',id,'ACTIVE'));
 const state=await active.get();
 assert.equal(state.data().status,'OPEN');
 assert.equal(state.data().episode,1);
 for(const episode of [0,1]){
  const job=await db.collection('notificationOutbox')
   .doc(alertKey('alert.created',id,active.id+'_'+episode)).get();
  assert.equal(job.exists,true,'petroleum episode '+episode+' must have independent receipts');
 }
});

test('Firestore: resumable offline sweep visits buoy IDs beyond first page and does not replay episodes',async()=>{
 const original=process.env.MAX_OFFLINE_SWEEP_DEVICES;
 process.env.MAX_OFFLINE_SWEEP_DEVICES='2';
 const prefix='zz_phase1_'+randomUUID().replaceAll('-','').slice(0,12);
 const ids=[0,1,2].map(i=>prefix+'_'+i);
 const progress=db.collection('_workerState').doc('offlineSweep');
 const call=async()=>{
  const result=response();
  await offlineSweep({get:key=>key==='authorization'?`Bearer ${process.env.CRON_SECRET}`:undefined},result);
  return result.payload;
 };
 try{
  for(const id of ids){
   await seedDevice(id);
   await db.collection('devices').doc(id).update({lastSeenAt:'2026-01-01T00:00:00.000Z'});
  }
  // Earlier test buoy IDs sort before zz_; resume immediately before these fixtures.
  await progress.set({lastDeviceId:'zz_phase1_',updatedAt:iso()});
  const first=await call();
  assert.equal(first.checked,2);
  assert.equal(first.newOffline,2);
  assert.equal(first.morePages,true);
  const second=await call();
  assert.equal(second.checked,1);
  assert.equal(second.newOffline,1);
  assert.equal(second.morePages,false);
  for(const id of ids){
   const alert=await db.collection('alerts').doc(alertKey('OFFLINE',id,'ACTIVE')).get();
   assert.equal(alert.exists,true,`missing offline alert for ${id}`);
   assert.equal(alert.data().episode,0);
  }
  await progress.set({lastDeviceId:'zz_phase1_',updatedAt:iso()});
  const repeated=await call();
  assert.equal(repeated.newOffline,0,'rechecking the page must not open another episode');
 }finally{
  if(original===undefined)delete process.env.MAX_OFFLINE_SWEEP_DEVICES;
  else process.env.MAX_OFFLINE_SWEEP_DEVICES=original;
  await progress.delete();
 }
});

test('Firestore: 135-record history supports stable timestamp/cursor pages and rejects foreign cursors',async()=>{
 const id=device();await seedDevice(id);
 const batch=db.batch();
 const measurements=db.collection('devices').doc(id).collection('measurements');
 for(let i=0;i<135;i++){
  const measuredAt=new Date(Date.now()-Math.floor(i/4)*1000).toISOString();
  const ref=measurements.doc('history_'+String(i).padStart(3,'0'));
  batch.set(ref,{...measure(ref.id,measuredAt),deviceId:id,receivedAt:iso(),source:'RAW_SEAWATER'});
 }
 await batch.commit();
 let cursor=null;
 const visited=new Set();
 const pageSizes=[];
 let previousTime=Infinity;
 do{
  const res=response();
  await history({params:{deviceId:id},query:{limit:'50',...(cursor?{cursor}:{})}},res);
  assert.equal(res.statusCode,200);
  pageSizes.push(res.payload.items.length);
  for(const m of res.payload.items){
   assert.equal(m.deviceId,id);
   const time=Date.parse(m.measuredAt);
   assert.ok(time<=previousTime,'history must be ordered newest first across pages');
   previousTime=time;
   assert.ok(!visited.has(m.measurementId),'cursor traversal must not duplicate records');
   visited.add(m.measurementId);
  }
  cursor=res.payload.nextCursor;
 }while(cursor);
 assert.deepEqual(pageSizes,[50,50,35]);
 assert.equal(visited.size,135);
 await assert.rejects(
  history({params:{deviceId:id},query:{cursor:'nonexistent'}},response()),
  {code:'INVALID_CURSOR',status:400}
 );
});


test('Firestore: scoped alerts paginate past 100, filter status, count all open and persist per-user read flags',async()=>{
 const id=device(),foreign=device();await seedDevice(id);await seedDevice(foreign);
 const uid='viewer_'+randomUUID().replaceAll('-','').slice(0,12);
 await db.collection('users').doc(uid).set({role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[id]});
 const batch=db.batch();
 for(let i=0;i<112;i++){
  const key='paging_'+id+'_'+String(i).padStart(3,'0');
  batch.set(db.collection('alerts').doc(key),{
   deviceId:id,type:'PETROLEUM',severity:'CRITICAL',
   status:i<105?'OPEN':'RESOLVED',
   createdAt:new Date(Date.parse('2026-10-24T00:00:00Z')+i*1000).toISOString()
  });
 }
 batch.set(db.collection('alerts').doc('foreign_'+foreign),{
  deviceId:foreign,type:'PETROLEUM',severity:'CRITICAL',
  status:'OPEN',createdAt:'2026-10-24T00:00:00Z'
 });
 await batch.commit();
 const req=(cursor,limit=40,status='OPEN')=>({
  user:{uid,role:'VIEWER',allowedDeviceIds:[id]},
  query:{limit:String(limit),status,...(cursor?{cursor}:{})}
 });
 const visited=[];
 let cursor=null,firstId;
 do{
  const result=response();await alerts(req(cursor),result);
  assert.equal(result.payload.openCount,105);
  if(visited.length===0)assert.equal(result.payload.unreadCount,105);
  if(firstId===undefined)firstId=result.payload.items[0].id;
  for(const a of result.payload.items){
   assert.equal(a.deviceId,id);
   assert.equal(a.status,'OPEN');
   assert.equal(a.deviceName,'Emulator buoy');
   assert.equal(a.unread,true);
   visited.push(a.id);
  }
  cursor=result.payload.nextCursor;
 }while(cursor);
 assert.equal(visited.length,105);
 assert.equal(new Set(visited).size,105);
 const read=response();
 await markAlertRead({user:{uid,role:'VIEWER',allowedDeviceIds:[id]},params:{alertId:firstId}},read);
 assert.equal(read.payload.unread,false);
 const refreshed=response();await alerts(req(),refreshed);
 assert.equal(refreshed.payload.items[0].unread,false);
 assert.equal(refreshed.payload.unreadCount,104);
 await db.collection('alerts').doc(firstId).update({episode:1});
 const reopened=response();await alerts(req(),reopened);
 assert.equal(reopened.payload.items[0].unread,true,'new alert episode must be unread');
 assert.equal(reopened.payload.unreadCount,105);

 await assert.rejects(
  markAlertRead({user:{uid,role:'VIEWER',allowedDeviceIds:[id]},params:{alertId:'foreign_'+foreign}},response()),
  {status:403,code:'FORBIDDEN'}
 );
 await assert.rejects(alerts(req('foreign_'+foreign),response()),{status:400,code:'INVALID_CURSOR'});
 await assert.rejects(alerts({...req(),query:{status:'INVALID'}},response()),{status:422,code:'INVALID_ALERT_STATUS'});
});

test('Firestore: FCM retires invalid tokens and safely retries transient recipients without resending successes',async()=>{
 const id=device();await seedDevice(id);
 const uid='u_'+randomUUID().replaceAll('-','').slice(0,16);
 await db.collection('users').doc(uid).set({role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[id]});
 const alertId=alertKey('PETROLEUM',id,'deliver');
 await db.collection('alerts').doc(alertId).set({deviceId:id,type:'PETROLEUM',status:'OPEN',createdAt:iso()});
 const tokens=[
  {key:'a_'+randomUUID().replaceAll('-',''),val:'good-fcm-token-validation-1'},
  {key:'b_'+randomUUID().replaceAll('-',''),val:'invalid-fcm-token-validation'},
  {key:'c_'+randomUUID().replaceAll('-',''),val:'transient-fcm-token-validation'}
 ];
 await Promise.all(tokens.map(t=>db.collection('notificationTokens').doc(t.key).set({uid,active:true,token:t.val})));
 const ref=db.collection('notificationOutbox').doc(alertKey('alert.created',id,alertId));
 await ref.set({deviceId:id,type:'alert.created',status:'CLAIMED'});
 let calls=0;
 const messenger={sendEachForMulticast:async ({tokens:incoming})=>{
  calls++;
  return{responses:incoming.map(t=>{
   if(t==='good-fcm-token-validation-1')return {success:true};
   if(t==='invalid-fcm-token-validation')return {success:false,error:{code:'messaging/registration-token-not-registered'}};
   if(calls===1)return {success:false,error:{code:'messaging/unavailable'}};
   return{success:true};
  })};
 }};
 const job={deviceId:id,payload:{alertId},type:'alert.created'};
 await assert.rejects(pushAlert(db,messenger,job,ref),{code:'messaging/unavailable'});
 assert.equal((await db.collection('notificationTokens').doc(tokens[1].key).get()).data().active,false);
 assert.equal((await ref.collection('fcmReceipts').doc(tokens[0].key).get()).data().status,'SENT');
 await pushAlert(db,messenger,job,ref);
 assert.equal(calls,2);
 assert.equal((await ref.collection('fcmReceipts').doc(tokens[2].key).get()).data().status,'SENT');
});


test('Firestore: distributed per-minute telemetry quota is shared, denies at limit and never stores raw device secret',async()=>{
 // Pin the time window: an integration run can cross a real minute boundary between requests.
 const id=device(),fixedNow=Date.now();
 const limiter=distributedRateLimit('thesis_emulator_quota',2,()=>fixedNow);
 const req={deviceId:id,ip:'203.0.113.5',get:()=>'',method:'POST'};
 const headers={};const res={set:(key,val)=>{headers[key]=val;return res;}};
 const attempt=()=>new Promise(resolve=>{void limiter(req,res,(err)=>resolve(err??null));});
 assert.equal(await attempt(),null);
 assert.equal(await attempt(),null);
 const error=await attempt();
 assert.ok(error,'third admission in the same minute must be rate-limited');
 assert.equal(error.code,'RATE_LIMITED');
 assert.equal(error.status,429);
 assert.ok(Number(headers['Retry-After'])>=1);
 const records=await db.collection('_rateLimitWindows').where('kind','==','thesis_emulator_quota').get();
 const target=records.docs.find(d=>d.data().count===2);
 assert.ok(target,'quota counter should be persisted in Firestore');
 assert.equal(JSON.stringify(target.data()).includes(id),false,'raw identifiers must not be persisted');
});


test('Firestore: rate-limit windows are pruned in bounded batches without paid TTL',async()=>{
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const collection=db.collection('_rateLimitWindows');
 const past=new Date(Date.now()-5*60_000),future=new Date(Date.now()+2*60*60_000);
 const ids=[1,2,3].map(i=>'sim_prune_'+suffix+'_'+i);
 await Promise.all(ids.map((id,i)=>collection.doc(id).set({kind:'sim_prune',expiresAt:i<2?past:future,count:1})));
 assert.equal(await pruneRateLimitWindows(db,1),1);
 assert.equal(await pruneRateLimitWindows(db,1),1);
 assert.equal((await collection.doc(ids[2]).get()).exists,true,'unexpired rate window must survive');
 assert.equal((await collection.doc(ids[0]).get()).exists,false);
 assert.equal((await collection.doc(ids[1]).get()).exists,false);
});
