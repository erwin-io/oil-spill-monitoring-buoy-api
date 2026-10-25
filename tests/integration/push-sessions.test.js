import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';
import {pushAlert} from '../../src/jobs.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('Disposable emulators required');
process.env.DEVICE_KEY_PEPPER='EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789';
process.env.P2_STRICT_OWNERSHIP='true';
const {db,auth}=firebase(),password='Strong-Test-Password-123!';
async function user(){
 const email='push_'+randomUUID().slice(0,14)+'@example.test',result=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(result.uid).set({email,role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[]});
 const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(response.status,200);return {uid:result.uid,token:(await response.json()).idToken};
}
test('P2-12 token binds to live session, renews, revokes and cannot resurrect after switching accounts',async()=>{
 const [first,second]=await Promise.all([user(),user()]);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port,installationId='install_'+randomUUID().replaceAll('-','');
 const token='test-fcm-token-'+randomUUID().replaceAll('-',''),id='push_'+randomUUID().slice(0,12);
 await db.collection('devices').doc(id).set({ownerUid:first.uid,status:'ACTIVE',name:'Private'});
 const alertId='push_alert_'+randomUUID().slice(0,12);
 await db.collection('alerts').doc(alertId).set({deviceId:id,type:'PETROLEUM',createdAt:new Date().toISOString(),status:'OPEN'});
 const call=async(who,method,path,body)=>{
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json',Authorization:'Bearer '+who.token},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};
 };
 const send=async()=>{
  let tokens=[];const jobRef=db.collection('notificationOutbox').doc('job_'+randomUUID().slice(0,12));
  const messaging={sendEachForMulticast:async msg=>{tokens.push(...msg.tokens);
   return {responses:msg.tokens.map(()=>({success:true}))}}};
  await pushAlert(db,messaging,{deviceId:id,payload:{alertId},type:'alert.created'},jobRef);
  return tokens;
 };
 try{
  const session=(await call(first,'POST','/api/v1/notifications/sessions',{installationId}));
  assert.equal(session.status,201);
  const registration={token,platform:'android',provider:'FCM',sessionId:session.data.sessionId,sessionSecret:session.data.sessionSecret};
  assert.equal((await call(first,'POST','/api/v1/notifications/register-device',{token,platform:'android',provider:'FCM'})).status,403);
  assert.equal((await call(second,'POST','/api/v1/notifications/register-device',registration)).status,403);
  assert.equal((await call(first,'POST','/api/v1/notifications/register-device',{...registration,sessionSecret:'x'.repeat(43)})).status,403);
  assert.equal((await call(first,'POST','/api/v1/notifications/register-device',registration)).status,201);
  assert.deepEqual(await send(),[token]);
  assert.equal((await call(first,'POST','/api/v1/notifications/sessions/'+session.data.sessionId+'/refresh',{sessionSecret:session.data.sessionSecret})).status,200);
  const switched=await call(second,'POST','/api/v1/notifications/sessions',{installationId});
  assert.equal(switched.status,201);
  assert.deepEqual(await send(),[],'replaced account installation cannot receive future push');
  assert.equal((await call(first,'POST','/api/v1/notifications/register-device',registration)).status,403);
  const newRegistration={token,platform:'android',provider:'FCM',sessionId:switched.data.sessionId,sessionSecret:switched.data.sessionSecret};
  assert.equal((await call(second,'POST','/api/v1/notifications/register-device',newRegistration)).status,201,'same Android FCM token safely rebounds to new session');
  await db.collection('devices').doc(id).update({ownerUid:second.uid});
  assert.deepEqual(await send(),[token]);
  assert.equal((await call(second,'DELETE','/api/v1/notifications/sessions/'+switched.data.sessionId,{sessionSecret:switched.data.sessionSecret})).status,200);
  assert.deepEqual(await send(),[],'logout suppresses future FCM dispatch');
  assert.equal((await call(second,'POST','/api/v1/notifications/register-device',newRegistration)).status,403,'late callback must not resurrect revoked session');
  const third=await call(second,'POST','/api/v1/notifications/sessions',{installationId});
  assert.equal(third.status,201);
  await db.collection('pushSessions').doc(third.data.sessionId).update({expiresAt:'2020-01-01T00:00:00.000Z'});
  assert.equal((await call(second,'POST','/api/v1/notifications/register-device',{...newRegistration,sessionId:third.data.sessionId,sessionSecret:third.data.sessionSecret})).status,403);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
