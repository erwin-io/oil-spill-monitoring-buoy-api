import {firebase} from './firebase.js';
import {httpError,keyHash,keysEqual,makeKey} from './domain.js';
import {validate,claimRequest,confirmClaim,deviceId} from './schemas.js';
import {queueRefresh} from './realtime-refresh.js';

const ttlMs=5*60*1000;
const stamp=()=>new Date().toISOString();
const hash=(purpose,secret)=>keyHash(`${purpose}:v1:${secret}`,process.env.DEVICE_KEY_PEPPER);
const refs=(db,id)=>({device:db.collection('devices').doc(id),credential:db.collection('deviceCredentials').doc(id),pairing:db.collection('devicePairings').doc(id)});

// Administrative recovery for a legacy or unclaimed buoy. This never changes
// the device upload credential or assigns an owner from the old ACL.
export async function reissueClaimCode(req,res){
 const id=validate(deviceId,req.params.deviceId),code=makeKey(),db=firebase().db;
 const {device,credential,pairing}=refs(db,id);
 await db.runTransaction(async tx=>{
  const [d,c]=await Promise.all([tx.get(device),tx.get(credential)]);
  if(!d.exists||!c.exists)throw httpError('NOT_FOUND',404);
  if(d.data().ownerUid)throw httpError('ALREADY_OWNED',409);
  tx.update(credential,{claimCodeHash:hash('claim',code),claimCodeVersion:(c.data().claimCodeVersion??0)+1,claimCodeIssuedAt:stamp()});
  tx.delete(pairing);
 });
 res.json({deviceId:id,claimCode:code,warning:'Update the protected internal QR. The former claim code and challenge are invalid; the upload key is unchanged.'});
}

// Firmware MUST call this only after a separate physical PAIR button press;
// possession of the HTTPS upload key alone must not trigger PAIR mode.
export async function startPairing(req,res){
 const id=req.deviceId,challengeId=makeKey(),nonce=makeKey(),db=firebase().db;
 const {device,credential,pairing}=refs(db,id),expiresAt=Date.now()+ttlMs;
 await db.runTransaction(async tx=>{
  const [d,c,v2]=await Promise.all([tx.get(device),tx.get(credential),tx.get(db.collection('devicePairIntents').doc(id))]);
  if(!d.exists||d.data().ownerUid)throw httpError('ALREADY_OWNED',409);
  if(v2.exists&&v2.data().expiresAt>Date.now()&&['WAITING_FOR_PAIR','PENDING','CONFLICT'].includes(v2.data().state))
   throw httpError('PAIRING_PROTOCOL_CONFLICT',409);
  if(!c.exists||!c.data().claimCodeHash)throw httpError('CLAIM_CODE_REQUIRED',409);
  tx.set(pairing,{challengeId,nonceHash:hash('pair',nonce),claimCodeVersion:c.data().claimCodeVersion,
   expiresAt,state:'OPEN',candidateUid:null,createdAt:stamp()});
 });
 res.status(201).json({deviceId:id,challengeId,nonce,expiresAt:new Date(expiresAt).toISOString()});
}

export async function requestClaim(req,res){
 const id=validate(deviceId,req.params.deviceId),{challengeId,claimCode}=validate(claimRequest,req.body);
 const db=firebase().db,{device,credential,pairing}=refs(db,id);let selectedChallengeId;
 await db.runTransaction(async tx=>{
  const [d,c,p]=await Promise.all([tx.get(device),tx.get(credential),tx.get(pairing)]);
  if(!d.exists||!c.exists)throw httpError('NOT_FOUND',404);
  if(d.data().ownerUid)throw httpError('ALREADY_OWNED',409);
  if(!p.exists||challengeId&&p.data().challengeId!==challengeId||p.data().expiresAt<=Date.now())throw httpError('CHALLENGE_EXPIRED',409);
  if(p.data().state!=='OPEN'||p.data().candidateUid)throw httpError('CLAIM_ALREADY_PENDING',409);
  if(p.data().claimCodeVersion!==c.data().claimCodeVersion||!c.data().claimCodeHash||
   !keysEqual(hash('claim',claimCode),c.data().claimCodeHash))throw httpError('INVALID_CLAIM_CODE',403);
  selectedChallengeId=p.data().challengeId;
  tx.update(pairing,{state:'PENDING',candidateUid:req.user.uid,requestedAt:stamp()});
 });
 res.status(202).json({deviceId:id,challengeId:selectedChallengeId,state:'PENDING'});
}

// The buoy confirms the candidate displayed in its own pairing flow. The
// candidate cannot self-confirm; both device credentials and nonce are needed.
export async function confirmPairing(req,res){
 const id=req.deviceId,{challengeId,nonce}=validate(confirmClaim,req.body),db=firebase().db;
 const {device,credential,pairing}=refs(db,id);let ownerUid;
 await db.runTransaction(async tx=>{
  const [d,c,p,v2]=await Promise.all([tx.get(device),tx.get(credential),tx.get(pairing),tx.get(db.collection('devicePairIntents').doc(id))]);
  if(v2.exists&&v2.data().expiresAt>Date.now()&&['WAITING_FOR_PAIR','PENDING','CONFLICT'].includes(v2.data().state))
   throw httpError('PAIRING_PROTOCOL_CONFLICT',409);
  if(!d.exists||!c.exists||!p.exists||p.data().challengeId!==challengeId||p.data().expiresAt<=Date.now())throw httpError('CHALLENGE_EXPIRED',409);
  if(d.data().ownerUid)throw httpError('ALREADY_OWNED',409);
  if(p.data().state!=='PENDING'||!p.data().candidateUid||p.data().claimCodeVersion!==c.data().claimCodeVersion)throw httpError('CLAIM_NOT_PENDING',409);
  if(!keysEqual(hash('pair',nonce),p.data().nonceHash))throw httpError('INVALID_PAIRING_NONCE',403);
  ownerUid=p.data().candidateUid;
  tx.update(device,{ownerUid,ownedAt:stamp()});
  tx.update(credential,{claimCodeHash:null,claimCodeConsumedAt:stamp()});
  tx.update(pairing,{state:'CONFIRMED',confirmedAt:stamp(),nonceHash:null});
  queueRefresh(tx,db,{deviceId:id,resource:'ownership'});
  queueRefresh(tx,db,{uid:ownerUid,resource:'ownership'});
 });
 req.cacheAffectedUsers=[ownerUid];
 res.json({deviceId:id,challengeId,state:'CONFIRMED'});
}

export async function pairingStatus(req,res){
 const id=validate(deviceId,req.params.deviceId),challengeId=validate(deviceId,req.params.challengeId);
 const db=firebase().db,p=await db.collection('devicePairings').doc(id).get();
 if(!p.exists||p.data().challengeId!==challengeId||p.data().candidateUid!==req.user.uid)throw httpError('NOT_FOUND',404);
 res.json({deviceId:id,challengeId,state:p.data().expiresAt<=Date.now()&&p.data().state!=='CONFIRMED'?'EXPIRED':p.data().state,
  expiresAt:new Date(p.data().expiresAt).toISOString()});
}
