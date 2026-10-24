#!/usr/bin/env node
/**
 * Windows/Linux isolated simulator launcher.
 * Default: no credentials and no external Pusher/FCM sends.
 *
 * npm run sim:pipeline
 * npm run sim:pipeline -- --with-pusher
 * npm run sim:pipeline -- --with-pusher --with-fcm
 *
 * Live provider sends additionally require THESIS_PROVIDER_CONFIRM.
 */
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const flags=process.argv.slice(2),supported=new Set(['--with-pusher','--with-fcm']);
for(const f of flags)if(!supported.has(f))throw Error('Unsupported simulator option: '+f);
const live=flags.length>0;
if(live&&process.env.THESIS_PROVIDER_CONFIRM!=='SEND_TEST_PROVIDER_EVENTS'){
 console.error('To send REAL Pusher/FCM provider messages, explicitly set THESIS_PROVIDER_CONFIRM=SEND_TEST_PROVIDER_EVENTS');
 process.exit(2);
}
if(flags.includes('--with-pusher')){
 for(const key of ['PUSHER_APP_ID','PUSHER_KEY','PUSHER_SECRET','PUSHER_CLUSTER']){
  if(!process.env[key])throw Error('Missing '+key);
 }
}
if(flags.includes('--with-fcm')){
 for(const key of ['THESIS_FCM_PROJECT_ID','THESIS_FCM_TEST_TOKEN','THESIS_FCM_CREDENTIALS_FILE']){
  if(!process.env[key])throw Error('Missing '+key);
 }
}
// A previous Java Firestore emulator occasionally survives an exec shutdown
// on Windows. Never kill unrelated programs: choose unused loopback ports.
async function available(port){
 return await new Promise(resolve=>{
  const s=createServer();
  s.once('error',()=>resolve(false));
  s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));
 });
}
async function ephemeral(){
 return await new Promise((resolve,reject)=>{
  const s=createServer();
  s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});
 });
}
const firestorePort=await available(8080)?8080:await ephemeral();
const authPort=await available(9099)?9099:await ephemeral();
const websocketPort=await available(9150)?9150:await ephemeral();
const configDir=join(root,'.test-output');
mkdirSync(configDir,{recursive:true});
const configPath=join(configDir,'firebase-simulator-'+randomUUID()+'.json');
writeFileSync(configPath,JSON.stringify({
 firestore:{rules:join(root,'firestore.rules'),indexes:join(root,'firestore.indexes.json')},
 emulators:{firestore:{host:'127.0.0.1',port:firestorePort,websocketPort},
  auth:{host:'127.0.0.1',port:authPort},ui:{enabled:false}}
},null,2)+'\n');
console.log('Emulator ports:',firestorePort,'(Firestore),',authPort,'(Auth),',websocketPort,'(WebSocket). No unrelated process terminated.');
const project='demo-oil-spill-simulator-isolated';
const env={
 ...process.env,
 NODE_ENV:'test',
 FIREBASE_PROJECT_ID:project,
 GCLOUD_PROJECT:project,
 GOOGLE_CLOUD_PROJECT:project,
 FIREBASE_CLIENT_EMAIL:'',
 FIREBASE_PRIVATE_KEY:'',
 GOOGLE_APPLICATION_CREDENTIALS:'',
 GOOGLE_CLOUD_KEYFILE_JSON:'',
 DEVICE_KEY_PEPPER:'EMULATOR_ONLY_NOT_A_REAL_SECRET_2026_OIL_SPILL_0123456789',
 PUSHER_ENABLED:flags.includes('--with-pusher')?'true':'false',
 // Live FCM is ONLY sent through pushAlert() with a separate messaging app.
 // The default dispatch() must never accidentally send to real Firebase.
 FCM_ENABLED:'false',
};
delete env.FIRESTORE_EMULATOR_HOST;
delete env.FIREBASE_AUTH_EMULATOR_HOST;
const cmd='node scripts/simulator-pipeline.mjs'+(flags.length?' '+flags.join(' '):'');
const windows=process.platform==='win32';
const args=['--yes','firebase-tools@15.9.0','emulators:exec','--config',
 windows?'"'+configPath+'"':configPath,'--project',project,'--only','firestore,auth',
 windows?'"'+cmd+'"':cmd];
console.log('ISOLATED THESIS BUOY PIPELINE');
console.log('Synthetic Firestore writes: emulator ONLY.');
console.log('External Pusher:',flags.includes('--with-pusher')?'explicitly enabled':'disabled');
console.log('External FCM:',flags.includes('--with-fcm')?'one test token explicitly enabled':'disabled');
let result;
try {
 result=spawnSync(windows?'npx.cmd':'npx',args,{cwd:root,env,stdio:'inherit',shell:windows});
 if(result.error)console.error(result.error.message);
 process.exitCode=result.status??1;
} finally {
 try{unlinkSync(configPath)}catch(e){console.warn('Temporary emulator config cleanup failed:',e.message)}
}
