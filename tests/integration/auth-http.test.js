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
function server(){
 const listener=app.listen(0,'127.0.0.1');
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
 const live=server();
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
