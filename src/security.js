import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {firebase} from './firebase.js';
import {keyHash,keysEqual,canRead,httpError} from './domain.js';
import {requireAccess} from './access.js';
export const asyncRoute=f=>(req,res,next)=>Promise.resolve().then(()=>f(req,res)).catch(next);
export async function userAuth(req,res,next){try{
 const match=/^Bearer (\S+)$/i.exec(req.get('authorization')??'');if(!match)throw httpError('AUTH_REQUIRED',401);
 const {auth,db}=firebase();const identity=await auth.verifyIdToken(match[1],true);
 if(!identity.email_verified||!identity.email)throw httpError('EMAIL_NOT_VERIFIED',403);
 const doc=await db.collection('users').doc(identity.uid).get();
 if(!doc.exists)throw httpError('ACCOUNT_NOT_PROVISIONED',403);
 const profile=doc.data();if(profile.status!=='ACTIVE'||!['VIEWER','OPERATOR','ADMIN'].includes(profile.role))throw httpError('ACCOUNT_DISABLED',403);
 req.user={...profile,uid:identity.uid};next();
 }catch(e){next(e)}}
export async function deviceAuth(req,res,next){try{
 const deviceId=req.get('x-device-id');const key=req.get('x-device-key');if(!deviceId||!key||!/^[A-Za-z0-9_-]{1,80}$/.test(deviceId))throw httpError('DEVICE_AUTH_FAILED',401);
 const {db}=firebase();const [device,cred]=await Promise.all([db.collection('devices').doc(deviceId).get(),db.collection('deviceCredentials').doc(deviceId).get()]);
 if(!device.exists||!cred.exists||!cred.data().enabled||device.data().status!=='ACTIVE'||!keysEqual(keyHash(key,process.env.DEVICE_KEY_PEPPER),cred.data().keyHash))throw httpError('DEVICE_AUTH_FAILED',401);
 req.deviceId=deviceId;next();
 }catch(e){next(e)}}
export const requireRole=(...roles)=>(req,res,next)=>roles.includes(req.user?.role)?next():next(httpError('FORBIDDEN',403));
export const deviceScope=(req,res,next)=>requireAccess(firebase().db,req.user,req.params.deviceId).then(()=>next(),next);
export const deviceOwnerScope=(req,res,next)=>requireAccess(firebase().db,req.user,req.params.deviceId,'OWNER').then(()=>next(),next);
export const deviceOperatorScope=(req,res,next)=>requireAccess(firebase().db,req.user,req.params.deviceId,'OPERATE').then(()=>next(),next);

// Shared Firestore minute windows enforce admission across Vercel instances.
// Scope: state-changing entrypoints; no raw IPs, tokens or secrets are stored.
export function distributedRateLimit(kind,defaultLimit=60,now=Date.now){
 return async(req,res,next)=>{
  try{
   const configured=Number(process.env['RATE_LIMIT_'+kind.toUpperCase()]);
   const limit=Number.isSafeInteger(configured)&&configured>0?configured:defaultLimit;
   const principal=req.deviceId?('device:'+req.deviceId):req.user?.uid?('user:'+req.user.uid):('ip:'+(req.ip??'unknown'));
   const window=Math.floor(now()/60_000);
   const key=createHash('sha256').update(kind+'|'+principal+'|'+window).digest('hex');
   const ref=firebase().db.collection('_rateLimitWindows').doc(key);
   const accepted=await firebase().db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref),current=snapshot.exists?(snapshot.data().count??0):0;
    if(current>=limit)return false;
    tx.set(ref,{kind,count:current+1,expiresAt:Timestamp.fromMillis((window+2)*60_000)},{merge:true});
    return true;
   });
   if(!accepted){res.set('Retry-After',String(Math.max(1,Math.ceil(((window+1)*60_000-now())/1000))));throw httpError('RATE_LIMITED',429)}
   next();
  }catch(error){next(error)}
 };
}
// Only structured metadata reaches stdout/stderr. Do not print request URLs,
// Firebase tokens, raw query parameters, body, IP, or error.message.
export function errorHandler(err,req,res,next){
 if(res.headersSent)return next(err);
 const status=err.status??(err.code==='auth/id-token-expired'?401:err.code?.startsWith('auth/')?401:500);
 const code=status===500?'INTERNAL_ERROR':err.code??'BAD_REQUEST';
 const log={timestamp:new Date().toISOString(),requestId:req.requestId??'n/a',
  method:req.method??'unknown',status,code,route:req.route?.path??'unmatched'};
 if(status>=500)console.error(JSON.stringify(log));
 else if(status>=400)console.warn(JSON.stringify(log));
 res.status(status).json({error:{code,message:status===500?'Unexpected API error':(err.message??code),requestId:req.requestId,...(err.details?{details:err.details}:{})}});
}
