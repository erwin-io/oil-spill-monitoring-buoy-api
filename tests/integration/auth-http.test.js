import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import app from '../../src/app.js';
import { firebase } from '../../src/firebase.js';

if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
   !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-')){
 throw new Error('HTTP integration tests MUST target both emulators on demo- project');
}
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
 const id=randomUUID().slice(0,12),email=`bluewatch_${id}@example.test`,password='Strong-Test-Password-123!';
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
