import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {firebase} from './firebase.js';
import {makeKey,keyHash,keysEqual,httpError} from './domain.js';
import {validate} from './schemas.js';
const lifetimeMs=30*24*60*60*1000;
const installation=z.string().regex(/^[A-Za-z0-9_-]{16,100}$/);
const proof=z.string().min(32).max(128);
const creation=z.object({installationId:installation}).strict();
const authenticated=z.object({sessionSecret:proof}).strict();
const sessionId=z.string().uuid();
const expiry=()=>new Date(Date.now()+lifetimeMs).toISOString();
const secureHash=secret=>keyHash('pushSession:v1:'+secret,process.env.DEVICE_KEY_PEPPER);
const refs=(db,id,installationId)=>({session:db.collection('pushSessions').doc(id),
 installation:installationId?db.collection('pushInstallations').doc(installationId):null});
export async function requirePushSession(db,uid,id,secret){
 if(!id||!secret)throw httpError('SESSION_REQUIRED',403);
 validate(sessionId,id);validate(proof,secret);
 const session=await db.collection('pushSessions').doc(id).get();
 if(!session.exists||session.data().uid!==uid||session.data().state!=='ACTIVE'||
  Date.parse(session.data().expiresAt)<=Date.now()||
  !keysEqual(session.data().secretHash,secureHash(secret)))throw httpError('SESSION_REVOKED',403);
 const pointer=await db.collection('pushInstallations').doc(session.data().installationId).get();
 if(!pointer.exists||pointer.data().sessionId!==id||pointer.data().uid!==uid)
  throw httpError('SESSION_REVOKED',403);
 return session.data();
}
export async function createPushSession(req,res){
 const {installationId}=validate(creation,req.body);
 const {db}=firebase(),id=randomUUID(),secret=makeKey(),expiresAt=expiry();
 const {session,installation:installRef}=refs(db,id,installationId);
 await db.runTransaction(async tx=>{
  const previous=await tx.get(installRef);
  const priorRef=previous.exists&&previous.data().sessionId
   ?db.collection('pushSessions').doc(previous.data().sessionId):null;
  const prior=priorRef?await tx.get(priorRef):null;
  if(prior?.exists)tx.update(priorRef,{state:'REVOKED',revokedAt:new Date().toISOString(),reason:'INSTALLATION_REPLACED'});
  tx.create(session,{uid:req.user.uid,installationId,state:'ACTIVE',secretHash:secureHash(secret),
   createdAt:new Date().toISOString(),expiresAt});
  tx.set(installRef,{uid:req.user.uid,sessionId:id,updatedAt:new Date().toISOString()});
 });
 res.status(201).json({sessionId:id,sessionSecret:secret,expiresAt});
}
export async function refreshPushSession(req,res){
 const id=validate(sessionId,req.params.sessionId),{sessionSecret}=validate(authenticated,req.body),db=firebase().db;
 await requirePushSession(db,req.user.uid,id,sessionSecret);
 const {session}=refs(db,id);
 const expiresAt=expiry();
 await db.runTransaction(async tx=>{
  const snap=await tx.get(session);
  if(!snap.exists||snap.data().uid!==req.user.uid||snap.data().state!=='ACTIVE'||
   Date.parse(snap.data().expiresAt)<=Date.now()||
   !keysEqual(snap.data().secretHash,secureHash(sessionSecret)))throw httpError('SESSION_REVOKED',403);
  const ptr=await tx.get(db.collection('pushInstallations').doc(snap.data().installationId));
  if(!ptr.exists||ptr.data().sessionId!==id)throw httpError('SESSION_REVOKED',403);
  tx.update(session,{expiresAt,refreshedAt:new Date().toISOString()});
 });
 res.json({sessionId:id,expiresAt});
}
export async function revokePushSession(req,res){
 const id=validate(sessionId,req.params.sessionId),{sessionSecret}=validate(authenticated,req.body),db=firebase().db;
 const session=db.collection('pushSessions').doc(id);
 await db.runTransaction(async tx=>{
  const snap=await tx.get(session);
  if(!snap.exists||snap.data().uid!==req.user.uid||
   !keysEqual(snap.data().secretHash,secureHash(sessionSecret)))throw httpError('SESSION_REVOKED',403);
  if(snap.data().state==='ACTIVE')tx.update(session,{state:'REVOKED',revokedAt:new Date().toISOString(),reason:'LOGOUT'});
 });
 res.json({revoked:true});
}
export async function isEligiblePushSession(db,token){
 if(!token.sessionId)return false;
 const s=await db.collection('pushSessions').doc(token.sessionId).get();
 if(!s.exists||s.data().uid!==token.uid||s.data().state!=='ACTIVE'||
  Date.parse(s.data().expiresAt)<=Date.now())return false;
 const i=await db.collection('pushInstallations').doc(s.data().installationId).get();
 return i.exists&&i.data().sessionId===token.sessionId&&i.data().uid===token.uid;
}
