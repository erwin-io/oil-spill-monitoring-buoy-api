#!/usr/bin/env node
/**
 * Owner-initiated buoy -> API -> Firestore emulator -> Pusher / FCM provider smoke.
 * No synthetic measurements or alerts are ever written to cloud Firestore.
 * Default: deterministic local end-to-end HTTP simulation without external sends.
 *
 * Real provider actions require BOTH:
 *   --with-pusher / --with-fcm
 *   THESIS_PROVIDER_CONFIRM=SEND_TEST_PROVIDER_EVENTS
 *
 * The FCM provider call uses pushAlert(), the SAME sender as the outbox worker,
 * against an emulator outbox and a separate real Firebase Messaging app only.
 */
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getMessaging} from 'firebase-admin/messaging';

const root=fileURLToPath(new URL('../',import.meta.url));
const flags=new Set(process.argv.slice(2));
const allow=new Set(['--with-pusher','--with-fcm']);
export function checkSandbox(env, options=flags) {
 for(const f of options)if(!allow.has(f))throw Error('UNSUPPORTED_OPTION: '+f);
 if(!env.FIREBASE_PROJECT_ID?.startsWith('demo-'))throw Error('CLOUD_FIREBASE_WRITE_PROTECTION: expected demo- project');
 for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']){
  if(!/^(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(env[name]??''))throw Error('CLOUD_FIREBASE_WRITE_PROTECTION: '+name+' must be localhost');
 }
 if(options.has('--with-pusher')||options.has('--with-fcm')){
  if(env.THESIS_PROVIDER_CONFIRM!=='SEND_TEST_PROVIDER_EVENTS')throw Error('Explicit provider delivery confirmation required');
 }
 if(options.has('--with-pusher')){
  for(const v of ['PUSHER_APP_ID','PUSHER_KEY','PUSHER_SECRET','PUSHER_CLUSTER'])if(!env[v])throw Error('Missing '+v);
  if(env.PUSHER_ENABLED!=='true')throw Error('PUSHER_ENABLED=true required to dispatch provider event');
 }
 if(options.has('--with-fcm')){
  for(const v of ['THESIS_FCM_TEST_TOKEN','THESIS_FCM_PROJECT_ID','THESIS_FCM_CREDENTIALS_FILE'])if(!env[v])throw Error('Missing '+v);
  if(env.THESIS_FCM_TEST_TOKEN.length<20)throw Error('FCM token too short');
 }
 return true;
}
const iso=()=>new Date().toISOString();
const marker=()=>randomUUID().replaceAll('-','').slice(0,14);
export function sampleMeasurement(id,classification='NORMAL'){
 return {measurementId:id,measuredAt:iso(),classification,confidence:0.96,totalFluorescence:classification==='PETROLEUM'?90:12,
  batteryPercent:81,signalStrengthDbm:-73,cellStatus:'CLEAN',firmwareVersion:'simulator-only',
  modelVersion:'no-real-sensor',qualityFlags:['SIMULATED_DO_NOT_USE_FOR_SCIENCE'],
  spectral:{f415:8,f445:14,f480:21,f515:11,f555:7,f590:4}};
}
const safeResult=(ok,details)=>({status:ok?'PASS':'FAIL',...details});
function parseJSON(text){try{return JSON.parse(text)}catch{return {message:text.slice(0,180)}}}
async function request(base,method,path,body,headers={}){
 const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const parsed=parseJSON(await response.text());
 if(!response.ok)throw Error(method+' '+path+' -> HTTP '+response.status+' ('+(parsed.error?.code??'REQUEST_FAILED')+')');
 return{status:response.status,body:parsed};
}
async function emulatorSignIn(host,email,password){
 const response=await fetch('http://'+host+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=thesis-emulator-key',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Auth emulator sign-in failed');
 return(await response.json()).idToken;
}
async function localServer(app){
 const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{if(server.listening)return resolve();server.once('listening',resolve);server.once('error',reject)});
 return{base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};
}
/** Real Pusher websocket with auth from the same emulator-backed API. */
async function livePusher(base,token,deviceId,cluster,key){
 const expected=['measurement.created','health.updated','alert.created'];
 const received=new Set();
 const channel='private-device-'+deviceId;
 const socket=new WebSocket('wss://ws-'+cluster+'.pusher.com/app/'+encodeURIComponent(key)+'?protocol=7&client=thesis-smoke&version=1.0');
 let timer;
 const ready=new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(Error('PUSHER_SUBSCRIBE_TIMEOUT')),12000);
  socket.addEventListener('error',()=>reject(Error('PUSHER_SOCKET_ERROR')));
  socket.addEventListener('message',async e=>{
   let msg;try{msg=JSON.parse(String(e.data))}catch{return}
   if(msg.event==='pusher:connection_established'){
    try{
     const data=typeof msg.data==='string'?JSON.parse(msg.data):msg.data;
     const result=await request(base,'POST','/api/v1/realtime/auth',{socket_id:data.socket_id,channel_name:channel},{Authorization:'Bearer '+token});
     socket.send(JSON.stringify({event:'pusher:subscribe',data:{auth:result.body.auth,channel}}));
    }catch(error){reject(error)}
   }
   if(msg.event==='pusher_internal:subscription_succeeded'){clearTimeout(timer);resolve()}
   if(msg.event==='pusher:error'){reject(Error('PUSHER_PROVIDER_ERROR'))}
  });
 });
 try{await ready}catch(e){socket.close();throw e}
 return {
  received,
  async wait(){
   const until=Date.now()+12000;
   while(Date.now()<until&&!expected.every(event=>received.has(event)))await new Promise(r=>setTimeout(r,200));
   if(!expected.every(event=>received.has(event)))throw Error('PUSHER_MISSING_EVENTS:'+expected.filter(e=>!received.has(e)).join(','));
   return [...received];
  },
  close(){socket.close();}
 };
}
async function run(){
 // No cloud credentials are needed for local emulator Auth/Firestore.
 checkSandbox(process.env);
 const {firebase}=await import('../src/firebase.js');
 const {default:app}=await import('../src/app.js');
 const {pushAlert}=await import('../src/jobs.js');
 const {auth,db}=firebase();
 const suffix=marker(),deviceId='sim_'+suffix;
 const password='Local-Simulator-Only!234';
 const adminEmail='admin_'+suffix+'@example.test',viewerEmail='viewer_'+suffix+'@example.test';
 const admin=await auth.createUser({email:adminEmail,password,emailVerified:true});
 const viewer=await auth.createUser({email:viewerEmail,password,emailVerified:true});
 await db.collection('users').doc(admin.uid).set({email:adminEmail,role:'ADMIN',status:'ACTIVE',allowedDeviceIds:[]});
 await db.collection('users').doc(viewer.uid).set({email:viewerEmail,role:'VIEWER',status:'ACTIVE',allowedDeviceIds:[deviceId]});
 const adminToken=await emulatorSignIn(process.env.FIREBASE_AUTH_EMULATOR_HOST,adminEmail,password);
 const viewerToken=await emulatorSignIn(process.env.FIREBASE_AUTH_EMULATOR_HOST,viewerEmail,password);
 const local=await localServer(app);
 const report={mode:'local-emulator-synthetic-buoy',timestamp:iso(),deviceId,
  dataTarget:'FIRESTORE_AND_AUTH_EMULATORS_ONLY',cloudFirestoreWrites:0,
  simulatedTelemetry:true,realPusher:false,realFCMAccepted:false,androidNotificationReceived:'NOT_MEASURED',
  checks:[]};
 let pusher,externalApp;
 try{
  const a={Authorization:'Bearer '+adminToken},v={Authorization:'Bearer '+viewerToken};
  const registered=await request(local.base,'POST','/api/v1/devices',{deviceId,name:'SIMULATION ONLY - NOT SENSOR DATA'},a);
  const deviceHeaders={'x-device-id':deviceId,'x-device-key':registered.body.deviceKey};
  report.checks.push(safeResult(true,{step:'API device provisioned in emulator'}));
  const view=await request(local.base,'GET','/api/v1/devices',undefined,v);
  if(!view.body.items.some(d=>d.id===deviceId))throw Error('Scoped device not listed');
  report.checks.push(safeResult(true,{step:'Viewer authorized to simulator-only device'}));
  if(flags.has('--with-fcm')){
   await request(local.base,'POST','/api/v1/notifications/register-device',{
    token:process.env.THESIS_FCM_TEST_TOKEN,platform:'android',provider:'FCM'
   },v);
   report.checks.push(safeResult(true,{step:'Test token registered only in emulator'}));
  }
  if(flags.has('--with-pusher')){
   pusher=await livePusher(local.base,viewerToken,deviceId,process.env.PUSHER_CLUSTER,process.env.PUSHER_KEY);
   report.checks.push(safeResult(true,{step:'Real Pusher subscribed to scoped private channel'}));
  }
  const m1=await request(local.base,'POST','/api/v1/device/measurements',sampleMeasurement('normal_'+suffix),deviceHeaders);
  const m2=await request(local.base,'POST','/api/v1/device/measurements',sampleMeasurement('oil_'+suffix,'PETROLEUM'),deviceHeaders);
  if(m1.status!==201||m2.status!==201)throw Error('Measurement API did not accept simulator samples');
  const health=await request(local.base,'POST','/api/v1/device/health',{
    healthId:'health_'+suffix,measuredAt:iso(),batteryPercent:18,charging:false,
    signalStrengthDbm:-72,sensor:'FAULT',cellStatus:'MAINTENANCE_REQUIRED',pendingUploads:2
  },deviceHeaders);
  if(health.status!==201)throw Error('Health API did not accept simulator status');
  const latest=await request(local.base,'GET','/api/v1/devices/'+deviceId+'/measurements/latest',undefined,v);
  if(latest.body.classification!=='PETROLEUM')throw Error('Authoritative latest projection not refreshed');
  const inbox=await request(local.base,'GET','/api/v1/alerts',undefined,v);
  if(!inbox.body.items.some(x=>x.deviceId===deviceId&&x.type==='PETROLEUM'))throw Error('Emulator oil alert missing');
  report.checks.push(safeResult(true,{step:'Normal, simulated oil and sensor health HTTP uploads created authoritative emulator data and alerts'}));
  const previousSecret=process.env.CRON_SECRET;
  process.env.CRON_SECRET='sim-cron-'+suffix+'-secret-0123456789';
  const dispatched=await request(local.base,'GET','/api/v1/jobs/dispatch',undefined,{authorization:'Bearer '+process.env.CRON_SECRET});
  process.env.CRON_SECRET=previousSecret;
  report.checks.push(safeResult(dispatched.body.processed>=4,{step:'Real outbox dispatch code executed',processed:dispatched.body.processed}));
  if(dispatched.body.processed<4)throw Error('Outbox did not dispatch all expected events');
  if(pusher){
   const received=await pusher.wait();
   const refreshed=await request(local.base,'GET','/api/v1/devices/'+deviceId+'/measurements/latest',undefined,v);
   if(refreshed.body.classification!=='PETROLEUM')throw Error('Realtime callback REST reconciliation failed');
   report.realPusher=true;
   report.checks.push(safeResult(true,{step:'Real Pusher delivered private events; API REST refetch matches latest data',events:received}));
  }
  if(flags.has('--with-fcm')){
   const serviceJSON=JSON.parse(readFileSync(process.env.THESIS_FCM_CREDENTIALS_FILE,'utf8'));
   if(serviceJSON.project_id!==process.env.THESIS_FCM_PROJECT_ID)throw Error('FCM service account/project mismatch');
   externalApp=initializeApp({credential:cert(serviceJSON),projectId:serviceJSON.project_id},'thesis-real-fcm-'+suffix);
   const outbox=await db.collection('notificationOutbox').where('type','==','alert.created').get();
   const entry=outbox.docs.find(d=>d.data().deviceId===deviceId&&d.data().payload?.type==='PETROLEUM');
   if(!entry)throw Error('No emulator petroleum notification job');
   // This uses the exact FCM sender implementation used by /jobs/dispatch.
   // Only the Firebase Messaging transport targets the real project; DB and
   // receipts remain in the emulator. The device token is never logged.
   await pushAlert(db,getMessaging(externalApp),entry.data(),entry.ref);
   const receipts=await entry.ref.collection('fcmReceipts').get();
   if(!receipts.docs.some(d=>d.data().status==='SENT'))throw Error('FCM provider did not accept test push');
   report.realFCMAccepted=true;
   report.checks.push(safeResult(true,{step:'Real FCM provider accepted one test notification; Android receipt/tap still requires owner observation'}));
  }
  report.result='PASS';
 }finally{
  pusher?.close();
  await local.close();
  if(externalApp)await deleteApp(externalApp);
 }
 return report;
}
const main=process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1]).toString()) ;
if(main){
 let report;
 try{report=await run()}
 catch(e){
  report={result:'FAIL',error:e.message,mode:'local-emulator-synthetic-buoy',cloudFirestoreWrites:0};
  process.exitCode=1;
 }
 const dir=join(root,'.test-output');mkdirSync(dir,{recursive:true});
 const out=join(dir,'simulator-pipeline-report.json');
 writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:report.result,providerPusher:report.realPusher??false,
  providerFCMAccepted:report.realFCMAccepted??false,androidReceipt:'NOT_MEASURED',report:out,
  ...(report.error?{error:report.error}:{})},null,2));
}
