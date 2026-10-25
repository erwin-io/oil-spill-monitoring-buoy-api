import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('Disposable emulators required');
process.env.P2_STRICT_OWNERSHIP='true';
const {auth,db}=firebase(),password='Strong-Test-Password-123!';
async function human(){
 const email='paging_'+randomUUID().slice(0,12)+'@example.test';
 const user=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(user.uid).set({email,role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[]});
 const r=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+
  '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(r.status,200);return {uid:user.uid,token:(await r.json()).idToken};
}
test('P2-07 device paging returns all authorized IDs without foreign records or repeated pages',async()=>{
 const [owner,outsider]=await Promise.all([human(),human()]);
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port,id='scope_'+randomUUID().slice(0,11);
 const ids=Array.from({length:5},(_,i)=>id+'_'+i);
 await Promise.all(ids.map((deviceId,i)=>db.collection('devices').doc(deviceId)
  .set({ownerUid:owner.uid,status:'ACTIVE',name:'Private '+i})));
 await db.collection('devices').doc(id+'_outsider').set({ownerUid:outsider.uid,status:'ACTIVE',name:'Secret'});
 const get=async(user,url)=>{
  const r=await fetch(base+url,{headers:{authorization:'Bearer '+user.token}});
  return {status:r.status,json:await r.json()};
 };
 try{
  const first=await get(owner,'/api/v1/devices?limit=2');
  assert.equal(first.status,200);assert.equal(first.json.items.length,2);
  assert.equal(first.json.nextCursor,ids[1]);
  const second=await get(owner,'/api/v1/devices?limit=2&cursor='+first.json.nextCursor);
  assert.equal(second.json.items.length,2);assert.equal(second.json.nextCursor,ids[3]);
  const third=await get(owner,'/api/v1/devices?limit=2&cursor='+second.json.nextCursor);
  assert.equal(third.json.items.length,1);assert.equal(third.json.nextCursor,null);
  const all=[...first.json.items,...second.json.items,...third.json.items].map(x=>x.id);
  assert.deepEqual(all,ids);
  assert.equal((await get(owner,'/api/v1/devices?cursor='+id+'_outsider')).status,400);
  assert.equal((await get(outsider,'/api/v1/devices')).json.items.some(x=>ids.includes(x.id)),false);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
