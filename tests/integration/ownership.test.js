import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';
import {pushAlert} from '../../src/jobs.js';

if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw new Error('Ownership tests require disposable Firebase emulators');
process.env.DEVICE_KEY_PEPPER='EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789';
process.env.P2_STRICT_OWNERSHIP='true';
process.env.PUSHER_APP_ID='123456';process.env.PUSHER_KEY='test-pusher-key';process.env.PUSHER_SECRET='test-pusher-secret';process.env.PUSHER_CLUSTER='ap1';
const {auth,db}=firebase(),password='Strong-Test-Password-123!';
async function account({role='VIEWER',verified=true}={}){
 const email=`owner_${randomUUID().slice(0,13)}@example.test`,user=await auth.createUser({email,password,emailVerified:verified});
 await db.collection('users').doc(user.uid).set({email,role,status:'ACTIVE',allowedDeviceIds:[]});
 const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(response.status,200);
 return {uid:user.uid,email,token:(await response.json()).idToken};
}

test('strict ownership gates all reads, owner writes, Viewer invitation and future FCM eligibility',async()=>{
 const admin=await account({role:'ADMIN'}),owner=await account(),viewer=await account(),outsider=await account(),unverified=await account({verified:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,id='owned_'+randomUUID().slice(0,12),path=`/api/v1/devices/${id}`;
 const call=async(method,url,body,headers={})=>{const r=await fetch(base+url,{method,headers:{'content-type':'application/json',...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,value:await r.json()}};
 const human=x=>({Authorization:`Bearer ${x.token}`});
 try{
  const registered=await call('POST','/api/v1/devices',{deviceId:id,name:'Private buoy'},human(admin));
  assert.equal(registered.status,201);
  await db.collection('users').doc(outsider.uid).update({allowedDeviceIds:[id]});
  assert.equal((await call('GET',path,undefined,human(outsider))).status,403,'old ACL is not proof of ownership');
  const device={'x-device-id':id,'x-device-key':registered.value.deviceKey};
  const started=await call('POST','/api/v1/device/pairing-challenges',{},device);
  assert.equal(started.status,201);
  assert.equal((await call('POST',path+'/claims',{challengeId:started.value.challengeId,claimCode:registered.value.claimCode},human(owner))).status,202);
  assert.equal((await call('POST','/api/v1/device/pairing-confirmations',{challengeId:started.value.challengeId,nonce:started.value.nonce},device)).status,200);
  assert.equal((await call('GET',path,undefined,human(owner))).status,200);
  assert.equal((await call('GET',path,undefined,human(owner))).value.access,'OWNER');
  assert.equal((await call('GET',path,undefined,human(admin))).status,403,'global ADMIN cannot read claimed device');
  assert.equal((await call('PATCH',path,{status:'DISABLED'},human(admin))).status,403,'provisioning administrator cannot control an owned buoy');
  assert.equal((await call('POST',path+'/rotate-key',{},human(admin))).status,403);
  assert.equal((await call('GET',path,undefined,human(outsider))).status,403);
  assert.equal((await call('GET','/api/v1/devices',undefined,human(owner))).value.items.length,1);
  assert.equal((await call('GET','/api/v1/devices',undefined,human(outsider))).value.items.length,0);
  assert.equal((await call('POST',path+'/invitations',{email:unverified.email},human(owner))).status,403);
  assert.equal((await call('POST',path+'/invitations',{email:viewer.email},human(outsider))).status,403);
  assert.equal((await call('POST',path+'/invitations',{email:viewer.email},human(owner))).status,201);
  assert.equal((await call('GET',path,undefined,human(viewer))).status,403,'invite needs explicit acceptance');
  assert.equal((await call('GET','/api/v1/invitations',undefined,human(viewer))).value.items[0].deviceId,id);
  assert.equal((await call('POST',path+'/invitations/accept',{},human(viewer))).status,200);
  assert.equal((await call('GET',path,undefined,human(viewer))).value.access,'VIEWER');
  assert.equal((await call('GET',path+'/health',undefined,human(viewer))).status,200);
  assert.equal((await call('GET',path+'/measurements',undefined,human(viewer))).status,200);
  assert.equal((await call('PUT',path+'/config',{configVersion:1,samplingIntervalMinutes:20},human(viewer))).status,403);
  assert.equal((await call('PUT',path+'/config',{configVersion:1,samplingIntervalMinutes:20},human(owner))).status,200);
  const alertId='private_alert_'+randomUUID().slice(0,12);
  await db.collection('alerts').doc(alertId).set({deviceId:id,type:'PETROLEUM',severity:'HIGH',status:'OPEN',createdAt:new Date().toISOString(),episode:0});
  assert.equal((await call('GET','/api/v1/alerts',undefined,human(viewer))).value.items.some(a=>a.id===alertId),true);
  assert.equal((await call('GET','/api/v1/alerts/'+alertId,undefined,human(outsider))).status,403);
  assert.equal((await call('PATCH','/api/v1/alerts/'+alertId+'/acknowledge',{},human(viewer))).status,403);
  assert.equal((await call('PATCH','/api/v1/alerts/'+alertId+'/acknowledge',{},human(owner))).status,200);
  const fcmRef=db.collection('notificationOutbox').doc('owned_job_'+randomUUID().slice(0,12));
  await fcmRef.set({type:'alert.created',deviceId:id,status:'CLAIMED'});
  for(const [person,token] of [[owner,'token-owner-test'],[viewer,'token-viewer-test'],[outsider,'token-outsider-test'],[admin,'token-admin-test']]){
   await db.collection('notificationTokens').doc('owned_token_'+person.uid).set({uid:person.uid,active:true,token});
  }
  let sent=[];
  const messaging={sendEachForMulticast:async m=>{sent.push(...m.tokens);return {responses:m.tokens.map(()=>({success:true}))}}};
  const job={deviceId:id,type:'alert.created',payload:{alertId}};
  await pushAlert(db,messaging,job,fcmRef);
  assert.deepEqual(sent.sort(),['token-owner-test','token-viewer-test']);
  assert.equal((await call('DELETE',path+'/viewers/'+viewer.uid,undefined,human(owner))).status,200);
  assert.equal((await call('GET',path,undefined,human(viewer))).status,403);
  assert.equal((await call('GET','/api/v1/alerts',undefined,human(viewer))).value.items.length,0);
  assert.equal((await call('POST','/api/v1/realtime/auth',{channel_name:`private-device-${id}`,socket_id:'123.456'},human(viewer))).status,403);
  assert.equal((await call('POST','/api/v1/realtime/auth',{channel_name:'private-fleet-all',socket_id:'123.456'},human(admin))).status,403);
  sent=[];await pushAlert(db,messaging,{...job,payload:{alertId}},db.collection('notificationOutbox').doc('second_job_'+randomUUID().slice(0,12)));
  assert.deepEqual(sent,['token-owner-test'],'revoked Viewer is ineligible for future FCM sends');
  await db.collection('devices').doc(id).collection('viewers').doc(viewer.uid).set({uid:viewer.uid,status:'ACTIVE',invitedBy:owner.uid});
  await db.collection('users').doc(viewer.uid).collection('sharedDevices').doc(id).set({deviceId:id});
  await db.collection('devices').doc(id).update({ownerUid:outsider.uid});
  assert.equal((await call('GET',path,undefined,human(viewer))).status,403,'former owner shares do not survive ownership changes');
 }finally{await new Promise(resolve=>server.close(resolve))}
});
