import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('Disposable Auth/Firestore emulators required');
process.env.DEVICE_KEY_PEPPER='EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789';
process.env.P2_STRICT_OWNERSHIP='true';
const {db,auth}=firebase(),password='Strong-Test-Password-123!';
async function person(){
 const email='transfer_'+randomUUID().slice(0,14)+'@example.test';
 const user=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(user.uid).set({email,role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[]});
 const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(response.status,200);
 return {uid:user.uid,email,token:(await response.json()).idToken};
}
test('P2-03 current-owner proposal, consent, race, replay, expiry, outsider and history isolation',async()=>{
 const [owner,recipient,outsider]=await Promise.all([person(),person(),person()]);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const id='transfer_'+randomUUID().slice(0,12),path='/api/v1/devices/'+id;
 const dev=db.collection('devices').doc(id);
 await dev.set({name:'Preserved test buoy',status:'ACTIVE',ownerUid:owner.uid,ownedAt:new Date().toISOString()});
 await dev.collection('measurements').doc('historical_01').set({measuredAt:'2026-01-01T00:00:00Z'});
 await db.collection('alerts').doc('transfer_alert_'+id).set({deviceId:id,status:'RESOLVED',createdAt:'2026-01-01T00:00:00Z'});
 const call=async(who,method,route,body)=>{
  const r=await fetch(base+route,{method,headers:{'content-type':'application/json',Authorization:'Bearer '+who.token},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,value:await r.json()};
 };
 try{
  assert.equal((await call(outsider,'POST',path+'/transfer',{email:recipient.email})).status,403);
  assert.equal((await call(recipient,'POST',path+'/transfer',{email:owner.email})).status,403);
  const started=await call(owner,'POST',path+'/transfer',{email:recipient.email});
  assert.equal(started.status,201);
  assert.equal((await call(owner,'POST',path+'/transfer',{email:outsider.email})).status,409);
  assert.equal((await call(outsider,'POST',path+'/transfer/accept',{requestId:started.value.requestId})).status,409);
  assert.equal((await call(recipient,'POST',path+'/transfer/accept',{requestId:'incorrect'})).status,409);
  assert.equal((await call(recipient,'GET','/api/v1/transfers/incoming')).value.items[0].deviceId,id);
  const attempts=await Promise.all([
   call(recipient,'POST',path+'/transfer/accept',{requestId:started.value.requestId}),
   call(recipient,'POST',path+'/transfer/accept',{requestId:started.value.requestId}),
  ]);
  assert.deepEqual(attempts.map(v=>v.status).sort(),[200,409]);
  assert.equal((await dev.get()).data().ownerUid,recipient.uid);
  assert.equal((await dev.collection('measurements').doc('historical_01').get()).exists,true);
  assert.equal((await db.collection('alerts').doc('transfer_alert_'+id).get()).exists,true);
  assert.equal((await call(owner,'GET',path)).status,403);
  assert.equal((await call(recipient,'GET',path)).status,200);
  assert.equal((await call(owner,'POST',path+'/transfer',{email:outsider.email})).status,403);
  const records=await dev.collection('ownershipAudit').get();
  assert.deepEqual(records.docs.map(d=>d.data().type).sort(),['TRANSFER_ACCEPTED','TRANSFER_REQUESTED']);
  assert.equal((await call(recipient,'POST',path+'/transfer',{email:owner.email})).status,201);
  assert.equal((await call(recipient,'DELETE',path+'/transfer')).status,200);
  assert.equal((await call(owner,'POST',path+'/transfer/accept',{requestId:(await db.collection('deviceTransfers').doc(id).get()).data().requestId})).status,409);
  const again=await call(recipient,'POST',path+'/transfer',{email:owner.email});
  assert.equal(again.status,201);
  await db.collection('deviceTransfers').doc(id).update({expiresAt:'2020-01-01T00:00:00.000Z'});
  assert.equal((await call(owner,'POST',path+'/transfer/accept',{requestId:again.value.requestId})).status,409);
  assert.equal((await dev.get()).data().ownerUid,recipient.uid);
 }finally{await new Promise(r=>server.close(r))}
});
