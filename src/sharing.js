import {firebase} from './firebase.js';
import {httpError} from './domain.js';
import {validate,deviceId,inviteViewer as invitationSchema} from './schemas.js';
const now=()=>new Date().toISOString();
const refs=(db,id,uid)=>({device:db.collection('devices').doc(id),invite:db.collection('devices').doc(id).collection('invitations').doc(uid),
 viewer:db.collection('devices').doc(id).collection('viewers').doc(uid),
 incoming:db.collection('users').doc(uid).collection('invitations').doc(id),
 shared:db.collection('users').doc(uid).collection('sharedDevices').doc(id)});

export async function inviteViewer(req,res){
 const id=validate(deviceId,req.params.deviceId),{email}=validate(invitationSchema,req.body);
 const {auth,db}=firebase();let target;
 try{target=await auth.getUserByEmail(email)}catch(e){if(e.code==='auth/user-not-found')throw httpError('INVITEE_NOT_FOUND',404);throw e}
 if(!target.emailVerified)throw httpError('INVITEE_EMAIL_NOT_VERIFIED',403);
 if(target.uid===req.user.uid)throw httpError('CANNOT_INVITE_OWNER',409);
 const profile=await db.collection('users').doc(target.uid).get();
 if(!profile.exists||profile.data().status!=='ACTIVE')throw httpError('INVITEE_NOT_ACTIVE',403);
 const {device,invite,incoming,viewer}=refs(db,id,target.uid);
 await db.runTransaction(async tx=>{
  const [d,v]=await Promise.all([tx.get(device),tx.get(viewer)]);
  if(!d.exists||d.data().ownerUid!==req.user.uid)throw httpError('FORBIDDEN',403);
  if(v.exists&&v.data().status==='ACTIVE')throw httpError('ALREADY_SHARED',409);
  const pending={deviceId:id,ownerUid:req.user.uid,inviteeUid:target.uid,email:target.email.toLowerCase(),status:'PENDING',invitedAt:now()};
  tx.set(invite,pending);tx.set(incoming,pending);
 });
 res.status(201).json({deviceId:id,email:target.email.toLowerCase(),status:'PENDING'});
}
export async function myInvitations(req,res){
 const docs=await firebase().db.collection('users').doc(req.user.uid).collection('invitations').get();
 res.json({items:docs.docs.filter(d=>d.data().status==='PENDING').map(d=>({deviceId:d.id,invitedAt:d.data().invitedAt}))});
}
export async function acceptInvitation(req,res){
 const id=validate(deviceId,req.params.deviceId),db=firebase().db,uid=req.user.uid;
 const {device,invite,incoming,viewer,shared}=refs(db,id,uid);
 await db.runTransaction(async tx=>{
  const [d,i]=await Promise.all([tx.get(device),tx.get(invite)]);
  if(!d.exists||!i.exists||i.data().status!=='PENDING'||i.data().ownerUid!==d.data().ownerUid||!d.data().ownerUid)throw httpError('INVITATION_NOT_FOUND',404);
  const acceptedAt=now();
  tx.set(viewer,{uid,status:'ACTIVE',invitedBy:d.data().ownerUid,acceptedAt});
  tx.set(shared,{deviceId:id,ownerUid:d.data().ownerUid,acceptedAt});
  tx.update(invite,{status:'ACCEPTED',acceptedAt});tx.update(incoming,{status:'ACCEPTED',acceptedAt});
 });
 res.json({deviceId:id,access:'VIEWER'});
}
export async function revokeViewer(req,res){
 const id=validate(deviceId,req.params.deviceId),uid=validate(deviceId,req.params.viewerUid),db=firebase().db;
 const {device,invite,incoming,viewer,shared}=refs(db,id,uid);
 await db.runTransaction(async tx=>{
  const d=await tx.get(device);
  if(!d.exists||d.data().ownerUid!==req.user.uid)throw httpError('FORBIDDEN',403);
  if(uid===req.user.uid)throw httpError('CANNOT_REVOKE_OWNER',409);
  tx.delete(viewer);tx.delete(shared);
  tx.set(invite,{status:'REVOKED',revokedAt:now(),deviceId:id,inviteeUid:uid,ownerUid:req.user.uid},{merge:true});
  tx.set(incoming,{status:'REVOKED',revokedAt:now(),deviceId:id},{merge:true});
 });
 res.json({deviceId:id,viewerUid:uid,revoked:true});
}
