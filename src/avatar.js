import {createHash,randomUUID} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {firebase} from './firebase.js';
import {httpError} from './domain.js';

const MAX_BYTES=2*1024*1024;
const ATTEMPTS_PER_DAY=5;
const lockMs=120000;
const now=()=>new Date().toISOString();
const config=()=>{
 const cloud=process.env.CLOUDINARY_CLOUD_NAME;
 const key=process.env.CLOUDINARY_API_KEY;
 const secret=process.env.CLOUDINARY_API_SECRET;
 if(!cloud||!key||!secret||!/^[a-zA-Z0-9_-]{1,100}$/.test(cloud))
  throw httpError('AVATAR_PROVIDER_UNAVAILABLE',503);
 return {cloud,key,secret};
};
const publicId=uid=>'blueguard-avatars/'+createHash('sha256').update(uid).digest('hex');
const signature=(params,secret)=>createHash('sha1').update(
 Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('&')+secret
).digest('hex');
export function detectAvatar(buf,mime){
 if(!Buffer.isBuffer(buf)||buf.length<12||buf.length>MAX_BYTES)throw httpError('INVALID_AVATAR',422);
 const type=buf.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':
  (buf[0]===255&&buf[1]===216&&buf[2]===255)?'image/jpeg':
  (buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')?'image/webp':null;
 if(!type||type!==mime)throw httpError('INVALID_AVATAR',422);
 return type;
}
async function providerAction(endpoint,params,buf,mime,fetchImpl=fetch){
 const {cloud,key,secret}=config();
 const signed={...params,timestamp:Math.floor(Date.now()/1000)};
 const data=new FormData();
 for(const [name,value] of Object.entries(signed))data.set(name,String(value));
 data.set('api_key',key);data.set('signature',signature(signed,secret));
 if(buf)data.set('file',new Blob([buf],{type:mime}),'avatar');
 let response;
 try{response=await fetchImpl('https://api.cloudinary.com/v1_1/'+cloud+'/image/'+endpoint,{
  method:'POST',body:data,signal:AbortSignal.timeout(20000)
 });}catch{throw httpError('AVATAR_PROVIDER_ERROR',502)}
 if(!response.ok)throw httpError('AVATAR_PROVIDER_ERROR',502);
 try{return {data:await response.json(),cloud}}catch{throw httpError('AVATAR_PROVIDER_ERROR',502)}
}
export async function uploadAvatarToProvider(uid,buf,mime,fetchImpl=fetch){
 const id=publicId(uid);
 const {data,cloud}=await providerAction('upload',{public_id:id,overwrite:'true',invalidate:'true'},buf,mime,fetchImpl);
 if(data.public_id!==id||data.resource_type!=='image'||!Number.isSafeInteger(data.version)||data.version<1||
  !['jpg','png','webp'].includes(data.format))
  throw httpError('AVATAR_PROVIDER_ERROR',502);
 return {avatarUrl:'https://res.cloudinary.com/'+cloud+'/image/upload/c_fill,g_auto,h_256,w_256,f_auto,q_auto/v'+data.version+'/'+id,
  avatarVersion:data.version};
}
export async function removeAvatarFromProvider(uid,fetchImpl=fetch){
 const {data}=await providerAction('destroy',{public_id:publicId(uid),invalidate:'true'},null,null,fetchImpl);
 if(!['ok','not found'].includes(data.result))throw httpError('AVATAR_PROVIDER_ERROR',502);
}
async function lock(uid,operation){
 const db=firebase().db,ref=db.collection('users').doc(uid),id=randomUUID();
 const day=new Date().toISOString().slice(0,10),time=Date.now();
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists||snap.data().status!=='ACTIVE')throw httpError('ACCOUNT_DISABLED',403);
  const profile=snap.data();
  if(profile.avatarOperation&&profile.avatarOperation.expiresAt>time)throw httpError('AVATAR_BUSY',409);
  if(operation==='upload'){
   const previous=profile.avatarDaily?.day===day?profile.avatarDaily.count:0;
   if(previous>=ATTEMPTS_PER_DAY)throw httpError('AVATAR_QUOTA_EXCEEDED',429);
   tx.update(ref,{avatarDaily:{day,count:previous+1},avatarOperation:{id,expiresAt:time+lockMs}});
  }else{
   if(!profile.avatarUrl)return;
   tx.update(ref,{avatarOperation:{id,expiresAt:time+lockMs}});
  }
 });
 return {ref,id};
}
async function finish(ref,id,fields){
 const db=firebase().db;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists||snap.data().status!=='ACTIVE'||snap.data().avatarOperation?.id!==id)
   throw httpError('AVATAR_CONFLICT',409);
  tx.update(ref,{...fields,avatarOperation:FieldValue.delete(),avatarUpdatedAt:now()});
 });
}
async function unlock(ref,id){
 await firebase().db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(snap.exists&&snap.data().avatarOperation?.id===id)tx.update(ref,{avatarOperation:FieldValue.delete()});
 });
}
const responseProfile=(uid,profile)=>({uid,email:profile.email,role:profile.role,status:profile.status,
 displayName:profile.displayName,avatarUrl:profile.avatarUrl??null});
export async function putAvatar(req,res){
 config(); // Fail closed before reserving a per-user upload quota.
 const mime=(req.get('content-type')??'').split(';')[0].trim().toLowerCase();
 detectAvatar(req.body,mime);
 const {ref,id}=await lock(req.user.uid,'upload');
 try{
  const result=await uploadAvatarToProvider(req.user.uid,req.body,mime);
  await finish(ref,id,result);
 }catch(error){await unlock(ref,id);throw error}
 res.json(responseProfile(req.user.uid,(await ref.get()).data()));
}
export async function deleteAvatar(req,res){
 config();
 const {ref,id}=await lock(req.user.uid,'delete');
 const snap=await ref.get();
 if(snap.data()?.avatarOperation?.id!==id){
  res.json(responseProfile(req.user.uid,snap.data()));return;
 }
 try{
  await removeAvatarFromProvider(req.user.uid);
  await finish(ref,id,{avatarUrl:FieldValue.delete(),avatarVersion:FieldValue.delete()});
 }catch(error){await unlock(ref,id);throw error}
 res.json(responseProfile(req.user.uid,(await ref.get()).data()));
}
