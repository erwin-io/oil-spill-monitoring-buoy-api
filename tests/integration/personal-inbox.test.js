import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('Disposable emulators required');
process.env.DEVICE_KEY_PEPPER='EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789';
process.env.P2_STRICT_OWNERSHIP='true';
const {db,auth}=firebase(),password='Strong-Test-Password-123!';
async function person(){
 const email='inbox_'+randomUUID().slice(0,14)+'@example.test',p=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(p.uid).set({email,role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[]});
 const r=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(r.status,200);return {uid:p.uid,token:(await r.json()).idToken};
}
test('P2-11 per-user, per-buoy Mark All Read never acknowledges incidents or pre-reads future shares',async()=>{
 const [owner,viewer,other]=await Promise.all([person(),person(),person()]);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port,deviceId='inbox_'+randomUUID().slice(0,12),
  otherId='future_'+randomUUID().slice(0,12),alertId='alert_'+randomUUID().slice(0,12);
 const device=db.collection('devices').doc(deviceId),future=db.collection('devices').doc(otherId);
 await device.set({name:'A',status:'ACTIVE',ownerUid:owner.uid});
 await future.set({name:'B',status:'ACTIVE',ownerUid:other.uid});
 await device.collection('viewers').doc(viewer.uid).set({uid:viewer.uid,status:'ACTIVE',invitedBy:owner.uid});
 await db.collection('users').doc(viewer.uid).collection('sharedDevices').doc(deviceId).set({deviceId});
 await db.collection('alerts').doc(alertId).set({deviceId,type:'PETROLEUM',severity:'HIGH',episode:0,status:'OPEN',createdAt:new Date(Date.now()-120000).toISOString()});
 const futureAlertId='other_'+randomUUID().slice(0,12);
 await db.collection('alerts').doc(futureAlertId).set({deviceId:otherId,type:'PETROLEUM',severity:'HIGH',episode:0,status:'OPEN',createdAt:new Date(Date.now()-120000).toISOString()});
 const call=async(who,method,path)=>{
  const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+who.token}});
  return {status:r.status,data:await r.json()};
 };
 try{
  const first=await call(viewer,'GET','/api/v1/alerts');
  assert.equal(first.status,200);assert.equal(first.data.items[0].unread,true);
  const mark=await call(viewer,'POST','/api/v1/notifications/read-all');
  assert.equal(mark.status,200);assert.equal(mark.data.deviceCount,1);
  const inbox=await call(viewer,'GET','/api/v1/alerts');
  assert.equal(inbox.data.items[0].unread,false);assert.equal(inbox.data.unreadCount,0);
  assert.equal((await db.collection('alerts').doc(alertId).get()).data().status,'OPEN');
  assert.equal((await call(owner,'GET','/api/v1/alerts')).data.items[0].unread,true);
  assert.equal((await call(viewer,'PATCH','/api/v1/alerts/'+alertId+'/acknowledge')).status,403);
  // A new share must never inherit an older, unrelated read-all receipt.
  await future.collection('viewers').doc(viewer.uid).set({uid:viewer.uid,status:'ACTIVE',invitedBy:other.uid});
  await db.collection('users').doc(viewer.uid).collection('sharedDevices').doc(otherId).set({deviceId:otherId});
  const afterShare=await call(viewer,'GET','/api/v1/alerts');
  assert.equal(afterShare.data.items.find(a=>a.id===futureAlertId).unread,true);
  await new Promise(resolve=>setTimeout(resolve,15));
  await db.collection('alerts').doc(alertId).update({episode:1,status:'OPEN',createdAt:new Date().toISOString()});
  assert.equal((await call(viewer,'GET','/api/v1/alerts')).data.items.find(a=>a.id===alertId).unread,true);
  await device.collection('viewers').doc(viewer.uid).delete();
  assert.equal((await call(viewer,'GET','/api/v1/alerts')).data.items.some(a=>a.id===alertId),false);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
