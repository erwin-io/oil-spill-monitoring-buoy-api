#!/usr/bin/env node
/**
 * Read-only verification of Samsung -> production Firebase push-session logout.
 * Uses the existing local Admin service account; never logs token/session
 * secrets, reads full account records, mutates Firestore, or sends FCM.
 *
 * node scripts/verify-android-push-logout.mjs --installation-id install_<32hex>
 * Keep this command running, then press BlueGuard Profile > Sign out on Samsung.
 */
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';

const args=process.argv.slice(2);
const index=args.indexOf('--installation-id');
const installationId=index>=0?args[index+1]:'';
if(args.length!==2||index!==0||!/^install_[a-fA-F0-9]{32}$/.test(installationId)){
 console.error('Usage: node scripts/verify-android-push-logout.mjs --installation-id install_<32 hex>');
 process.exit(2);
}
if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST){
 console.error('Production logout verification cannot run while emulator overrides are set.');
 process.exit(2);
}
const servicePath=process.env.THESIS_FCM_CREDENTIALS_FILE||
 process.env.GOOGLE_APPLICATION_CREDENTIALS||
 join(homedir(),'secure','oilspill','firebase-admin.json');
if(!existsSync(servicePath)){
 console.error('Service account JSON not found. Set THESIS_FCM_CREDENTIALS_FILE to the existing private path.');
 process.exit(2);
}
const service=JSON.parse(readFileSync(servicePath,'utf8'));
if(service.project_id!=='oil-spill-monitoring-buoy'){
 console.error('Firebase service account is not for the BlueGuard production project.');
 process.exit(2);
}
const app=initializeApp({credential:cert(service),projectId:service.project_id},
 'blueguard-logout-readonly-'+process.pid);
const db=getFirestore(app);
const check=async()=>{
 const pointer=await db.collection('pushInstallations').doc(installationId).get();
 if(!pointer.exists)return {ready:false,why:'No installation registration'};
 const {sessionId,uid}=pointer.data();
 if(!sessionId||!uid)return {ready:false,why:'Installation session missing'};
 const [session,tokens]=await Promise.all([
  db.collection('pushSessions').doc(sessionId).get(),
  db.collection('notificationTokens').where('sessionId','==',sessionId).get()
 ]);
 if(!session.exists||session.data().uid!==uid)
  return {ready:false,why:'Installation-to-session identity mismatch'};
 return {ready:true,state:session.data().state,activeTokens:tokens.docs.filter(d=>d.data().active).length,
  registeredTokens:tokens.size,expiresAt:session.data().expiresAt};
};
try{
 const before=await check();
 if(!before.ready||before.state!=='ACTIVE'||before.activeTokens===0)
  throw Error('No active Android push session and registered FCM token found. Open BlueGuard Overview first.');
 console.log('PASS: active authorized push session and '+before.registeredTokens+' registered token record(s) found.');
 console.log('On your Samsung, open BlueGuard > Profile > Sign out. Monitoring read-only Firebase session status.');
 let after=before;
 const deadline=Date.now()+120_000;
 while(Date.now()<deadline){
  await sleep(2500);
  after=await check();
  if(!after.ready)throw Error('Installation record became unavailable during verification');
  if(after.state==='REVOKED'&&after.activeTokens===0)break;
 }
 const pass=after.state==='REVOKED'&&after.activeTokens===0;
 const report={test:'BlueGuard real Samsung sign-out push revocation',time:new Date().toISOString(),
  project:'oil-spill-monitoring-buoy',readOnly:true,
  before:{state:before.state,activeTokens:before.activeTokens,registeredTokens:before.registeredTokens},
  after:{state:after.state,activeTokens:after.activeTokens,registeredTokens:after.registeredTokens},
  result:pass?'PASS':'FAIL'};
 mkdirSync('.test-output',{recursive:true});
 writeFileSync(resolve('.test-output/android-push-logout.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 if(!pass)process.exitCode=1;
}catch(e){
 console.error('FAIL:',String(e.message).slice(0,220));
 process.exitCode=1;
}finally{await deleteApp(app)}
