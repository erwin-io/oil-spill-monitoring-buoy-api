import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import app from '../../src/app.js';
import {firebase} from '../../src/firebase.js';

if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||
 !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('Disposable emulators required');
const {auth,db}=firebase(),password='Strong-Test-Password-123!';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
async function person(){
 const email='avatar_'+randomUUID().slice(0,13)+'@example.test';
 const u=await auth.createUser({email,password,emailVerified:true});
 await db.collection('users').doc(u.uid).set({email,role:'VIEWER',status:'ACTIVE',displayName:'Owner',allowedDeviceIds:[]});
 const r=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+
 '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})
 });
 assert.equal(r.status,200);
 return {uid:u.uid,token:(await r.json()).idToken};
}
test('P2-13 avatar: authenticated signed provider, own profile, isolated deletes, quota and failure release',async()=>{
 const [a,b]=await Promise.all([person(),person()]);
 const previous={CLOUDINARY_CLOUD_NAME:process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY:process.env.CLOUDINARY_API_KEY,CLOUDINARY_API_SECRET:process.env.CLOUDINARY_API_SECRET};
 const oldFetch=globalThis.fetch;
 process.env.CLOUDINARY_CLOUD_NAME='blueguardtest';
 process.env.CLOUDINARY_API_KEY='demo-api-key';process.env.CLOUDINARY_API_SECRET='demo-sign-secret';
 const uploaded=[],removed=[];
 let providerFailure=false,version=0;
 globalThis.fetch=async (url,options)=>{
  if(String(url).startsWith('https://api.cloudinary.com/v1_1/blueguardtest/')){
   const publicId=options.body.get('public_id');
   assert.ok(publicId.startsWith('blueguard-avatars/'));
   assert.ok(options.body.get('signature'));
   assert.equal(options.body.has('api_secret'),false);
   if(providerFailure)return {ok:false,status:502};
   if(String(url).endsWith('/upload')){
    uploaded.push(publicId);version++;
    return {ok:true,json:async()=>({public_id:publicId,resource_type:'image',format:'png',version})};
   }
   removed.push(publicId);
   return {ok:true,json:async()=>({result:'ok'})};
  }
  return oldFetch(url,options);
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 async function send(user,method,mime,body){
  const headers={authorization:'Bearer '+user.token};
  if(mime)headers['content-type']=mime;
  const r=await fetch(base+'/auth/avatar',{method,headers,...(body?{body}:{})});
  return {status:r.status,result:await r.json()};
 }
 try{
  assert.equal((await send(a,'PUT','image/png',Buffer.from('bad image content'))).status,422);
  assert.equal((await send(a,'PUT','image/jpeg',png)).status,422);
  assert.equal((await send(a,'PUT','application/octet-stream',png)).status,422);
  providerFailure=true;
  assert.equal((await send(a,'PUT','image/png',png)).status,502);
  assert.equal((await db.collection('users').doc(a.uid).get()).data().avatarOperation,undefined);
  providerFailure=false;
  for(let n=0;n<4;n++){
   const good=await send(a,'PUT','image/png',png);
   assert.equal(good.status,200);
   assert.equal(good.result.uid,a.uid);
   assert.match(good.result.avatarUrl,/res.cloudinary.com\/blueguardtest/);
  }
  assert.equal(uploaded.length,4);
  assert.equal(new Set(uploaded).size,1,'replacement must reuse own public id');
  assert.equal((await send(a,'PUT','image/png',png)).status,429,'five daily attempted uploads per account');
  const bDelete=await send(b,'DELETE');
  assert.equal(bDelete.status,200);
  assert.equal(removed.length,0,'another user cannot delete an owner asset');
  const bAvatar=await send(b,'PUT','image/png',png);
  assert.equal(bAvatar.status,200);
  assert.notEqual(uploaded.at(-1),uploaded[0]);
  assert.equal((await send(a,'DELETE')).status,200);
  assert.equal(removed.length,1);
  assert.equal(removed[0],uploaded[0]);
  const response=await fetch(base+'/auth/me',{headers:{authorization:'Bearer '+a.token}});
  assert.equal(response.status,200);
  assert.equal((await response.json()).avatarUrl,null);
  assert.equal((await db.collection('users').doc(a.uid).get()).data().avatarVersion,undefined);
 }finally{
  globalThis.fetch=oldFetch;
  await new Promise(r=>server.close(r));
  for(const [key,value] of Object.entries(previous)){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});
