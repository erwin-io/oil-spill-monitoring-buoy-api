/**
 * BlueGuard pairing protocol v2. The QR reveals public identity only; it is
 * NOT proof of phone proximity. A spoofed early intent is a residual risk.
 * Competing authenticated intents fail closed (no first/last-wins selection).
 * Physical GPIO enforcement MUST be provided by trusted device firmware.
 *
 * Legacy claim-code pairing remains separately routed for existing clients.
 */
import {firebase} from './firebase.js';
import {makeKey,keyHash,keysEqual,httpError} from './domain.js';
import {validate,deviceId,createPairIntent,confirmPairIntent} from './schemas.js';
import {queueRefresh} from './realtime-refresh.js';

const TTL_MS=5*60*1000;
const stamp=()=>new Date().toISOString();
const secretHash=value=>keyHash('pair-v2:'+value,process.env.DEVICE_KEY_PEPPER);
const docs=(db,id)=>({
 device:db.collection('devices').doc(id),
 intent:db.collection('devicePairIntents').doc(id),
 legacy:db.collection('devicePairings').doc(id)
});
const active=(v,now)=>v&&v.expiresAt>now&&['WAITING_FOR_PAIR','PENDING','CONFLICT'].includes(v.state);
const publicState=(v,now)=>v.state==='CONFIRMED'||v.state==='CANCELLED'||v.state==='CONFLICT'?
 v.state:v.expiresAt<=now?'EXPIRED':v.state;
function checkDevice(snap){
 if(!snap.exists)throw httpError('DEVICE_NOT_FOUND',404);
 if(snap.data().ownerUid)throw httpError('ALREADY_OWNED',409);
 if(snap.data().status!=='ACTIVE')throw httpError('DEVICE_DISABLED',403);
}
function checkLegacy(snap,now){
 if(snap.exists&&snap.data().expiresAt>now&&['OPEN','PENDING'].includes(snap.data().state))
  throw httpError('PAIRING_PROTOCOL_CONFLICT',409);
}
function stateBody(id,v,now=Date.now()){
 return {deviceId:id,intentId:v.intentId,state:publicState(v,now),
   expiresAt:new Date(v.expiresAt).toISOString()};
}
export async function requestPairIntent(req,res){
 const id=validate(deviceId,req.params.deviceId);
 validate(createPairIntent,req.body??{});
 const db=firebase().db,{device,intent,legacy}=docs(db,id);
 const now=Date.now();let result,code=201,conflict=false;
 await db.runTransaction(async tx=>{
  const [d,p,old]=await Promise.all([tx.get(device),tx.get(intent),tx.get(legacy)]);
  checkDevice(d);checkLegacy(old,now);
  const previous=p.exists?p.data():null;
  if(active(previous,now)){
   if(previous.state==='CONFLICT'){conflict=true;return}
   if(previous.candidateUid===req.user.uid){
    result=stateBody(id,previous,now);code=200;return;
   }
   // Abort the first candidate's window as well; never select a winner.
   tx.update(intent,{state:'CONFLICT',challengeId:null,nonceHash:null,conflictedAt:stamp()});
   conflict=true;return;
  }
  const created={
   intentId:makeKey(),candidateUid:req.user.uid,state:'WAITING_FOR_PAIR',
   createdAt:stamp(),expiresAt:now+TTL_MS,challengeId:null,nonceHash:null
  };
  tx.set(intent,created);result=stateBody(id,created,now);
 });
 if(conflict)throw httpError('PAIRING_CONFLICT',409);
 res.status(code).json(result);
}

export async function pairIntentStatus(req,res){
 const id=validate(deviceId,req.params.deviceId),intentId=validate(deviceId,req.params.intentId);
 const db=firebase().db,{intent,device}=docs(db,id);
 const [p,d]=await Promise.all([intent.get(),device.get()]);
 if(!p.exists||p.data().intentId!==intentId||p.data().candidateUid!==req.user.uid)throw httpError('NOT_FOUND',404);
 const value=stateBody(id,p.data());
 // A historical success must not imply ongoing authorization after transfer.
 if(value.state==='CONFIRMED'&&d.data()?.ownerUid!==req.user.uid)value.state='ALREADY_OWNED';
 res.set('Cache-Control','no-store');
 res.json(value);
}
export async function cancelPairIntent(req,res){
 const id=validate(deviceId,req.params.deviceId),intentId=validate(deviceId,req.params.intentId);
 const db=firebase().db,{intent}=docs(db,id);let result;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(intent);
  if(!snap.exists||snap.data().intentId!==intentId||snap.data().candidateUid!==req.user.uid)throw httpError('NOT_FOUND',404);
  if(snap.data().state==='CONFIRMED')throw httpError('ALREADY_CONFIRMED',409);
  const data={...snap.data(),state:'CANCELLED',challengeId:null,nonceHash:null,cancelledAt:stamp()};
  tx.update(intent,{state:data.state,challengeId:null,nonceHash:null,cancelledAt:data.cancelledAt});
  result=stateBody(id,data);
 });
 res.set('Cache-Control','no-store');res.json(result);
}
export async function deviceStartPairing(req,res){
 const id=req.deviceId,db=firebase().db,{device,intent,legacy}=docs(db,id);
 const challengeId=makeKey(),nonce=makeKey(),now=Date.now();
 let result;
 await db.runTransaction(async tx=>{
  const [d,p,old]=await Promise.all([tx.get(device),tx.get(intent),tx.get(legacy)]);
  checkDevice(d);checkLegacy(old,now);
  if(!p.exists||p.data().expiresAt<=now)throw httpError('PAIR_INTENT_REQUIRED',409);
  if(!['WAITING_FOR_PAIR','PENDING'].includes(p.data().state))throw httpError('PAIRING_CONFLICT',409);
  const data={...p.data(),state:'PENDING',challengeId,nonceHash:secretHash(nonce),pairedAt:stamp()};
  tx.update(intent,{state:data.state,challengeId,nonceHash:data.nonceHash,pairedAt:data.pairedAt});
  result={protocol:2,deviceId:id,intentId:data.intentId,challengeId,nonce,expiresAt:new Date(data.expiresAt).toISOString()};
 });
 res.status(201).json(result);
}
export async function deviceConfirmPairing(req,res){
 const {intentId,challengeId,nonce}=validate(confirmPairIntent,req.body);
 const id=req.deviceId,db=firebase().db,{device,intent}=docs(db,id);let uid;
 await db.runTransaction(async tx=>{
  const [d,p]=await Promise.all([tx.get(device),tx.get(intent)]);
  checkDevice(d);
  if(!p.exists||p.data().intentId!==intentId||p.data().challengeId!==challengeId||
     p.data().expiresAt<=Date.now())throw httpError('CHALLENGE_EXPIRED',409);
  if(p.data().state!=='PENDING'||!p.data().candidateUid||!p.data().nonceHash)
   throw httpError('PAIRING_NOT_PENDING',409);
  if(!keysEqual(secretHash(nonce),p.data().nonceHash))throw httpError('INVALID_PAIRING_NONCE',403);
  uid=p.data().candidateUid;
  // Do not assign a suspended account that has ceased to be eligible.
  const person=await tx.get(db.collection('users').doc(uid));
  if(!person.exists||person.data().status!=='ACTIVE')throw httpError('ACCOUNT_DISABLED',403);
  tx.update(device,{ownerUid:uid,ownedAt:stamp()});
  tx.update(intent,{state:'CONFIRMED',nonceHash:null,challengeId:null,confirmedAt:stamp()});
  queueRefresh(tx,db,{deviceId:id,resource:'ownership'});
  queueRefresh(tx,db,{uid,resource:'ownership'});
 });
 req.cacheAffectedUsers=[uid];
 res.json({protocol:2,deviceId:id,intentId,challengeId,state:'CONFIRMED'});
}
