import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {firebase} from './firebase.js';
import {httpError} from './domain.js';
import {validate,deviceId,inviteViewer} from './schemas.js';
const expiresMs=24*60*60*1000;
const now=()=>new Date().toISOString();
const references=(db,id)=>({device:db.collection('devices').doc(id),
 transfer:db.collection('deviceTransfers').doc(id),
 audit:db.collection('devices').doc(id).collection('ownershipAudit').doc(randomUUID()),
 pairing:db.collection('devicePairings').doc(id)});
function assertPending(t,owner,uid){
 if(!t.exists||t.data().state!=='PENDING'||t.data().fromUid!==owner||t.data().toUid!==uid)
  throw httpError('TRANSFER_NOT_PENDING',409);
 if(Date.parse(t.data().expiresAt)<=Date.now())throw httpError('TRANSFER_EXPIRED',409);
}
// No physical button, recovery/admin role, QR credential, or device key can call
// these USER-authenticated endpoints. A signed-in current Owner authorizes
// the recipient and the verified recipient must independently accept.
export async function startTransfer(req,res){
 const id=validate(deviceId,req.params.deviceId),{email}=validate(inviteViewer,req.body);
 const {auth,db}=firebase();let target;
 try{target=await auth.getUserByEmail(email)}
 catch(e){if(e.code==='auth/user-not-found')throw httpError('RECIPIENT_NOT_FOUND',404);throw e}
 if(!target.emailVerified)throw httpError('RECIPIENT_NOT_VERIFIED',403);
 if(target.uid===req.user.uid)throw httpError('ALREADY_OWNER',409);
 const profile=await db.collection('users').doc(target.uid).get();
 if(!profile.exists||profile.data().status!=='ACTIVE')throw httpError('RECIPIENT_NOT_ACTIVE',403);
 const {device,transfer,audit}=references(db,id),idempotency=randomUUID(),expiresAt=new Date(Date.now()+expiresMs).toISOString();
 await db.runTransaction(async tx=>{
  const [d,t]=await Promise.all([tx.get(device),tx.get(transfer)]);
  if(!d.exists||d.data().ownerUid!==req.user.uid)throw httpError('FORBIDDEN',403);
  if(t.exists&&t.data().state==='PENDING'&&Date.parse(t.data().expiresAt)>Date.now())
   throw httpError('TRANSFER_ALREADY_PENDING',409);
  tx.set(transfer,{deviceId:id,fromUid:req.user.uid,toUid:target.uid,state:'PENDING',requestId:idempotency,
   requestedAt:now(),expiresAt});
  tx.create(audit,{type:'TRANSFER_REQUESTED',requestId:idempotency,actorUid:req.user.uid,recipientUid:target.uid,at:now()});
 });
 res.status(201).json({deviceId:id,requestId:idempotency,state:'PENDING',expiresAt});
}
export async function cancelTransfer(req,res){
 const id=validate(deviceId,req.params.deviceId),db=firebase().db;
 const {device,transfer,audit}=references(db,id);
 await db.runTransaction(async tx=>{
  const [d,t]=await Promise.all([tx.get(device),tx.get(transfer)]);
  if(!d.exists||d.data().ownerUid!==req.user.uid)throw httpError('FORBIDDEN',403);
  if(!t.exists||t.data().state!=='PENDING'||t.data().fromUid!==req.user.uid)
   throw httpError('TRANSFER_NOT_PENDING',409);
  tx.update(transfer,{state:'CANCELLED',cancelledAt:now()});
  tx.create(audit,{type:'TRANSFER_CANCELLED',requestId:t.data().requestId,actorUid:req.user.uid,at:now()});
 });
 res.json({deviceId:id,state:'CANCELLED'});
}
export async function acceptTransfer(req,res){
 const id=validate(deviceId,req.params.deviceId),{requestId}=validate(
  z.object({requestId:deviceId}).strict(),req.body);
 const {auth,db}=firebase();
 const identity=await auth.getUser(req.user.uid);
 if(!identity.emailVerified||!identity.email)throw httpError('EMAIL_NOT_VERIFIED',403);
 const profile=await db.collection('users').doc(req.user.uid).get();
 if(!profile.exists||profile.data().status!=='ACTIVE')throw httpError('RECIPIENT_NOT_ACTIVE',403);
 const {device,transfer,audit,pairing}=references(db,id);
 try{await db.runTransaction(async tx=>{
  const [d,t]=await Promise.all([tx.get(device),tx.get(transfer)]);
  if(!d.exists||!d.data().ownerUid)throw httpError('NOT_FOUND',404);
  assertPending(t,d.data().ownerUid,req.user.uid);
  if(t.data().requestId!==requestId)throw httpError('TRANSFER_NOT_PENDING',409);
  // Device ownership and consumed transfer are changed in the SAME transaction.
  // Old accepted Viewers are rejected by accessLevel because invitedBy no longer
  // matches ownerUid. Historical telemetry, alerts and credentials remain intact.
  tx.update(device,{ownerUid:req.user.uid,ownedAt:now()});
  tx.update(transfer,{state:'ACCEPTED',acceptedAt:now()});
  tx.delete(pairing);
  tx.create(audit,{type:'TRANSFER_ACCEPTED',requestId,actorUid:req.user.uid,previousOwnerUid:t.data().fromUid,at:now()});
 });}catch(error){
  // Concurrent accept attempts may exhaust emulator/Firestore transaction
  // retries. Treat ABORTED as a conflict, never as a successful transfer.
  if(error?.code===10||error?.code==='ABORTED'||error?.code==='aborted')
   throw httpError('TRANSFER_CONFLICT',409);
  throw error;
 }
 res.json({deviceId:id,state:'ACCEPTED',access:'OWNER'});
}
export async function incomingTransfers(req,res){
 const docs=await firebase().db.collection('deviceTransfers').where('toUid','==',req.user.uid).get();
 res.json({items:docs.docs.filter(d=>d.data().state==='PENDING'&&Date.parse(d.data().expiresAt)>Date.now())
  .map(d=>({deviceId:d.id,requestId:d.data().requestId,expiresAt:d.data().expiresAt}))});
}
