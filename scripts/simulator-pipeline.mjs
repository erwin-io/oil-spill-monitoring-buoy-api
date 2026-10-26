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
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getMessaging} from 'firebase-admin/messaging';

const root=fileURLToPath(new URL('../',import.meta.url));
const argv=process.argv.slice(2);
const flags=new Set(argv.filter(a=>a==='--with-pusher'||a==='--with-fcm'));
const scenarioName=process.env.TELEMETRY_LAB_SCENARIO||null;
const allow=new Set(['--with-pusher','--with-fcm']);
export function checkSandbox(env, options=flags) {
 for(const f of options)if(!allow.has(f))throw Error('UNSUPPORTED_OPTION: '+f);
 for(const f of argv)if(!allow.has(f))throw Error('UNSUPPORTED_OPTION: '+f);
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
/** Expose only Firebase Admin error identifiers, never SDK messages or secrets. */
export function safeFcmErrorCode(error){
 const value=typeof error?.code==='string'?error.code:'FCM_UNKNOWN_ERROR';
 return /^[a-zA-Z0-9_/-]{1,100}$/.test(value)?value:'FCM_UNKNOWN_ERROR';
}


/** Validate editable fixtures before creating any emulator user/device. */
export function readTelemetryPlan(name, fixture){
 if(!fixture?.scenarios || typeof fixture.scenarios!=='object')throw Error('TELEMETRY_SCENARIOS_INVALID');
 const plan=fixture.scenarios[name];
 if(!plan)throw Error('UNKNOWN_TELEMETRY_SCENARIO:'+name);
 if(!Array.isArray(plan.steps)||plan.steps.length<1||plan.steps.length>16)throw Error('SCENARIO_STEPS_INVALID');
 if(!Array.isArray(plan.expectedAlerts)||plan.expectedAlerts.length>12)throw Error('SCENARIO_ALERTS_INVALID');
 const types=new Set(['PETROLEUM','LOW_BATTERY','SENSOR_FAULT','CELL_MAINTENANCE_REQUIRED']);
 if(plan.expectedAlerts.some(t=>!types.has(t)))throw Error('SCENARIO_ALERT_TYPE_INVALID');
 const validKinds=new Set(['measurement','health']);
 const validClasses=new Set(['NORMAL','PETROLEUM','INTERFERENCE','INCONCLUSIVE']);
 for(const step of plan.steps){
  if(!step||!validKinds.has(step.kind))throw Error('SCENARIO_STEP_KIND_INVALID');
  if(step.kind==='measurement'&&!validClasses.has(step.classification))throw Error('SCENARIO_MEASUREMENT_CLASS_INVALID');
  if(step.kind==='health' && step.batteryPercent===undefined && step.sensor===undefined && step.cellStatus===undefined)
   throw Error('SCENARIO_HEALTH_FIELDS_MISSING');
 }
 return plan;
}

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
async function livePusher(base,token,deviceId,cluster,key,expected=['measurement.created','health.updated','alert.created']){
 const received=new Set();
 const channel='private-device-'+deviceId;
 const socket=new WebSocket('wss://ws-'+cluster+'.pusher.com/app/'+encodeURIComponent(key)+'?protocol=7&client=thesis-smoke&version=1.0');
 let timer;
 const ready=new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(Error('PUSHER_SUBSCRIBE_TIMEOUT')),12000);
  socket.addEventListener('error',()=>reject(Error('PUSHER_SOCKET_ERROR')));
  socket.addEventListener('message',async e=>{
   let msg;try{msg=JSON.parse(String(e.data))}catch{return}
   if(expected.includes(msg.event) && msg.channel===channel)received.add(msg.event);
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
 const waitFor=async events=>{
  const until=Date.now()+12000;
  while(Date.now()<until&&!events.every(event=>received.has(event)))await new Promise(r=>setTimeout(r,200));
  if(!events.every(event=>received.has(event)))
   throw Error('PUSHER_MISSING_EVENTS:'+events.filter(e=>!received.has(e)).join(','));
  return [...received];
 };
 return {
  received,
  wait:()=>waitFor(expected),
  waitFor,
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
 const plan=scenarioName?readTelemetryPlan(scenarioName,JSON.parse(readFileSync(join(root,'scripts','telemetry-lab.scenarios.json'),'utf8'))):null;
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
  checks:[],scenario:scenarioName??'legacy',pusherEvents:[],fcmSendCount:0,alertTypes:[]};
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
   const expected=plan?[...(plan.steps.some(s=>s.kind==='measurement')?['measurement.created']:[]),...(plan.steps.some(s=>s.kind==='health')?['health.updated']:[]),...(plan.expectedAlerts.length?['alert.created']:[])]:undefined;
   pusher=await livePusher(local.base,viewerToken,deviceId,process.env.PUSHER_CLUSTER,process.env.PUSHER_KEY,expected);
   report.checks.push(safeResult(true,{step:'Real Pusher subscribed to scoped private channel'}));
  }
  if(plan){
   for(let n=0;n<plan.steps.length;n++){
    const step=plan.steps[n];
    const rest=Object.fromEntries(Object.entries(step).filter(([key])=>key!=='kind'));
    const url=step.kind==='measurement'?'/api/v1/device/measurements':'/api/v1/device/health';
    const payload=step.kind==='measurement'
      ?{...sampleMeasurement('sim_measure_'+suffix+'_'+n,step.classification),...rest,
        measurementId:'sim_measure_'+suffix+'_'+n,measuredAt:iso(),
        qualityFlags:['SIMULATED_DO_NOT_USE_FOR_SCIENCE'],modelVersion:'no-real-sensor'}
      :{batteryPercent:85,charging:false,signalStrengthDbm:-72,sensor:'OK',cellStatus:'CLEAN',
        pendingUploads:0,...rest,healthId:'sim_health_'+suffix+'_'+n,measuredAt:iso()};
    const accepted=await request(local.base,'POST',url,payload,deviceHeaders);
    if(accepted.status!==201)throw Error('TELEMETRY_REJECTED:stage_'+n);
    report.checks.push(safeResult(true,{step:'Accepted simulator '+step.kind+' stage '+(n+1),classification:step.classification||null}));
    // Source telemetry timestamps are generated at send time, not hardcoded.
    await new Promise(resolve=>setTimeout(resolve,8));
   }
   const alertSnapshot=await db.collection('alerts').where('deviceId','==',deviceId).get();
   const found=[...new Set(alertSnapshot.docs.map(d=>d.data().type))].sort();
   const expected=[...new Set(plan.expectedAlerts)].sort();
   if(JSON.stringify(found)!==JSON.stringify(expected))throw Error('ALERT_CONTRACT_MISMATCH: expected '+expected.join(',')+' got '+found.join(','));
   report.alertTypes=found;
   const outbox=await db.collection('notificationOutbox').where('deviceId','==',deviceId).get();
   const newAlerts=outbox.docs.filter(d=>d.data().type==='alert.created');
   if(newAlerts.length!==plan.expectedAlerts.length)throw Error('ALERT_OUTBOX_MISMATCH');
   report.checks.push(safeResult(true,{step:'Alert policy matches scenario',alerts:found,pushJobs:newAlerts.length}));
   if(plan.steps.some(s=>s.kind==='measurement')){
    const latest=await request(local.base,'GET','/api/v1/devices/'+deviceId+'/measurements/latest',undefined,v);
    const lastMeasurement=[...plan.steps].reverse().find(s=>s.kind==='measurement');
    if(latest.body.classification!==lastMeasurement.classification)throw Error('AUTHORITATIVE_LATEST_MISMATCH');
   }
  }else{
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
  }
  const previousSecret=process.env.CRON_SECRET;
  process.env.CRON_SECRET='sim-cron-'+suffix+'-secret-0123456789';
  const dispatched=await request(local.base,'GET','/api/v1/jobs/dispatch',undefined,{authorization:'Bearer '+process.env.CRON_SECRET});
  process.env.CRON_SECRET=previousSecret;
  const minimum=plan?plan.steps.length+plan.expectedAlerts.length:4;
  report.checks.push(safeResult(dispatched.body.processed>=minimum,{step:'Real outbox dispatch code executed',processed:dispatched.body.processed,expectedAtLeast:minimum}));
  if(dispatched.body.processed<minimum)throw Error('OUTBOX_MISSING_EVENTS');
  if(pusher){
   const received=await pusher.wait();
   const refreshed=plan&&!plan.steps.some(s=>s.kind==='measurement')
    ?await request(local.base,'GET','/api/v1/devices/'+deviceId,undefined,v)
    :await request(local.base,'GET','/api/v1/devices/'+deviceId+'/measurements/latest',undefined,v);
   if(plan){
    const recent=[...plan.steps].reverse().find(s=>s.kind==='measurement');
    if(recent && refreshed.body.classification!==recent.classification)throw Error('Realtime REST reconciliation failed');
   } else if(refreshed.body.classification!=='PETROLEUM')throw Error('Realtime callback REST reconciliation failed');
   // Full B-21 scenario: additionally verify hosted Pusher presence delivery,
   // using the same transactional production offline sweep + outbox dispatcher
   // against ONLY the disposable local Firestore/Auth emulators.
   if(scenarioName==='all'){
    const credential=process.env.CRON_SECRET;
    process.env.CRON_SECRET='sim-cron-'+suffix+'-secret-0123456789';
    const cron={authorization:'Bearer '+process.env.CRON_SECRET};
    try{
     await db.collection('devices').doc(deviceId).update({lastSeenAt:'2020-01-01T00:00:00.000Z'});
     const off=await request(local.base,'GET','/api/v1/jobs/offline',undefined,cron);
     if(off.status!==200||off.body.newOffline!==1)throw Error('OFFLINE_SWEEP_NOT_MARKED');
     const offJobs=await request(local.base,'GET','/api/v1/jobs/dispatch',undefined,cron);
     if(offJobs.status!==200||offJobs.body.processed<2)throw Error('OFFLINE_OUTBOX_NOT_DISPATCHED');
     await pusher.waitFor(['device.offline']);
     const offlineRead=await request(local.base,'GET','/api/v1/devices/'+deviceId,undefined,v);
     if(offlineRead.status!==200||offlineRead.body.lastSeenAt!=='2020-01-01T00:00:00.000Z')
      throw Error('OFFLINE_AUTHORITATIVE_API_REFETCH_MISMATCH');

     const restored=iso();
     await db.collection('devices').doc(deviceId).update({lastSeenAt:restored});
     const back=await request(local.base,'GET','/api/v1/jobs/offline',undefined,cron);
     if(back.status!==200||back.body.recovered!==1)throw Error('ONLINE_SWEEP_NOT_RECOVERED');
     const onlineJobs=await request(local.base,'GET','/api/v1/jobs/dispatch',undefined,cron);
     if(onlineJobs.status!==200||onlineJobs.body.processed<1)throw Error('ONLINE_OUTBOX_NOT_DISPATCHED');
     await pusher.waitFor(['device.online']);
     const onlineRead=await request(local.base,'GET','/api/v1/devices/'+deviceId,undefined,v);
     if(onlineRead.status!==200||onlineRead.body.lastSeenAt!==restored)
      throw Error('ONLINE_AUTHORITATIVE_API_REFETCH_MISMATCH');
     report.checks.push(safeResult(true,{step:'Real Pusher private device.offline/device.online transitions delivered; authorized API refetch verified, emulator-only'}));
    }finally{if(credential===undefined)delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET=credential}
   }
   report.realPusher=true;
   report.pusherEvents=[...pusher.received];
   report.checks.push(safeResult(true,{step:'Real Pusher delivered private events; API REST refetch matches latest data',events:report.pusherEvents}));
  }
  if(flags.has('--with-fcm')){
   const serviceJSON=JSON.parse(readFileSync(process.env.THESIS_FCM_CREDENTIALS_FILE,'utf8'));
   if(serviceJSON.project_id!==process.env.THESIS_FCM_PROJECT_ID)throw Error('FCM service account/project mismatch');
   externalApp=initializeApp({credential:cert(serviceJSON),projectId:serviceJSON.project_id},'thesis-real-fcm-'+suffix);
   const outbox=await db.collection('notificationOutbox').where('type','==','alert.created').get();
   const selected=outbox.docs.filter(d=>d.data().deviceId===deviceId &&
     (!plan || plan.expectedAlerts.includes(d.data().payload?.type)));
   if(!plan&&!selected.some(d=>d.data().payload?.type==='PETROLEUM'))
    throw Error('No emulator petroleum notification job');
   // Observe only provider error codes, never registration tokens, messages
   // (which may include identifiers), service-account data, or FCM payloads.
   // Keep the production pushAlert() implementation unchanged.
   const provider={calls:0,accepted:0,rejected:0,errorCodes:[]};
   const messaging=getMessaging(externalApp);
   const observedMessaging={
    async sendEachForMulticast(message){
     provider.calls++;
     try{
      const result=await messaging.sendEachForMulticast(message);
      for(const response of result.responses){
       if(response.success)provider.accepted++;
       else{
        provider.rejected++;
        provider.errorCodes.push(safeFcmErrorCode(response.error));
       }
      }
      return result;
     }catch(error){
      provider.rejected++;
      provider.errorCodes.push(safeFcmErrorCode(error));
      throw error;
     }
    }
   };
   for(const entry of selected){
    const alertType=entry.data().payload?.type;
    try{
     await pushAlert(db,observedMessaging,entry.data(),entry.ref);
    }catch(error){
     // Only a sanitized Firebase code is surfaced to the test operator.
     throw Error('FCM_SEND_FAILED:'+String(alertType)+
      ':code='+safeFcmErrorCode(error)+
      ':providerCalls='+provider.calls+
      ':responseCodes='+([...new Set(provider.errorCodes)].join(',')||'none'));
    }
    const receipts=await entry.ref.collection('fcmReceipts').get();
    if(!receipts.docs.some(d=>d.data().status==='SENT')){
     const state=provider.calls===0?'NO_ELIGIBLE_RECIPIENT_OR_SESSION':
      provider.rejected>0?'PROVIDER_REJECTED':'NO_SENT_RECEIPT';
     throw Error('FCM_PROVIDER_NOT_ACCEPTED:'+String(alertType)+
      ':state='+state+
      ':providerCalls='+provider.calls+
      ':responseCodes='+([...new Set(provider.errorCodes)].join(',')||'none'));
    }
    report.fcmSendCount++;
    report.checks.push(safeResult(true,{step:'Real FCM provider accepted simulated alert',type:alertType}));
   }
   if(plan && selected.length!==plan.expectedAlerts.length)throw Error('FCM_ELIGIBLE_ALERT_COUNT_MISMATCH');
   report.realFCMAccepted=selected.length>0;
  }
  report.result='PASS';
 }finally{
  pusher?.close();
  await local.close();
  if(externalApp)await deleteApp(externalApp);
 }
 return report;
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){
 let report;
 try{report=await run()}
 catch(e){
  report={result:'FAIL',error:e.message,mode:'local-emulator-synthetic-buoy',cloudFirestoreWrites:0};
  process.exitCode=1;
 }
 const dir=join(root,'.test-output');mkdirSync(dir,{recursive:true});
 const out=join(dir,scenarioName?'telemetry-lab-report.json':'simulator-pipeline-report.json');
 writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:report.result,providerPusher:report.realPusher??false,
  providerFCMAccepted:report.realFCMAccepted??false,alertTypes:report.alertTypes??[],fcmSendCount:report.fcmSendCount??0,pusherEvents:report.pusherEvents??[],androidReceipt:'NOT_MEASURED',report:out,
  ...(report.error?{error:report.error}:{})},null,2));
}
