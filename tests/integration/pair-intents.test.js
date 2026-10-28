import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';

if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))
 throw Error('Pair-intent tests require isolated Firebase Auth/Firestore emulators');
process.env.DEVICE_KEY_PEPPER='EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789';
const {db,auth}=firebase();
const password='Strong-Test-Password-123!';
async function account(role='VIEWER'){
 const email='pairv2_'+randomUUID().replaceAll('-','').slice(0,14)+'@example.test';
 const user=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(user.uid).set({email,role,status:'ACTIVE',allowedDeviceIds:[]});
 const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})
 });
 assert.equal(response.status,200);
 return {uid:user.uid,token:(await response.json()).idToken};
}
async function setup(){
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(method,path,body,headers={})=>{
  const response=await fetch(base+path,{method,
   headers:{'Content-Type':'application/json',...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,value:await response.json()};
 };
 return {call,close:()=>new Promise(resolve=>server.close(resolve))};
}
const userHeaders=u=>({Authorization:'Bearer '+u.token});
const deviceHeaders=(id,key)=>({'X-Device-ID':id,'X-Device-Key':key});
async function register(call,admin){
 const id='BG-'+randomUUID().replaceAll('-','').slice(0,10);
 const r=await call('POST','/api/v1/devices',{deviceId:id,name:'Test v2 buoy'},userHeaders(admin));
 assert.equal(r.status,201,JSON.stringify(r.value));
 return {id,key:r.value.deviceKey,code:r.value.claimCode};
}
test('v2 QR device ID: authenticated intent -> LTE PAIR -> atomic owner, nonce one-time and scoped polling',async()=>{
 const [admin,alice,bob]=await Promise.all([account('ADMIN'),account(),account()]);
 const {call,close}=await setup();
 try{
  const {id,key}=await register(call,admin);
  const path='/api/v1/devices/'+id+'/pair-intents';
  const get=async(intent,person)=>call('GET',path+'/'+intent,undefined,userHeaders(person));
  assert.equal((await call('POST',path,{},{})).status,401);
  assert.equal((await call('POST','/api/v1/devices/'+id+'-UNKNOWN/pair-intents',{},userHeaders(alice))).status,404);
  assert.equal((await db.collection('devicePairIntents').doc(id).get()).exists,false,'Idle buoy has no pairing state');
  const first=await call('POST',path,{},userHeaders(alice));
  assert.equal(first.status,201,JSON.stringify(first.value));
  assert.equal(first.value.state,'WAITING_FOR_PAIR');
  assert.ok(first.value.expiresAt);
  assert.equal(Object.hasOwn(first.value,'claimCode'),false);
  assert.equal(Object.hasOwn(first.value,'nonce'),false);
  const duplicate=await call('POST',path,{},userHeaders(alice));
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.value.intentId,first.value.intentId);
  assert.equal((await get(first.value.intentId,bob)).status,404);
  assert.equal((await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(id,'not-the-device-key'))).status,401);
  const challenge=await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(id,key));
  assert.equal(challenge.status,201,JSON.stringify(challenge.value));
  assert.equal(challenge.value.protocol,2);
  assert.equal(challenge.value.intentId,first.value.intentId);
  assert.equal((await get(first.value.intentId,alice)).value.state,'PENDING');
  const secret=(await db.collection('devicePairIntents').doc(id).get()).data();
  assert.equal(JSON.stringify(secret).includes(challenge.value.nonce),false,'No plaintext nonce in Firestore');
  assert.equal((await call('POST','/api/v1/device/pairing-confirmations',
   {protocol:2,intentId:challenge.value.intentId,challengeId:challenge.value.challengeId,nonce:'WRONG_NONCE'.padEnd(40,'_')},deviceHeaders(id,key))).status,403);
  const success=await call('POST','/api/v1/device/pairing-confirmations',
   {protocol:2,intentId:challenge.value.intentId,challengeId:challenge.value.challengeId,nonce:challenge.value.nonce},
   deviceHeaders(id,key));
  assert.equal(success.status,200,JSON.stringify(success.value));
  assert.equal(success.value.state,'CONFIRMED');
  assert.equal((await get(first.value.intentId,alice)).value.state,'CONFIRMED');
  assert.equal((await db.collection('devices').doc(id).get()).data().ownerUid,alice.uid);
  assert.equal((await call('POST','/api/v1/device/pairing-confirmations',
   {protocol:2,intentId:challenge.value.intentId,challengeId:challenge.value.challengeId,nonce:challenge.value.nonce},deviceHeaders(id,key))).status,409);
  assert.equal((await call('POST',path,{},userHeaders(bob))).status,409,'Owner lock');
  assert.equal((await call('DELETE',path+'/'+first.value.intentId,undefined,userHeaders(alice))).status,409);
 }finally{await close()}
});
test('v2 competing accounts fail closed, explicit cancel permits fresh retry, old firmware cannot cross protocols',async()=>{
 const [admin,alice,bob]=await Promise.all([account('ADMIN'),account(),account()]);
 const {call,close}=await setup();
 try{
  const {id,key}=await register(call,admin),url='/api/v1/devices/'+id+'/pair-intents';
  const one=await call('POST',url,{},userHeaders(alice));assert.equal(one.status,201);
  const two=await call('POST',url,{},userHeaders(bob));assert.equal(two.status,409);
  assert.equal(two.value.error.code,'PAIRING_CONFLICT');
  assert.equal((await call('GET',url+'/'+one.value.intentId,undefined,userHeaders(alice))).value.state,'CONFLICT');
  assert.equal((await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(id,key))).status,409);
  assert.equal((await call('POST','/api/v1/device/pairing-challenges',{},deviceHeaders(id,key))).status,409,'Legacy v1 cannot run simultaneously');
  assert.equal((await call('DELETE',url+'/'+one.value.intentId,undefined,userHeaders(bob))).status,404);
  const cancelled=await call('DELETE',url+'/'+one.value.intentId,undefined,userHeaders(alice));
  assert.equal(cancelled.value.state,'CANCELLED');
  const fresh=await call('POST',url,{},userHeaders(bob));
  assert.equal(fresh.status,201);assert.notEqual(fresh.value.intentId,one.value.intentId);
  const c1=await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(id,key));
  assert.equal(c1.status,201);
  const c2=await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(id,key));
  assert.equal(c2.status,201);
  const stale=await call('POST','/api/v1/device/pairing-confirmations',
   {protocol:2,intentId:c1.value.intentId,challengeId:c1.value.challengeId,nonce:c1.value.nonce},deviceHeaders(id,key));
  assert.equal(stale.status,409,'Repress invalidates old nonce');
  const good=await call('POST','/api/v1/device/pairing-confirmations',
   {protocol:2,intentId:c2.value.intentId,challengeId:c2.value.challengeId,nonce:c2.value.nonce},deviceHeaders(id,key));
  assert.equal(good.status,200);
  assert.equal((await db.collection('devices').doc(id).get()).data().ownerUid,bob.uid);
 }finally{await close()}
});
test('competing account arriving after physical PAIR invalidates in-flight nonce and prevents owner assignment',async()=>{
 const [admin,alice,bob]=await Promise.all([account('ADMIN'),account(),account()]);
 const {call,close}=await setup();
 try{
  const {id,key}=await register(call,admin),url='/api/v1/devices/'+id+'/pair-intents';
  const a=await call('POST',url,{},userHeaders(alice));
  assert.equal(a.status,201);
  const physical=await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(id,key));
  assert.equal(physical.status,201);
  assert.equal((await call('POST',url,{},userHeaders(bob))).status,409);
  assert.equal((await call('GET',url+'/'+a.value.intentId,undefined,userHeaders(alice))).value.state,'CONFLICT');
  const confirmation=await call('POST','/api/v1/device/pairing-confirmations',{
   protocol:2,intentId:physical.value.intentId,challengeId:physical.value.challengeId,nonce:physical.value.nonce
  },deviceHeaders(id,key));
  assert.equal(confirmation.status,409);
  assert.equal((await db.collection('devices').doc(id).get()).data().ownerUid??null,null);
 }finally{await close()}
});
test('v2 expiry, cancellation, different devices and legacy v1 compatibility are isolated',async()=>{
 const [admin,alice]=await Promise.all([account('ADMIN'),account()]);
 const {call,close}=await setup();
 try{
  const first=await register(call,admin),second=await register(call,admin);
  const path='/api/v1/devices/'+first.id+'/pair-intents';
  const a=await call('POST',path,{},userHeaders(alice));
  const b=await call('POST','/api/v1/devices/'+second.id+'/pair-intents',{},userHeaders(alice));
  assert.equal(a.status,201);assert.equal(b.status,201);
  const wrongDevice=await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(second.id,first.key));
  assert.equal(wrongDevice.status,401);
  const separate=await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(second.id,second.key));
  assert.equal(separate.status,201);assert.equal(separate.value.intentId,b.value.intentId);
  await db.collection('devicePairIntents').doc(first.id).update({expiresAt:Date.now()-1});
  assert.equal((await call('GET',path+'/'+a.value.intentId,undefined,userHeaders(alice))).value.state,'EXPIRED');
  assert.equal((await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(first.id,first.key))).status,409);
  const legacy=await call('POST','/api/v1/device/pairing-challenges',{},deviceHeaders(first.id,first.key));
  assert.equal(legacy.status,201,'Existing deployed firmware protocol 1 remains usable');
  assert.equal((await call('POST',path,{},userHeaders(alice))).status,409,'A current v1 pairing blocks v2 intent');
  await db.collection('devicePairings').doc(first.id).update({expiresAt:Date.now()-1});
  const replacement=await call('POST',path,{},userHeaders(alice));
  assert.equal(replacement.status,201);
  assert.equal((await call('DELETE',path+'/'+replacement.value.intentId,undefined,userHeaders(alice))).value.state,'CANCELLED');
  assert.equal((await call('POST','/api/v1/device/pairing-challenges',{protocol:2},deviceHeaders(first.id,first.key))).status,409);
 }finally{await close()}
});
