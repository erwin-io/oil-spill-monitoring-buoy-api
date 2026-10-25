import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('Disposable emulators required');
const {auth,db}=firebase(),password='Strong-Test-Password-123!';
async function person(){
 const email='profile_'+randomUUID().slice(0,13)+'@example.test';
 const user=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(user.uid).set({email,role:'VIEWER',status:'ACTIVE',displayName:'Old Name',allowedDeviceIds:[]});
 const r=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+
  '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(r.status,200);return {uid:user.uid,token:(await r.json()).idToken};
}
test('P2-13 profile update is owner-only, strict-schema and cannot change privilege or other profiles',async()=>{
 const [one,two]=await Promise.all([person(),person()]);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(user,body)=>{
  const r=await fetch(base+'/api/v1/auth/me',{method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer '+user.token},body:JSON.stringify(body)});
  return {status:r.status,result:await r.json()};
 };
 try{
  const blocked=await call(one,{displayName:'New Name',role:'ADMIN',status:'ACTIVE'});
  assert.equal(blocked.status,422);
  assert.equal((await call(one,{displayName:' '})).status,422);
  const updated=await call(one,{displayName:'  BlueGuard Owner  '});
  assert.equal(updated.status,200);
  assert.equal(updated.result.displayName,'BlueGuard Owner');
  assert.equal(updated.result.uid,one.uid);
  const oneDoc=(await db.collection('users').doc(one.uid).get()).data();
  assert.equal(oneDoc.role,'VIEWER');
  assert.equal(oneDoc.displayName,'BlueGuard Owner');
  assert.equal((await db.collection('users').doc(two.uid).get()).data().displayName,'Old Name');
 }finally{await new Promise(r=>server.close(r))}
});
