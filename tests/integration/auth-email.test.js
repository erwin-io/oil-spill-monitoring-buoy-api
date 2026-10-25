import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
  !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('DISPOSABLE AUTH+FIRESTORE EMULATORS REQUIRED');
const {auth}=firebase();
test('P2-15 disabled provider keeps Firebase mail delivery and rejects unverified/anonymous send without credentials',async()=>{
 const previous=process.env.P2_AUTH_EMAIL_ENABLED;
 process.env.P2_AUTH_EMAIL_ENABLED='false';
 const email='email_api_'+randomUUID().replaceAll('-','').slice(0,12)+'@example.test';
 const password='StrongTestPassword123!';
 const u=await auth.createUser({email,password,emailVerified:false});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(method,path,body,headers={})=>{
  const r=await fetch(base+'/api/v1'+path,{method,headers:{'content-type':'application/json',...headers},
    ...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json()};
 };
 try{
  const config=await call('GET','/auth/email/config');
  assert.equal(config.status,200);
  assert.equal(config.body.delivery,'firebase');
  assert.equal((await call('POST','/auth/email/verification',{})).status,401);
  assert.equal((await call('POST','/auth/email/password-reset',{email})).status,503);
  const sign=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+
   '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  assert.equal(sign.status,200);
  const token=(await sign.json()).idToken;
  assert.equal((await call('POST','/auth/email/verification',{}, {Authorization:'Bearer '+token})).status,503);
  assert.equal((await call('POST','/auth/email/verification',{}, {Authorization:'Bearer INVALID'})).status,401);
  assert.equal((await auth.getUser(u.uid)).emailVerified,false,'disabled verification endpoint cannot bypass Firebase Auth');
 }finally{
  await new Promise(r=>server.close(r));
  if(previous===undefined)delete process.env.P2_AUTH_EMAIL_ENABLED;else process.env.P2_AUTH_EMAIL_ENABLED=previous;
 }
});
