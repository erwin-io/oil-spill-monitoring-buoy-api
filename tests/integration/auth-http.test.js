import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import app from '../../src/app.js';
import { firebase } from '../../src/firebase.js';

if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
   !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-')){
 throw new Error('HTTP integration tests MUST target both emulators on demo- project');
}
// The demo emulator uses synthetic credentials only; NEVER copy this to live .env.
process.env.DEVICE_KEY_PEPPER='EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789';
const {auth,db}=firebase();
async function signIn(email,password){
 const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-api-key`,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email,password,returnSecureToken:true})
 });
 const value=await response.json();
 assert.equal(response.status,200,JSON.stringify(value));
 return value.idToken;
}
async function server(){
 const listener=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{
  if(listener.listening)return resolve();
  listener.once('listening',resolve);
  listener.once('error',reject);
 });
 return {
  url:`http://127.0.0.1:${listener.address().port}`,
  close:()=>new Promise((resolve,reject)=>listener.close(err=>err?reject(err):resolve())),
 };
}
async function get(url,token){
 const r=await fetch(url,{headers:token?{Authorization:`Bearer ${token}`}:{}});
 return {code:r.status,body:await r.json()};
}

test('Firebase auth emulator: unverified, verified, scoped, disabled and admin HTTP gates',async()=>{
 const id=randomUUID().slice(0,12),email=`oil_spill_${id}@example.test`,password='Strong-Test-Password-123!';
 const user=await auth.createUser({email,password,emailVerified:false});
 const live=await server();
 try{
  const anonymous=await get(`${live.url}/api/v1/devices`);
  assert.equal(anonymous.code,401);
  let token=await signIn(email,password);
  const unverified=await fetch(`${live.url}/api/v1/auth/bootstrap`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'
  });
  assert.equal(unverified.status,403);
  await auth.updateUser(user.uid,{emailVerified:true});
  token=await signIn(email,password);
  const bootstrap=await fetch(`${live.url}/api/v1/auth/bootstrap`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'
  });
  const bootstrapBody=await bootstrap.text();
  assert.equal(bootstrap.status,200,bootstrapBody);
  const provisioned=await db.collection('users').doc(user.uid).get();
  assert.equal(provisioned.data().role,'VIEWER');
  assert.deepEqual(provisioned.data().allowedDeviceIds,[]);

  const protectedId='scoped_'+id;
  await db.collection('devices').doc(protectedId).set({name:'Scope test',status:'ACTIVE',registeredAt:new Date().toISOString()});
  const forbidden=await get(`${live.url}/api/v1/devices/${protectedId}`,token);
  assert.equal(forbidden.code,403);
  await db.collection('users').doc(user.uid).update({allowedDeviceIds:[protectedId]});
  const scoped=await get(`${live.url}/api/v1/devices/${protectedId}`,token);
  assert.equal(scoped.code,200);
  const list=await get(`${live.url}/api/v1/devices`,token);
  assert.equal(list.body.items.some(d=>d.id===protectedId),true);

  await db.collection('users').doc(user.uid).update({status:'DISABLED'});
  const disabled=await get(`${live.url}/api/v1/devices`,token);
  assert.equal(disabled.code,403);
  await db.collection('users').doc(user.uid).update({status:'ACTIVE',role:'ADMIN',allowedDeviceIds:[]});
  const admin=await get(`${live.url}/api/v1/devices/${protectedId}`,token);
  assert.equal(admin.code,200);
 }finally{
  await live.close();
 }
});

test('Firebase emulators: registered buoy keys, disable/re-enable, rotation and config CAS',async()=>{
 const key=randomUUID().slice(0,12),email=`admin_${key}@example.test`,password='Strong-Test-Password-123!';
 const user=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(user.uid).set({
  email,role:'ADMIN',status:'ACTIVE',displayName:'Test administrator',allowedDeviceIds:[],
 });
 const token=await signIn(email,password), buoyId='buoy_'+key, live=await server();
 const api=async(method,path,body,headers={})=>{
  const r=await fetch(`${live.url}${path}`,{
   method,
   headers:{'content-type':'application/json',...headers},
   ...(body?{body:JSON.stringify(body)}:{}),
  });
  return {code:r.status,body:await r.json()};
 };
 const human={Authorization:`Bearer ${token}`};
 const payload=(measurementId)=>({
  measurementId,measuredAt:new Date().toISOString(),classification:'NORMAL',
  confidence:.85,totalFluorescence:3,
  spectral:{f415:1,f445:1,f480:1,f515:1,f555:1,f590:1},
 });
 try{
  const registered=await api('POST','/api/v1/devices',{deviceId:buoyId,name:'Test buoy'},human);
  assert.equal(registered.code,201,JSON.stringify(registered.body));
  const original=registered.body.deviceKey;
  assert.equal(typeof original,'string');
  const headers=(key)=>({'x-device-id':buoyId,'x-device-key':key});
  const first=await api('POST','/api/v1/device/measurements',payload('m1'),headers(original));
  assert.equal(first.code,201,JSON.stringify(first.body));
  const bad=await api('POST','/api/v1/device/measurements',payload('m2'),headers('wrong-device-secret'));
  assert.equal(bad.code,401);

  const cfg=await api('GET',`/api/v1/devices/${buoyId}/config`,null,human);
  assert.equal(cfg.code,200);
  assert.equal(cfg.body.configVersion,1);
  const updated=await api('PUT',`/api/v1/devices/${buoyId}/config`,{configVersion:1,samplingIntervalMinutes:20},human);
  assert.equal(updated.code,200,JSON.stringify(updated.body));
  assert.equal(updated.body.configVersion,2);
  const conflict=await api('PUT',`/api/v1/devices/${buoyId}/config`,{configVersion:1,samplingIntervalMinutes:25},human);
  assert.equal(conflict.code,409);

  const disabled=await api('PATCH',`/api/v1/devices/${buoyId}`,{status:'DISABLED'},human);
  assert.equal(disabled.code,200);
  const afterDisabled=await api('POST','/api/v1/device/measurements',payload('m3'),headers(original));
  assert.equal(afterDisabled.code,401);
  const rotated=await api('POST',`/api/v1/devices/${buoyId}/rotate-key`,{},human);
  assert.equal(rotated.code,200);
  const newSecret=rotated.body.deviceKey;
  assert.notEqual(newSecret,original);
  const stillDisabled=await api('POST','/api/v1/device/measurements',payload('m4'),headers(newSecret));
  assert.equal(stillDisabled.code,401,'Rotation cannot enable disabled buoys');

  const enabled=await api('PATCH',`/api/v1/devices/${buoyId}`,{status:'ACTIVE'},human);
  assert.equal(enabled.code,200);
  const oldRevoked=await api('POST','/api/v1/device/measurements',payload('m5'),headers(original));
  assert.equal(oldRevoked.code,401);
  const newAccepted=await api('POST','/api/v1/device/measurements',payload('m6'),headers(newSecret));
  assert.equal(newAccepted.code,201,JSON.stringify(newAccepted.body));
 }finally{
  await live.close();
 }
});

test('Firebase emulators: provisioning, scoped history and oil alert acknowledge over HTTP',async()=>{
 const tag=randomUUID().replaceAll('-','').slice(0,14);
 const password='Strong-Test-Password-123!';
 let userSerial=0;
 const create=async(role,allowedDeviceIds=[])=>{
  const email=`phase1_${role.toLowerCase()}_${++userSerial}_${tag}@example.test`;
  const user=await auth.createUser({email,password,emailVerified:true});
  await db.collection('users').doc(user.uid).set({email,role,status:'ACTIVE',displayName:role,allowedDeviceIds});
  return {user,token:await signIn(email,password)};
 };
 const buoyId='phase1_'+tag;
 const admin=await create('ADMIN');
 const viewer=await create('VIEWER',[buoyId]);
 const outsider=await create('VIEWER');
 const operator=await create('OPERATOR',[buoyId]);
 const live=await server();
 const api=async(method,path,body,headers={})=>{
  const r=await fetch(live.url+path,{
   method,headers:{'content-type':'application/json',...headers},
   ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  });
  return {code:r.status,body:await r.json()};
 };
 const bearer=person=>({Authorization:`Bearer ${person.token}`});
 const timestamps=[3,2,1].map(m=>new Date(Date.now()-m*60000).toISOString());
 const sample=(key,at,classification='NORMAL')=>({
  measurementId:key,measuredAt:at,classification,confidence:.95,totalFluorescence:12,
  spectral:{f415:1,f445:2,f480:3,f515:4,f555:5,f590:6}
 });
 try{
  const created=await api('POST','/api/v1/devices',{deviceId:buoyId,name:'Phase 1 test buoy',firmwareVersion:'1.0-test',modelVersion:'rf-fixture'},bearer(admin));
  assert.equal(created.code,201,JSON.stringify(created.body));
  const metadata=await api('GET',`/api/v1/devices/${buoyId}`,undefined,bearer(viewer));
  assert.equal(metadata.code,200);
  assert.equal(metadata.body.firmwareVersion,'1.0-test');
  assert.equal(metadata.body.modelVersion,'rf-fixture');
  const deviceHeaders={'x-device-id':buoyId,'x-device-key':created.body.deviceKey};
  const duplicate=await api('POST','/api/v1/devices',{deviceId:buoyId,name:'Repeat'},bearer(admin));
  assert.equal(duplicate.code,409);
  const rejectedProvision=await api('POST','/api/v1/devices',{deviceId:'unprivileged_'+tag,name:'No'},bearer(viewer));
  assert.equal(rejectedProvision.code,403);
  const inaccessible=await api('GET',`/api/v1/devices/${buoyId}/measurements`,undefined,bearer(outsider));
  assert.equal(inaccessible.code,403);
  const emptyHistory=await api('GET',`/api/v1/devices/${buoyId}/measurements`,undefined,bearer(viewer));
  assert.equal(emptyHistory.code,200);
  assert.deepEqual(emptyHistory.body.items,[]);
  const first=await api('POST','/api/v1/device/measurements',sample('older',timestamps[0]),deviceHeaders);
  assert.equal(first.code,201);
  const oil=await api('POST','/api/v1/device/measurements',sample('oil',timestamps[1],'PETROLEUM'),deviceHeaders);
  assert.equal(oil.code,201);
  const page1=await api('GET',`/api/v1/devices/${buoyId}/measurements?limit=1`,undefined,bearer(viewer));
  assert.equal(page1.code,200);
  assert.equal(page1.body.items[0].measurementId,'oil');
  assert.ok(page1.body.nextCursor);
  const page2=await api('GET',`/api/v1/devices/${buoyId}/measurements?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,undefined,bearer(viewer));
  assert.equal(page2.code,200);
  assert.equal(page2.body.items[0].measurementId,'older');
  assert.equal(page2.body.nextCursor,null);
  const latest=await api('GET',`/api/v1/devices/${buoyId}/measurements/latest`,undefined,bearer(viewer));
  assert.equal(latest.body.measurementId,'oil');
  const inbox=await api('GET','/api/v1/alerts',undefined,bearer(viewer));
  assert.equal(inbox.code,200);
  const alert=inbox.body.items.find(x=>x.deviceId===buoyId&&x.type==='PETROLEUM');
  assert.ok(alert,'petroleum alert must exist');
  const denied=await api('PATCH',`/api/v1/alerts/${alert.id}/acknowledge`,{},bearer(viewer));
  assert.equal(denied.code,403);
  const foreign=await api('GET',`/api/v1/alerts/${alert.id}`,undefined,bearer(outsider));
  assert.equal(foreign.code,403);
  const acknowledged=await api('PATCH',`/api/v1/alerts/${alert.id}/acknowledge`,{},bearer(operator));
  assert.equal(acknowledged.code,200);
  const ackDoc=await db.collection('alerts').doc(alert.id).get();
  assert.equal(ackDoc.data().status,'ACKNOWLEDGED');
  assert.equal(ackDoc.data().acknowledgedBy,operator.user.uid);
  const resolved=await api('POST','/api/v1/device/measurements',sample('recovered',timestamps[2]),deviceHeaders);
  assert.equal(resolved.code,201);
  const final=await api('GET',`/api/v1/alerts/${alert.id}`,undefined,bearer(viewer));
  assert.equal(final.body.status,'RESOLVED');
  const staleAck=await api('PATCH',`/api/v1/alerts/${alert.id}/acknowledge`,{},bearer(operator));
  assert.equal(staleAck.code,409);
 }finally{
  await live.close();
 }
});

test('Firestore rules emulator: client cannot read devices, write sensors, or self-elevate roles',async()=>{
 const tag=randomUUID().replaceAll('-','').slice(0,12);
 const email=`rules_${tag}@example.test`,password='Strong-Test-Password-123!';
 const user=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(user.uid).set({
  email,displayName:'Rules test viewer',role:'VIEWER',status:'ACTIVE',allowedDeviceIds:['rules_'+tag],
 });
 const id='rules_'+tag;
 await db.collection('devices').doc(id).set({name:'Firestore security test',status:'ACTIVE'});
 const token=await signIn(email,password);
 const prefix=`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
 const asUser={authorization:`Bearer ${token}`,'content-type':'application/json'};
 const deniedRead=await fetch(`${prefix}/devices/${id}`,{headers:asUser});
 assert.equal(deniedRead.status,403,'even scoped viewer must use the protected API');
 const deniedWrite=await fetch(`${prefix}/devices/${id}`,{
  method:'PATCH',headers:asUser,
  body:JSON.stringify({fields:{latestClassification:{stringValue:'PETROLEUM'}}}),
 });
 assert.equal(deniedWrite.status,403,'mobile clients must never write sensor classifications');
 const privilege=await fetch(`${prefix}/users/${user.uid}`,{
  method:'PATCH',headers:asUser,
  body:JSON.stringify({fields:{role:{stringValue:'ADMIN'}}}),
 });
 assert.equal(privilege.status,403,'client self-promotion must be refused by rules');
 const serverRead=await db.collection('devices').doc(id).get();
 assert.equal(serverRead.exists,true,'trusted Admin SDK still has server-side access');
 const profile=await db.collection('users').doc(user.uid).get();
 assert.equal(profile.data().role,'VIEWER','rejected privilege escalation must not persist');
});
