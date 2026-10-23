import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firebase } from '../../src/firebase.js';
import { ingestMeasurement, ingestHealth } from '../../src/handlers.js';
import { pushAlert, offlineSweep } from '../../src/jobs.js';
import { CONFIG_DEFAULT, alertKey } from '../../src/domain.js';

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
 const later='2026-10-24T03:00:00.000Z', earlier='2026-10-24T02:00:00.000Z';
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
  const alert=await db.collection('alerts').doc(alertKey(type,id,body.healthId)).get();
  assert.equal(alert.exists,true,`${type} should be recorded atomically`);
  const intent=await db.collection('notificationOutbox').doc(alertKey('alert.created',id,alert.id)).get();
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
