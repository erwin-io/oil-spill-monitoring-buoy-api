import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {firebase} from '../../src/firebase.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('DEMO FIREBASE EMULATORS REQUIRED');
const {db,auth}=firebase();
const tag=()=>randomUUID().replaceAll('-','').slice(0,12);
async function runReset(email){
 const child=spawn(process.execPath,['scripts/reset-test-user.mjs','--emulator-integration-test'],{
  cwd:process.cwd(),env:{...process.env,FIREBASE_CLIENT_EMAIL:'',FIREBASE_PRIVATE_KEY:'',
   GOOGLE_APPLICATION_CREDENTIALS:''},stdio:['pipe','pipe','pipe']});
 let output='',respondedEmail=false,confirmed=false;
 const listen=chunk=>{
  output+=chunk.toString();
  if(!respondedEmail&&output.includes('Firebase test-account email to remove')){
   respondedEmail=true;child.stdin.write(email+'\n');
  }
  if(!confirmed&&output.includes('Type exactly "DELETE ')){
   confirmed=true;child.stdin.write('DELETE '+email+' FROM '+process.env.FIREBASE_PROJECT_ID+'\n');
  }
 };
 child.stdout.on('data',listen);
 child.stderr.on('data',listen);
 const result=await Promise.race([
  new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code))}),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('Reset timed out: '+output.slice(-1200))),90000))
 ]).finally(()=>{if(child.exitCode===null)child.kill()});
 assert.equal(result,0,output.slice(-3000));
 return output;
}
test('Interactive test-user reset removes Auth, nested profile, FCM receipts/session and foreign-device Viewer access without erasing telemetry',async()=>{
 const suffix=tag(),email='reset_'+suffix+'@example.test';
 const owner=await auth.createUser({email:'owner_'+suffix+'@example.test',emailVerified:true});
 const user=await auth.createUser({email,emailVerified:true});
 const other=await auth.createUser({email:'other_'+suffix+'@example.test',emailVerified:true});
 const uid=user.uid,device='reset_buoy_'+suffix,tokenId='token_'+suffix;
 await db.collection('users').doc(uid).set({email,role:'VIEWER',status:'ACTIVE',displayName:'Reset me'});
 await db.collection('users').doc(uid).collection('readAlerts').doc('a1').set({readAt:new Date().toISOString()});
 await db.collection('users').doc(other.uid).set({email:'other_'+suffix+'@example.test',role:'VIEWER',status:'ACTIVE'});
 const buoy=db.collection('devices').doc(device);
 await buoy.set({name:'Keep history',ownerUid:owner.uid,status:'ACTIVE'});
 await buoy.collection('viewers').doc(uid).set({uid,status:'ACTIVE',invitedBy:owner.uid});
 await buoy.collection('viewers').doc(other.uid).set({uid:other.uid,status:'ACTIVE',invitedBy:owner.uid});
 await buoy.collection('invitations').doc(uid).set({inviteeUid:uid,email,deviceId:device,ownerUid:owner.uid,status:'ACCEPTED'});
 await buoy.collection('measurements').doc('m1').set({classification:'NORMAL',measuredAt:new Date().toISOString()});
 await db.collection('notificationTokens').doc(tokenId).set({uid,token:'synthetic-test-token',active:true,sessionId:'s_'+suffix});
 await db.collection('pushSessions').doc('s_'+suffix).set({uid,installationId:'i_'+suffix,state:'ACTIVE'});
 await db.collection('pushInstallations').doc('i_'+suffix).set({uid,sessionId:'s_'+suffix});
 const alert=db.collection('alerts').doc('a_'+suffix);
 await alert.set({deviceId:device,type:'PETROLEUM',status:'ACKNOWLEDGED',acknowledgedBy:uid});
 const outbox=db.collection('notificationOutbox').doc('job_'+suffix);
 await outbox.set({type:'alert.created',deviceId:device,payload:{alertId:'a_'+suffix}});
 await outbox.collection('fcmReceipts').doc(tokenId).set({status:'SENT'});
 const personal=db.collection('notificationOutbox').doc('personal_'+suffix);
 await personal.set({type:'alert.acknowledged',deviceId:device,payload:{uid}});
 const output=await runReset(email);
 assert.match(output,/SUCCESS: test account deleted/);
 await assert.rejects(auth.getUser(uid),e=>e.code==='auth/user-not-found');
 assert.equal((await db.collection('users').doc(uid).get()).exists,false);
 assert.equal((await db.collection('users').doc(uid).collection('readAlerts').doc('a1').get()).exists,false);
 for(const ref of [
  db.collection('notificationTokens').doc(tokenId),
  db.collection('pushSessions').doc('s_'+suffix),
  db.collection('pushInstallations').doc('i_'+suffix),
  buoy.collection('viewers').doc(uid),
  buoy.collection('invitations').doc(uid),
  outbox.collection('fcmReceipts').doc(tokenId),personal]){
  assert.equal((await ref.get()).exists,false,ref.path);
 }
 assert.equal((await buoy.get()).data().ownerUid,owner.uid);
 assert.equal((await buoy.collection('measurements').doc('m1').get()).exists,true);
 assert.equal((await alert.get()).data().acknowledgedBy,uid,'shared incident history intentionally preserved');
 assert.equal((await buoy.collection('viewers').doc(other.uid).get()).exists,true,'another Viewer unchanged');
 assert.equal((await db.collection('users').doc(other.uid).get()).exists,true,'another account unchanged');
});
test('Interactive test-user reset refuses owned buoy with no deletion',async()=>{
 const suffix=tag(),email='reset_owner_'+suffix+'@example.test';
 const user=await auth.createUser({email,emailVerified:true});
 await db.collection('users').doc(user.uid).set({email,role:'VIEWER',status:'ACTIVE'});
 const buoy=db.collection('devices').doc('owned_'+suffix);
 await buoy.set({name:'Owned remains protected',ownerUid:user.uid});
 const child=spawn(process.execPath,['scripts/reset-test-user.mjs','--emulator-integration-test'],{
  cwd:process.cwd(),env:{...process.env,FIREBASE_CLIENT_EMAIL:'',FIREBASE_PRIVATE_KEY:'',
   GOOGLE_APPLICATION_CREDENTIALS:''},stdio:['pipe','pipe','pipe']});
 let result='';
 child.stdout.on('data',b=>{result+=b.toString();if(result.includes('Firebase test-account email')&&!result.includes('EMAIL_SENT')){result+='EMAIL_SENT';child.stdin.write(email+'\n')}});
 child.stderr.on('data',b=>result+=b.toString());
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
 assert.notEqual(code,0);
 assert.match(result,/OWNED_BUOYS_BLOCKED/);
 assert.equal((await auth.getUser(user.uid)).disabled,false);
 assert.equal((await buoy.get()).data().ownerUid,user.uid);
});
