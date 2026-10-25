#!/usr/bin/env node
/**
 * Single-command, local-only, interactive reset of ONE Firebase Auth test
 * account and its ACTIVE BlueGuard Phase 2 account/FCM data.
 *
 * Not a factory reset. Does not unclaim/re-provision buoys, erase incident
 * history, edit other users, modify device credentials, or delete telemetry.
 * No network endpoint is exposed by this script.
 */
import 'dotenv/config';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {firebase} from '../src/firebase.js';
import {removeAvatarFromProvider} from '../src/avatar.js';
import {eligibleForReset,requireExactConfirmation,assertBounded,MAX_SCAN,MAX_DELETE,policy} from '../src/user-reset-policy.js';

const rl=createInterface({input:stdin,output:stdout});
const reportDir=join(process.cwd(),'.test-output','user-reset');
mkdirSync(reportDir,{recursive:true});
const started=new Date().toISOString();
const report={startedAt:started,mode:'OWNER-CONFIRMED_SINGLE_ACCOUNT_DESTRUCTIVE_RESET',
 outcome:'NOT_STARTED', projectId:null, target:null, counts:{}, retained:policy.retainedCollections,
 deleted:{}, errors:[]};
function save(){
 const filename='reset-'+started.replace(/[:.]/g,'-')+'.json';
 writeFileSync(join(reportDir,filename),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log('Local-only report: '+join(reportDir,filename));
}
const validEmail=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const fail=message=>{throw new Error(message)};
const dbEmail=e=>String(e||'').trim().toLowerCase();
function register(map,ref,type){
 if(!map.has(ref.path))map.set(ref.path,{ref,type});
}
async function queryBy(collection,field,uid,limit=MAX_SCAN){
 const docs=await collection.where(field,'==',uid).limit(limit+1).get();
 if(docs.size>limit)fail('SCAN_LIMIT_REACHED: '+collection.path+' '+field);
 return docs.docs;
}
async function enumerateDevices(db,uid,map){
 const owned=[];let cursor=null,scanned=0;
 while(true){
  let q=db.collection('devices').orderBy('__name__').limit(150);
  if(cursor)q=q.startAfter(cursor);
  const page=await q.get();
  if(page.empty)break;
  scanned+=page.size;
  if(scanned>MAX_SCAN)fail('DEVICE_INVENTORY_TOO_LARGE: refuses destructive operation without a dedicated migration plan');
  // Query the exact per-device UID document IDs, never delete unrelated viewer records.
  const lookups=[];
  for(const d of page.docs){
   if(d.data().ownerUid===uid)owned.push(d.id);
   lookups.push(d.ref.collection('viewers').doc(uid),d.ref.collection('invitations').doc(uid));
  }
  for(let i=0;i<lookups.length;i+=100){
   const snaps=await db.getAll(...lookups.slice(i,i+100));
   for(const snap of snaps)if(snap.exists){
    const isViewer=snap.ref.parent.id==='viewers';
    const match=isViewer
      ?(snap.id===uid && snap.data().uid===uid)
      :(snap.id===uid && snap.data().inviteeUid===uid);
    if(!match)fail('UNEXPECTED_DEVICE_SCOPE: '+snap.ref.path);
    register(map,snap.ref,isViewer?'viewer-access':'incoming-device-invitation');
   }
  }
  cursor=page.docs.at(-1);
  if(page.size<150)break;
 }
 return {owned,scanned};
}
async function discover(db,uid){
 const map=new Map();
 const deviceInventory=await enumerateDevices(db,uid,map);
 const sessions=await queryBy(db.collection('pushSessions'),'uid',uid);
 const installations=await queryBy(db.collection('pushInstallations'),'uid',uid);
 const tokens=await queryBy(db.collection('notificationTokens'),'uid',uid);
 const pairings=await queryBy(db.collection('devicePairings'),'candidateUid',uid);
 const pendingTransfers=[];
 const transferDocs=new Map();
 for(const field of ['toUid','fromUid']){
  for(const d of await queryBy(db.collection('deviceTransfers'),field,uid))transferDocs.set(d.ref.path,d);
 }
 let historicTransfers=0;
 for(const d of transferDocs.values()){
  if(d.data().state==='PENDING'){
   pendingTransfers.push(d);
   register(map,d.ref,'pending-transfer');
  }else historicTransfers++;
 }
 for(const d of sessions)register(map,d.ref,'push-session');
 for(const d of installations)register(map,d.ref,'push-installation');
 for(const d of tokens)register(map,d.ref,'fcm-token');
 for(const d of pairings){
  const device=await db.collection('devices').doc(d.id).get();
  if(device.exists&&device.data().ownerUid)
   fail('PAIRING_REFERENCES_OWNED_BUOY: '+d.id);
  register(map,d.ref,'pending-physical-pairing');
 }
 // Delivery receipts are keyed by SHA256 token document ID under each outbox job.
 // Explicitly find and remove only this user's receipts, not shared outbox jobs.
 const tokenIds=tokens.map(t=>t.id);
 let outboxCount=0,personalOutbox=0,receipts=0;
 let cursor=null;
 while(true){
  let q=db.collection('notificationOutbox').orderBy('__name__').limit(100);
  if(cursor)q=q.startAfter(cursor);
  const page=await q.get();
  if(page.empty)break;
  outboxCount+=page.size;
  if(outboxCount>MAX_SCAN)fail('OUTBOX_SCAN_LIMIT_REACHED: require reviewed migration process for large datasets');
  for(const job of page.docs){
   if(job.data().payload?.uid===uid && job.data().type==='alert.acknowledged'){
    // These are solely user-targeted realtime acknowledgement delivery jobs.
    register(map,job.ref,'personal-outbox');
    personalOutbox++;
    continue;
   }
   for(const tokenId of tokenIds){
    const receipt=job.ref.collection('fcmReceipts').doc(tokenId);
    if((await receipt.get()).exists){
     register(map,receipt,'fcm-delivery-receipt');
     receipts++;
    }
   }
  }
  cursor=page.docs.at(-1);
  if(page.size<100)break;
 }
 const historicAcknowledgements=await queryBy(db.collection('alerts'),'acknowledgedBy',uid);
 assertBounded([...map.values()],MAX_DELETE);
 return {
  map,owned:deviceInventory.owned,scannedDevices:deviceInventory.scanned,
  scannedOutbox:outboxCount,tokenIds:tokenIds.length,
  historicTransfers,historicAcknowledgements:historicAcknowledgements.length,
  personalOutbox,receipts
 };
}
async function purgeRef(entry,uid,db){
 const snap=await entry.ref.get();
 if(!snap.exists)return false;
 const data=snap.data(),ref=entry.ref;
 switch(entry.type){
  case 'fcm-token':
  case 'push-session':
  case 'push-installation':
   if(data.uid!==uid)fail('SCOPE_CHANGED: '+ref.path);
   break;
  case 'viewer-access':
   if(ref.id!==uid||data.uid!==uid)fail('SCOPE_CHANGED: '+ref.path);
   break;
  case 'incoming-device-invitation':
   if(ref.id!==uid||data.inviteeUid!==uid)fail('SCOPE_CHANGED: '+ref.path);
   break;
  case 'pending-transfer':
   if(data.state!=='PENDING'||(data.fromUid!==uid&&data.toUid!==uid))
    fail('TRANSFER_CHANGED: '+ref.path);
   break;
  case 'pending-physical-pairing': {
   if(data.candidateUid!==uid)fail('PAIRING_CHANGED: '+ref.path);
   const device=await db.collection('devices').doc(ref.id).get();
   if(device.exists&&device.data().ownerUid)fail('PAIRING_BUOY_NOW_OWNED: '+ref.id);
   break;
  }
  case 'personal-outbox':
   if(data.type!=='alert.acknowledged'||data.payload?.uid!==uid)
    fail('OUTBOX_CHANGED: '+ref.path);
   break;
  case 'fcm-delivery-receipt':
   // Parent notification token was checked before scanning and only its
   // hashed token ID is used to locate this exact receipt.
   break;
  default:fail('UNSUPPORTED_RESET_TYPE');
 }
 // Delete descendant collections when deleting an entire personal outbox job.
 if(entry.type==='personal-outbox')await db.recursiveDelete(ref);
 else await ref.delete();
 return true;
}
async function main(){
 const raw=(await rl.question('Firebase test-account email to remove (exact email): ')).trim();
 const email=dbEmail(raw);
 if(!validEmail(email))fail('INVALID_EMAIL');
 if(!process.env.FIREBASE_PROJECT_ID)fail('Set FIREBASE_PROJECT_ID in ignored .env before running');
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)
  fail('EMULATOR_VARIABLE_PRESENT: run the emulator-specific integration suite instead');
 const {db,auth}=firebase();
 report.projectId=process.env.FIREBASE_PROJECT_ID;
 // getUserByEmail is authoritative; Firestore email field cannot pick a target.
 let identity;
 try{identity=await auth.getUserByEmail(email)}
 catch(e){if(e.code==='auth/user-not-found')fail('USER_NOT_FOUND in selected Firebase Auth project');throw e}
 const uid=identity.uid;
 report.target={email,uid};
 const profile=await db.collection('users').doc(uid).get();
 const plan=await discover(db,uid);
 eligibleForReset({role:profile.exists?profile.data().role:undefined,
  ownedDeviceIds:plan.owned,accountEmail:identity.email,requestedEmail:email});
 if(profile.exists&&dbEmail(profile.data().email)!==email)fail('PROFILE_EMAIL_MISMATCH');
 if(profile.data()?.avatarOperation?.expiresAt>Date.now())fail('ACTIVE_AVATAR_OPERATION');
 if(profile.data()?.avatarUrl && !['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']
   .every(k=>process.env[k]))fail('CLOUDINARY_REQUIRED: profile has an avatar; configure provider keys to remove external photo first');
 const counters={};
 for(const entry of plan.map.values())counters[entry.type]=(counters[entry.type]||0)+1;
 report.counts={userDoc:profile.exists?1:0,...counters,scannedDevices:plan.scannedDevices,
  scannedOutbox:plan.scannedOutbox,historicalAlertAcknowledgementsRetained:plan.historicAcknowledgements,
  historicalTransferAuditRetained:plan.historicTransfers};
 console.log('\nFIREBASE PROJECT: '+report.projectId);
 console.log('Target email: '+email);
 console.log('Firebase UID: '+uid);
 console.log('Auth account status: '+(identity.disabled?'disabled':'active'));
 console.log('Removable user-related records: '+JSON.stringify(counters));
 console.log('User profile and all its nested subcollections: '+(profile.exists?'DELETE':'already absent'));
 console.log('Cloudinary profile photo: '+(profile.data()?.avatarUrl?'DESTROY using provider credentials':'not present'));
 console.log('Historical incident acknowledgements retained: '+plan.historicAcknowledgements);
 console.log('Historical transfer records retained: '+plan.historicTransfers);
 console.log('Shared buoy data, incident history, owner audit, keys: NEVER DELETE');
 console.log('\nPERMANENT DELETION: Firebase Auth identity, FCM tokens/sessions, Viewer/invitation indexes and user profile.');
 console.log('Previously downloaded device push notifications cannot be remotely recalled.');
 console.log('Account recreation creates a NEW UID and does not reclaim existing ownership.');
 const confirm=await rl.question('\nType exactly "DELETE '+email+' FROM '+report.projectId+'" to proceed: ');
 requireExactConfirmation(confirm,email,report.projectId);
 // Re-check account-to-email and owner status immediately before any cloud write.
 const verified=await auth.getUser(uid);
 const freshProfile=await db.collection('users').doc(uid).get();
 const currentOwners=await db.collection('devices').where('ownerUid','==',uid).limit(1).get();
 eligibleForReset({role:freshProfile.exists?freshProfile.data().role:undefined,
  ownedDeviceIds:currentOwners.docs.map(d=>d.id),accountEmail:verified.email,requestedEmail:email});
 if(freshProfile.exists&&dbEmail(freshProfile.data().email)!==email)fail('PROFILE_CHANGED_AFTER_CONFIRM');
 report.outcome='IN_PROGRESS';
 save();
 // Fail closed: disable Firebase identity first and permanently revoke its
 // refresh tokens. A concurrent API session is then ineligible at auth guard.
 await auth.updateUser(uid,{disabled:true});
 await auth.revokeRefreshTokens(uid);
 const userRef=db.collection('users').doc(uid);
 const current=await userRef.get();
 if(current.exists){
  if(dbEmail(current.data().email)!==email)fail('PROFILE_CHANGED_AFTER_CONFIRM');
  await userRef.update({status:'DISABLED',resetStartedAt:new Date().toISOString()});
 }
 if(profile.data()?.avatarUrl){
  await removeAvatarFromProvider(uid);
  report.deleted.cloudinaryAvatar=1;
 }
 // Stop future eligibility before removing session pointers and user indexes.
 const entries=[...plan.map.values()].sort((a,b)=>{
  const order={'fcm-token':0,'push-session':1,'push-installation':2,
   'fcm-delivery-receipt':3,'personal-outbox':4};
  return (order[a.type]??5)-(order[b.type]??5);
 });
 for(const entry of entries){
  if(await purgeRef(entry,uid,db))
   report.deleted[entry.type]=(report.deleted[entry.type]||0)+1;
 }
 // Concurrent invites cannot target a disabled profile. A stopped account
 // cannot claim a new buoy. However, detect any late entries before final Auth
 // removal rather than misreporting a clean sweep.
 const after=await discover(db,uid);
 if(after.owned.length||after.map.size)fail('RECHECK_FOUND_REMAINING_ACCOUNT_REFERENCES: run this command again before deleting Auth');
 const finalProfile=await userRef.get();
 if(finalProfile.exists){
  if(dbEmail(finalProfile.data().email)!==email)fail('USER_DOC_CHANGED');
  await db.recursiveDelete(userRef);
  report.deleted.userDocumentAndSubcollections='recursiveDelete';
 }
 // Firebase identity is LAST. If any earlier step fails it stays disabled,
 // so operator can retry idempotently without cross-account leakage.
 await auth.deleteUser(uid);
 report.deleted.firebaseAuthentication=1;
 report.outcome='COMPLETE_WITH_RETAINED_HISTORICAL_AUDIT';
 console.log('\nSUCCESS: test account deleted from Firebase Auth and active account indexes.');
 console.log('Historical buoy/incident records intentionally retained (see report).');
 console.log('To test registration from zero, first sign out or clear the old app session on Android.');
}
try{await main()}
catch(e){
 report.outcome='ABORTED_OR_PARTIAL';
 report.errors.push(String(e?.message||e));
 console.error('\nRESET STOPPED: '+String(e?.message||e));
 console.error('If confirmation was already entered, identity may be disabled; run this script again to resume after fixing the issue.');
 process.exitCode=1;
}finally{save();rl.close()}
