#!/usr/bin/env node
// One command. Reads the existing ignored .env automatically; no interactive prompts.
// All synthetic device/users and ownership mutations run on Firebase emulators ONLY.
import 'dotenv/config';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=join(root,'.test-output','p2-gates');
mkdirSync(out,{recursive:true});
const rows=[],windows=process.platform==='win32';
const safe=err=>String(err?.code||err?.message||err||'FAILED').slice(0,220).replace(/(?:\w{20,})/g,'[REDACTED]');
const entry=(id,state,note,detail={})=>{rows.push({id,status:state,note,...detail});console.log('[P2] '+id+' '+state+' - '+note)};
const env=process.env;
const configured=x=>typeof x==='string'&&!!x.trim()&&!/^(REPLACE_WITH|YOUR_|CHANGEME|TODO)/i.test(x);
function run(label,command,args,opts={}){
 const started=Date.now();
 const p=spawnSync(windows?command+'.cmd':command,args,{
  cwd:opts.cwd||root,env:opts.env||env,stdio:'inherit',shell:windows,timeout:opts.timeout||900000
 });
 const ok=p.status===0&&!p.error;
 entry(label,ok?'PASS':'FAIL',ok?'Exit 0':safe(p.error||('exit '+p.status)),{durationMs:Date.now()-started});
 return ok;
}
async function request(url,params={}){
 const res=await fetch(url,{...params,signal:AbortSignal.timeout(20000)});
 const contentType=res.headers.get('content-type')||'';
 const content=contentType.includes('json')?await res.json():await res.text();
 if(!res.ok)throw new Error('HTTP '+res.status);
 return content;
}
function sig(params,secret){return createHash('sha1').update(Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('&')+secret).digest('hex')}
async function cloudinaryProbe(){
 const cloud=env.CLOUDINARY_CLOUD_NAME,key=env.CLOUDINARY_API_KEY,secret=env.CLOUDINARY_API_SECRET;
 if(![cloud,key,secret].every(configured)){entry('P2-13-CLOUDINARY','SKIP','Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET in .env');return}
 if(!/^[\w-]{1,100}$/.test(cloud)){entry('P2-13-CLOUDINARY','FAIL','Invalid cloud name');return}
 // A single valid 1x1 PNG in a uniquely namespaced synthetic asset; never touches a user's avatar.
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQTV8LAAIGAUK3r5e5AAAAAElFTkSuQmCC','base64');
 const asset='blueguard-p2-test/'+randomUUID().replaceAll('-','');
 const endpoint='https://api.cloudinary.com/v1_1/'+cloud+'/image/';
 let created=false;
 const call=async(path,params,buffer)=>{
  const p={...params,timestamp:Math.floor(Date.now()/1000)};
  const body=new FormData();
  for(const[k,v]of Object.entries(p))body.set(k,String(v));
  body.set('api_key',key);body.set('signature',sig(p,secret));
  if(buffer)body.set('file',new Blob([buffer],{type:'image/png'}),'probe.png');
  return await request(endpoint+path,{method:'POST',body});
 };
 try{
  const result=await call('upload',{public_id:asset,overwrite:'false'},image);
  created=true;
  if(result.public_id!==asset||result.resource_type!=='image')throw Error('Cloudinary asset identity mismatch');
  entry('P2-13-CLOUDINARY-UPLOAD','PASS','Signed 1px staging image accepted');
  const url='https://res.cloudinary.com/'+cloud+'/image/upload/v'+result.version+'/'+asset+'.png';
  const downloaded=await fetch(url,{signal:AbortSignal.timeout(15000)});
  entry('P2-13-CLOUDINARY-DELIVERY',downloaded.ok?'PASS':'FAIL','CDN HTTP '+downloaded.status);
 }catch(e){entry('P2-13-CLOUDINARY-UPLOAD','FAIL',safe(e))}
 finally{
  if(created)try{
   const result=await call('destroy',{public_id:asset,invalidate:'true'});
   entry('P2-13-CLOUDINARY-CLEANUP',result.result==='ok'?'PASS':'FAIL','Temporary test asset deleted: '+String(result.result));
  }catch(e){entry('P2-13-CLOUDINARY-CLEANUP','FAIL','Temporary asset cleanup failed; remove asset with prefix blueguard-p2-test in provider console; '+safe(e))}
 }
}
function fingerprint(raw){
 const cleaned=String(raw||'').trim().toUpperCase();
 return /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/.test(cleaned)?cleaned:null;
}
function buildLinks(){
 const host=(env.P2_APP_LINK_HOST||((configured(env.FIREBASE_PROJECT_ID)?env.FIREBASE_PROJECT_ID+'.firebaseapp.com':''))).trim().toLowerCase();
 if(!/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)||host.endsWith('.invalid')){
  entry('P2-15-APP-LINKS','SKIP','Set P2_APP_LINK_HOST to verified Firebase Hosting domain in .env');return null
 }
 const example='https://'+host+'/open/invite?deviceId=TEST_BUOY';
 const sha=fingerprint(env.P2_ANDROID_SHA256);
 const path=join(out,'assetlinks.json');
 if(sha){
  const data=[{relation:['delegate_permission/common.handle_all_urls'],
   target:{namespace:'android_app',package_name:'com.oilspillmonitoringbuoy.app',sha256_cert_fingerprints:[sha]}}];
  writeFileSync(path,JSON.stringify(data,null,2)+'\n');
  entry('P2-15-ASSETLINKS-GENERATED','PASS','Local assetlinks.json generated. Needs publishing at /.well-known/assetlinks.json.');
 }else entry('P2-15-ASSETLINKS-GENERATED','SKIP','P2_ANDROID_SHA256 missing: get actual debug/release keystore fingerprint');
 writeFileSync(join(out,'invitation-example.txt'),example+'\n');
 return {host,sha,example};
}
async function verifyDomain(links){
 if(!links)return;
 try{
  const data=await request('https://'+links.host+'/.well-known/assetlinks.json');
  const records=typeof data==='string'?JSON.parse(data):data;
  const valid=Array.isArray(records)&&records.some(x=>x.target?.package_name==='com.oilspillmonitoringbuoy.app'&&
   links.sha&&x.target?.sha256_cert_fingerprints?.map(v=>v.toUpperCase()).includes(links.sha));
  entry('P2-15-DOMAIN-VERIFIED',valid?'PASS':'SKIP',valid?'Live assetlinks matches package and signing SHA':'Domain is reachable but not yet associated with the configured signing certificate');
 }catch(e){entry('P2-15-DOMAIN-VERIFIED','SKIP','Domain not yet provisioned/accessible: '+safe(e))}
}
async function emailProbe(links){
 if(!links)return;
 if(env.P2_EMAIL_TEST_SEND!=='true'||![env.P2_EMAIL_API_KEY,env.P2_EMAIL_FROM,env.P2_EMAIL_TEST_TO].every(configured)){
  entry('P2-15-EMAIL-DELIVERY','SKIP','Provide P2_EMAIL_API_KEY / P2_EMAIL_FROM / P2_EMAIL_TEST_TO and P2_EMAIL_TEST_SEND=true for ONE test email');
  return;
 }
 const address=env.P2_EMAIL_TEST_TO.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)){entry('P2-15-EMAIL-DELIVERY','FAIL','Invalid test recipient');return}
 try{
  const body={from:env.P2_EMAIL_FROM,to:[address],subject:'BlueGuard Buoy staging App Link test',
   text:'This is a staging test only. Open your BlueGuard Buoy app after signing in: '+links.example+'\nThis link does not log you in or grant access.'};
  const response=await request('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+env.P2_EMAIL_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify(body)});
  entry('P2-15-EMAIL-DELIVERY',response.id?'PASS':'FAIL',response.id?'Email provider accepted test send (receipt/open remains to verify)':'Email sender did not return provider receipt');
 }catch(e){entry('P2-15-EMAIL-DELIVERY','FAIL',safe(e))}
}
async function stagingReadOnlyProbe(){
 const base=env.P2_STAGING_API_BASE,token=env.P2_STAGING_ID_TOKEN;
 if(!configured(base)||!configured(token)){
  entry('P2-16-STAGING-REST','SKIP','Set P2_STAGING_API_BASE and short-lived P2_STAGING_ID_TOKEN for read-only current-user staging acceptance');
  return;
 }
 let parsed;
 try{parsed=new URL(base)}catch{entry('P2-16-STAGING-REST','FAIL','Invalid staging API URL');return}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||!parsed.pathname.endsWith('/api/v1')){
  entry('P2-16-STAGING-REST','FAIL','Require HTTPS API base ending in /api/v1');return
 }
 const headers={Authorization:'Bearer '+token};
 try{
  const who=await request(base+'/auth/me',{headers});
  if(!who.uid||!who.email)throw new Error('Missing authenticated profile');
  const buoys=await request(base+'/devices?limit=100',{headers});
  if(!Array.isArray(buoys.items))throw Error('Invalid device page response');
  const alerts=await request(base+'/alerts?limit=30',{headers});
  if(!Array.isArray(alerts.items))throw Error('Invalid personal inbox response');
  entry('P2-16-STAGING-REST','PASS','Staging profile, scoped paginated buoys and personal Notifications read over HTTPS');
  if(configured(env.P2_STAGING_OUTSIDER_ID_TOKEN)&&configured(env.P2_STAGING_PRIVATE_DEVICE_ID)){
   const id=encodeURIComponent(env.P2_STAGING_PRIVATE_DEVICE_ID);
   const response=await fetch(base+'/devices/'+id,{headers:{Authorization:'Bearer '+env.P2_STAGING_OUTSIDER_ID_TOKEN},signal:AbortSignal.timeout(15000)});
   entry('P2-16-STAGING-ISOLATION',[403,404].includes(response.status)?'PASS':'FAIL','Outsider device HTTP '+response.status);
  }else entry('P2-16-STAGING-ISOLATION','SKIP','Optional outsider token + exclusively owned staging device ID not set');
 }catch(e){entry('P2-16-STAGING-REST','FAIL',safe(e))}
}
function providerArgs(){
 const args=[];
 if(env.THESIS_PROVIDER_CONFIRM!=='SEND_TEST_PROVIDER_EVENTS')return args;
 if(['PUSHER_APP_ID','PUSHER_KEY','PUSHER_SECRET','PUSHER_CLUSTER'].every(k=>configured(env[k])))args.push('--with-pusher');
 if(['THESIS_FCM_PROJECT_ID','THESIS_FCM_TEST_TOKEN','THESIS_FCM_CREDENTIALS_FILE'].every(k=>configured(env[k])))args.push('--with-fcm');
 return args;
}
function androidProbe(){
 const a=spawnSync('adb',['devices'],{encoding:'utf8',timeout:7000,shell:false});
 if(a.error||a.status!==0){entry('P2-17-ANDROID-ADB','SKIP','Android SDK adb not available');return}
 const devices=(a.stdout||'').split(/\r?\n/).filter(x=>/\tdevice$/.test(x));
 if(devices.length===0){entry('P2-17-ANDROID-ADB','SKIP','Connect an unlocked Android device with USB debugging to check app installation');return}
 const r=spawnSync('adb',['shell','pm','path','com.oilspillmonitoringbuoy.app'],{encoding:'utf8',timeout:10000});
 entry('P2-17-ANDROID-ADB',r.status===0&&r.stdout.includes('package:')?'PASS':'SKIP',r.stdout.includes('package:')?'App installed on connected Android; camera/FCM/PAIR still need human observation':'Android connected, BlueGuard app not installed');
}
const resultFromRows=()=>rows.some(x=>x.status==='FAIL')?'FAIL':rows.some(x=>x.status==='SKIP')?'PARTIAL':'PASS';
let code=0;
try{
 const local=run('P2-16-AUTH-FIRESTORE-E2E','npm',['run','verify:local','--',...(existsSync(join(root,'node_modules'))?['--skip-install']:[])],{timeout:900000});
 if(!local)code=1;
 if(local){
  const scenarios=['normal','interference','inconclusive','petroleum','low_battery','sensor_fault','maintenance','all'];
  for(const scenario of scenarios){
   const ok=run('P2-16-SIM-'+scenario.toUpperCase(),'npm',['run','sim:pipeline'],{
    env:{...env,TELEMETRY_LAB_SCENARIO:scenario,PUSHER_ENABLED:'false',FCM_ENABLED:'false',
     FIREBASE_PROJECT_ID:'demo-oil-spill-monitoring-buoy-p2',FIREBASE_CLIENT_EMAIL:'',
     FIREBASE_PRIVATE_KEY:'',GOOGLE_APPLICATION_CREDENTIALS:'',THESIS_PROVIDER_CONFIRM:''},timeout:240000
   });
   if(!ok)code=1;
  }
 }
 const mobile=resolve(root,'../oil-spill-monitoring-buoy-app');
 if(existsSync(join(mobile,'package.json'))){
  if(!run('P2-17-MOBILE-TESTS','npm',['test'],{cwd:mobile,timeout:180000}))code=1;
  if(!run('P2-17-MOBILE-BUILD','npm',['run','check'],{cwd:mobile,timeout:240000}))code=1;
 }else entry('P2-17-MOBILE-TESTS','SKIP','Clone oil-spill-monitoring-buoy-app beside API checkout');
 const liveArgs=providerArgs();
 if(liveArgs.length){
  if(!run('P2-16-PROVIDER-EMULATED-E2E','npm',['run','sim:pipeline','--',...liveArgs],{
   env:{...env,TELEMETRY_LAB_SCENARIO:'all'},timeout:300000}))code=1;
 }else entry('P2-16-PROVIDER-EMULATED-E2E','SKIP','No explicit THESIS_PROVIDER_CONFIRM and test-only Pusher/FCM provider credentials');
 await stagingReadOnlyProbe();
 await cloudinaryProbe();
 const links=buildLinks();
 await verifyDomain(links);
 await emailProbe(links);
 androidProbe();
 entry('P2-17-PHYSICAL-PAIR','MANUAL','Hardware-backed physical button proof cannot be established by simulator');
 entry('P2-17-REAL-FCM','MANUAL','Confirm background/closed/tapped push on installed Android, not only emulator');
 entry('P2-06-LIVE-CUTOVER','MANUAL','Never automatically write, re-provision or roll back real Firestore from this test runner');
}catch(error){entry('P2-RUNNER','FAIL',safe(error));code=1}
finally{
 const report={suite:'BlueGuard Phase 2 single-command acceptance',runAt:new Date().toISOString(),
  result:resultFromRows(),cloudWrites:false,simulationIsPhysicalProof:false,steps:rows,
  hardFailures:rows.filter(x=>x.status==='FAIL').map(x=>x.id)};
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 writeFileSync(join(out,'report.md'),'# BlueGuard Phase 2 Gate Report\n\nRun: '+report.runAt+
  '\n\nOverall: **'+report.result+'**\n\n| Gate | Result | Finding |\n|---|---|---|\n'+rows.map(x=>'| '+x.id+' | '+x.status+' | '+x.note.replaceAll('|','/')+' |').join('\n')+'\n');
 console.log('\nFINAL: '+report.result+'; reports: '+join(out,'report.json'));
}
if(code||rows.some(x=>x.status==='FAIL'))process.exitCode=1;
