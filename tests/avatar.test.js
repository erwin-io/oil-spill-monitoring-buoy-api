import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {detectAvatar,uploadAvatarToProvider,removeAvatarFromProvider} from '../src/avatar.js';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const jpeg=Buffer.from('ffd8ffe000104a4649460001','hex');
const webp=Buffer.from('52494646040000005745425041424344','hex');

test('P2-13 MIME and magic bytes must match, with bounded image size',()=>{
 assert.equal(detectAvatar(png,'image/png'),'image/png');
 assert.equal(detectAvatar(jpeg,'image/jpeg'),'image/jpeg');
 assert.equal(detectAvatar(webp,'image/webp'),'image/webp');
 for(const [data,mime] of [[png,'image/jpeg'],[jpeg,'image/png'],[Buffer.from('evil content!!'),'image/png'],
  [Buffer.alloc(2*1024*1024+1),'image/jpeg'],[Buffer.alloc(0),'image/png']]){
  assert.throws(()=>detectAvatar(data,mime),{code:'INVALID_AVATAR',status:422});
 }
});
test('P2-13 signed server upload hides API secret and pins per-account public ID',async()=>{
 const before={...process.env};
 process.env.CLOUDINARY_CLOUD_NAME='blueguardtest';process.env.CLOUDINARY_API_KEY='test-key';
 process.env.CLOUDINARY_API_SECRET='only-on-server';
 const uid='firebase-owner-A';
 const expected='blueguard-avatars/'+createHash('sha256').update(uid).digest('hex');
 let captured=0;
 try{
  const fake=async(url,request)=>{
   assert.equal(url,'https://api.cloudinary.com/v1_1/blueguardtest/image/upload');
   assert.equal(request.method,'POST');
   const fields=request.body;
   assert.equal(fields.get('public_id'),expected);
   assert.equal(fields.get('overwrite'),'true');
   assert.equal(fields.get('invalidate'),'true');
   assert.equal(fields.get('api_key'),'test-key');
   assert.equal(fields.get('file').type,'image/png');
   assert.equal(fields.has('api_secret'),false);
   assert.equal(fields.has('folder'),false);
   const signed=['invalidate','overwrite','public_id','timestamp'].map(k=>k+'='+fields.get(k)).join('&')+'only-on-server';
   assert.equal(fields.get('signature'),createHash('sha1').update(signed).digest('hex'));
   captured++;
   return {ok:true,json:async()=>({public_id:expected,resource_type:'image',format:'png',version:218})};
  };
  const uploaded=await uploadAvatarToProvider(uid,png,'image/png',fake);
  assert.equal(captured,1);
  assert.match(uploaded.avatarUrl,/res.cloudinary.com\/blueguardtest\/image\/upload\/c_fill,g_auto,h_256,w_256,f_auto,q_auto\/v218/);
  assert.equal(uploaded.avatarVersion,218);
  await assert.rejects(uploadAvatarToProvider(uid,png,'image/png',async()=>({
   ok:true,json:async()=>({public_id:'attacker/path',resource_type:'image',format:'png',version:1})
  })),{code:'AVATAR_PROVIDER_ERROR'});
  const deleted=await removeAvatarFromProvider(uid,async(url,request)=>{
   assert.equal(url,'https://api.cloudinary.com/v1_1/blueguardtest/image/destroy');
   assert.equal(request.body.get('public_id'),expected);
   return {ok:true,json:async()=>({result:'ok'})};
  });
  assert.equal(deleted,undefined);
 }finally{
  for(const key of ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']){
   if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];
  }
 }
});
test('P2-13 avatar upload disabled without configured provider and never uses unsigned presets',async()=>{
 const before={...process.env};
 try{
  delete process.env.CLOUDINARY_API_SECRET;
  await assert.rejects(uploadAvatarToProvider('u',png,'image/png'),{code:'AVATAR_PROVIDER_UNAVAILABLE',status:503});
 }finally{if(before.CLOUDINARY_API_SECRET===undefined)delete process.env.CLOUDINARY_API_SECRET;
  else process.env.CLOUDINARY_API_SECRET=before.CLOUDINARY_API_SECRET}
});
