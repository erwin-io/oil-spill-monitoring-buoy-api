import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';

if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw new Error('Pairing integration requires disposable Auth and Firestore emulators');
process.env.DEVICE_KEY_PEPPER='EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789';
const {auth,db}=firebase(),password='Strong-Test-Password-123!';
async function account(role='VIEWER'){
 const email=`pair_${randomUUID().slice(0,13)}@example.test`,user=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(user.uid).set({email,role,status:'ACTIVE',allowedDeviceIds:[]});
 const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(response.status,200);
 return {uid:user.uid,token:(await response.json()).idToken};
}

test('protected claim credential, device PAIR, five-minute expiry, concurrent claim and one-owner lock',async()=>{
 const admin=await account('ADMIN'),alice=await account(),bob=await account();
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,id='pair_'+randomUUID().slice(0,12);
 const call=async(method,path,body,headers={})=>{
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,value:await response.json()};
 };
 const human=person=>({Authorization:`Bearer ${person.token}`});
 const ownedPath=`/api/v1/devices/${id}`;
 try{
  const provision=await call('POST','/api/v1/devices',{deviceId:id,name:'Unclaimed buoy'},human(admin));
  assert.equal(provision.status,201,JSON.stringify(provision.value));
  const {deviceKey,claimCode}=provision.value;
  assert.notEqual(deviceKey,claimCode);
  const credential=(await db.collection('deviceCredentials').doc(id).get()).data();
  assert.ok(credential.claimCodeHash);
  assert.equal(JSON.stringify(credential).includes(claimCode),false);
  const device={'x-device-id':id,'x-device-key':deviceKey};
  assert.equal((await call('POST','/api/v1/device/pairing-challenges',{}, {'x-device-id':id,'x-device-key':claimCode})).status,401);
  const first=await call('POST','/api/v1/device/pairing-challenges',{},device);
  assert.equal(first.status,201,JSON.stringify(first.value));
  assert.ok(first.value.expiresAt);
  assert.equal((await call('POST',ownedPath+'/claims',{challengeId:first.value.challengeId,claimCode:deviceKey},human(alice))).status,403);
  const pRef=db.collection('devicePairings').doc(id);
  await pRef.update({expiresAt:Date.now()-1});
  assert.equal((await call('POST',ownedPath+'/claims',{challengeId:first.value.challengeId,claimCode},human(alice))).status,409);
  const second=await call('POST','/api/v1/device/pairing-challenges',{},device);
  assert.equal(second.status,201);
  const candidate={claimCode};
  const [a,b]=await Promise.all([call('POST',ownedPath+'/claims',candidate,human(alice)),call('POST',ownedPath+'/claims',candidate,human(bob))]);
  assert.deepEqual([a.status,b.status].sort(),[202,409]);
  assert.equal((a.status===202?a:b).value.challengeId,second.value.challengeId);
  const winner=a.status===202?alice:bob,loser=a.status===202?bob:alice;
  assert.equal((await call('GET',ownedPath+'/claims/'+second.value.challengeId,undefined,human(loser))).status,404);
  assert.equal((await call('POST','/api/v1/device/pairing-confirmations',{challengeId:second.value.challengeId,nonce:claimCode},device)).status,403);
  const confirm=await call('POST','/api/v1/device/pairing-confirmations',{challengeId:second.value.challengeId,nonce:second.value.nonce},device);
  assert.equal(confirm.status,200,JSON.stringify(confirm.value));
  assert.equal((await db.collection('devices').doc(id).get()).data().ownerUid,winner.uid);
  assert.equal((await db.collection('deviceCredentials').doc(id).get()).data().claimCodeHash,null);
  assert.equal((await call('GET',ownedPath+'/claims/'+second.value.challengeId,undefined,human(winner))).value.state,'CONFIRMED');
  assert.equal((await call('POST','/api/v1/device/pairing-confirmations',{challengeId:second.value.challengeId,nonce:second.value.nonce},device)).status,409);
  assert.equal((await call('POST','/api/v1/device/pairing-challenges',{},device)).status,409);
  assert.equal((await call('POST',ownedPath+'/claim-code',{},human(admin))).status,409);
 }finally{await new Promise(resolve=>server.close(resolve))}
});

test('admin can reissue a legacy unowned buoy claim code without rotating upload credential',async()=>{
 const admin=await account('ADMIN'),person=await account();
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,id='legacy_'+randomUUID().slice(0,12);
 const post=async(path,body,headers)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,value:await r.json()}};
 try{
  const adminH={Authorization:`Bearer ${admin.token}`},userH={Authorization:`Bearer ${person.token}`};
  const provision=await post('/api/v1/devices',{deviceId:id,name:'Legacy data kept'},adminH);
  assert.equal(provision.status,201);
  const originalKey=provision.value.deviceKey;
  await db.collection('devices').doc(id).collection('measurements').doc('historic').set({classification:'NORMAL'});
  const device={'x-device-id':id,'x-device-key':originalKey};
  const initial=await post('/api/v1/device/pairing-challenges',{},device);
  const reissue=await post(`/api/v1/devices/${id}/claim-code`,{},adminH);
  assert.equal(reissue.status,200);
  assert.notEqual(reissue.value.claimCode,provision.value.claimCode);
  assert.equal((await post(`/api/v1/devices/${id}/claims`,{challengeId:initial.value.challengeId,claimCode:provision.value.claimCode},userH)).status,409);
  const later=await post('/api/v1/device/pairing-challenges',{},device);
  assert.equal(later.status,201,'Device upload key survives claim-code recovery');
  assert.equal((await post(`/api/v1/devices/${id}/claims`,{challengeId:later.value.challengeId,claimCode:provision.value.claimCode},userH)).status,403);
  assert.equal((await db.collection('devices').doc(id).collection('measurements').doc('historic').get()).exists,true);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
