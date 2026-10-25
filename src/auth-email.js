import {createHash} from 'node:crypto';
import {firebase} from './firebase.js';
import {httpError} from './domain.js';
import {Timestamp} from 'firebase-admin/firestore';
import {mailConfigReady,mailReadiness,sendTransactionalEmail} from './mail-transport.js';

// Admin-generated action codes remain single-use Firebase credentials.
// They are never logged or passed through the BlueGuard Android App Link.
const HOST='oil-spill-monitoring-buoy.firebaseapp.com';
const MODES=new Set(['verifyEmail','resetPassword']);
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}$/;
const required=()=>[
  'P2_FIREBASE_WEB_API_KEY','FIREBASE_PROJECT_ID','DEVICE_KEY_PEPPER'
].every(name=>typeof process.env[name]==='string'&&process.env[name].trim().length>0&&!/^REPLACE_WITH|^YOUR_/i.test(process.env[name].trim()));
export function authEmailEnabled(){
 return process.env.P2_AUTH_EMAIL_ENABLED==='true'&&required()&&mailConfigReady()&&
  process.env.DEVICE_KEY_PEPPER.length>=32&&
  process.env.FIREBASE_PROJECT_ID==='oil-spill-monitoring-buoy';
}
export function actionSettings(mode){
 if(!MODES.has(mode))throw Error('UNSUPPORTED_ACTION');
 return {
  url:'https://'+HOST+'/open/'+(mode==='verifyEmail'?'email-verified':'password-reset-complete'),
  handleCodeInApp:false,
 };
}
export function emailAddress(value){
 if(typeof value!=='string'||value.length>254||!EMAIL.test(value.trim())||value.includes('\n'))
  throw httpError('INVALID_EMAIL',422);
 return value.trim().toLowerCase();
}
export function customActionUrl(generated,mode,expectedKey){
 if(!MODES.has(mode)||!expectedKey)throw Error('INVALID_ACTION_CONFIG');
 let url;
 try{url=new URL(generated)}catch{throw Error('INVALID_GENERATED_LINK')}
 if(url.protocol!=='https:'||url.hostname!==HOST||url.pathname!=='/__/auth/action'||
   url.username||url.password||url.hash)throw Error('UNEXPECTED_FIREBASE_LINK');
 const p=url.searchParams;
 for(const key of ['mode','oobCode','apiKey'])
  if(p.getAll(key).length!==1)throw Error('INVALID_FIREBASE_LINK_PARAMETERS');
 if(p.get('mode')!==mode||p.get('apiKey')!==expectedKey)throw Error('FIREBASE_LINK_IDENTITY_MISMATCH');
 const code=p.get('oobCode');
 if(!code||code.length>4096)throw Error('INVALID_ACTION_CODE');
 // Copy only Firebase-issued fields required for code verification.
 // Never pass continueUrl, email, token or arbitrary redirect URI to handler.
 const safe=new URL('https://'+HOST+'/auth/action');
 safe.searchParams.set('mode',mode);
 safe.searchParams.set('oobCode',code);
 safe.searchParams.set('apiKey',expectedKey);
 return safe.toString();
}
// Native-only HTTPS App Link: Android's verified host opens BlueGuard and
// the mobile Firebase SDK verifies the single-use code. This URL is a bearer
// credential and must never be logged, reflected in an API response, or stored
// in a navigation history. Existing /auth/action web links remain valid.
export function nativeActionUrl(generated,mode,expectedKey){
 const parsed=new URL(customActionUrl(generated,mode,expectedKey));
 parsed.pathname='/open/auth-action';
 return parsed.toString();
}
export async function sendAuthAction(recipient,mode,link,options={}){
 if(!authEmailEnabled())throw httpError('AUTH_EMAIL_NOT_CONFIGURED',503);
 const subject=mode==='verifyEmail'?'Verify your BlueGuard Buoy email':'Reset your BlueGuard Buoy password';
 const text=mode==='verifyEmail'
  ?'Open this secure, one-time link on your Android phone with BlueGuard Buoy installed to verify your email:\n\n'+link+
    '\n\nBlueGuard Buoy opens to finish verification. Do not forward this link. Ignore this message if you did not register.'
  :'Open this secure, one-time link on your Android phone with BlueGuard Buoy installed to reset your password inside the app:\n\n'+link+
    '\n\nEnter your new password only inside the BlueGuard Buoy app; then sign in. Do not forward this link. Ignore this email if you did not request it.';
 return sendTransactionalEmail({to:recipient,subject,text},options);
}
// Preserve the earlier exported method name for test clients and callers.
// It uses the selected provider; provider selection is explicit in .env.
export const sendResendAction=(recipient,mode,link,fetchImpl=fetch)=>
 sendAuthAction(recipient,mode,link,{fetch:fetchImpl});
// Independent per-UID/email quota, effective across API instances. No plaintext
// email in Firestore and no successful-delivery status exposed to reset callers.
export async function hourlyEmailQuota(db,identity,limit=3){
 const key=createHash('sha256').update('blueguard:auth-email:v1:'+identity+
   ':'+Math.floor(Date.now()/3600000)+':'+process.env.DEVICE_KEY_PEPPER).digest('hex');
 const ref=db.collection('_rateLimitWindows').doc(key);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref),count=snap.exists?(snap.data().count??0):0;
  if(count>=limit)return false;
  const now=Date.now();
  tx.set(ref,{kind:'auth_email',count:count+1,expiresAt:Timestamp.fromMillis(now+2*3600000)});
  return true;
 });
}
export function authEmailConfig(_req,res){
 res.json({delivery:authEmailEnabled()?mailReadiness():'firebase'});
}
export async function unverifiedIdentity(req,res,next){
 try{
  const match=/^Bearer (\S+)$/i.exec(req.get('authorization')??'');
  if(!match)throw httpError('AUTH_REQUIRED',401);
  const {auth}=firebase(),claims=await auth.verifyIdToken(match[1],true);
  const identity=await auth.getUser(claims.uid);
  if(identity.disabled||!identity.email||!claims.email||
   identity.email.toLowerCase()!==claims.email.toLowerCase()||
   claims.firebase?.sign_in_provider!=='password')
   throw httpError('ACCOUNT_NOT_ELIGIBLE',403);
  req.emailIdentity={uid:identity.uid,email:identity.email,emailVerified:identity.emailVerified};
  next();
 }catch(e){next(e)}
}
export async function requestVerification(req,res){
 if(!authEmailEnabled())throw httpError('AUTH_EMAIL_NOT_CONFIGURED',503);
 if(Object.keys(req.body||{}).length)throw httpError('UNEXPECTED_REQUEST_BODY',422);
 if(req.emailIdentity.emailVerified)return res.status(204).end();
 const {auth,db}=firebase(),identity=req.emailIdentity;
 if(!await hourlyEmailQuota(db,'uid:'+identity.uid))
  throw httpError('EMAIL_RATE_LIMITED',429);
 const source=await auth.generateEmailVerificationLink(identity.email,actionSettings('verifyEmail'));
 const link=nativeActionUrl(source,'verifyEmail',process.env.P2_FIREBASE_WEB_API_KEY);
 if(!await sendAuthAction(identity.email,'verifyEmail',link))
  throw httpError('EMAIL_DELIVERY_UNAVAILABLE',503);
 res.status(202).json({accepted:true});
}
export async function requestPasswordReset(req,res){
 if(!authEmailEnabled())throw httpError('AUTH_EMAIL_NOT_CONFIGURED',503);
 if(!req.body||Object.keys(req.body).length!==1||typeof req.body.email!=='string')
  throw httpError('INVALID_REQUEST',422);
 const email=emailAddress(req.body.email),{auth,db}=firebase();
 // The response is always identical for existing, absent, OAuth-only,
 // throttled and provider-failure cases. Do not expose account existence.
 if(await hourlyEmailQuota(db,'email:'+email)){
  try{
   const user=await auth.getUserByEmail(email);
   if(!user.disabled){
    const generated=await auth.generatePasswordResetLink(email,actionSettings('resetPassword'));
    const link=nativeActionUrl(generated,'resetPassword',process.env.P2_FIREBASE_WEB_API_KEY);
    await sendAuthAction(email,'resetPassword',link);
   }
  }catch{/* Deliberately non-enumerating: no email, code or provider diagnostics. */}
 }
 res.status(202).json({accepted:true});
}
