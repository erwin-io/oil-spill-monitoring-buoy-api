#!/usr/bin/env node
/**
 * Read-only smoke against the ONE EXISTING Firebase project.
 * Requires an existing VERIFIED Email/Password test user.
 * No direct Firestore Admin SDK calls, no bootstrap (it writes), no POST/PUT/PATCH/DELETE.
 * The only POST is Firebase Authentication password sign-in, which issues an ID token
 * without inserting scientific/buoy data. Tokens and credentials are never logged.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const required=['THESIS_API_BASE_URL','THESIS_FIREBASE_WEB_API_KEY','THESIS_FIREBASE_PROJECT_ID','THESIS_TEST_EMAIL','THESIS_TEST_PASSWORD'];
export const resourcePaths=(id,alertId)=>[
 '/auth/me','/devices','/alerts',
 ...(id?[
  `/devices/${encodeURIComponent(id)}`,
  `/devices/${encodeURIComponent(id)}/measurements?limit=5`,
  `/devices/${encodeURIComponent(id)}/measurements/latest`,
  `/devices/${encodeURIComponent(id)}/health?limit=5`,
  `/devices/${encodeURIComponent(id)}/config`,
 ]:[]),
 ...(alertId?[`/alerts/${encodeURIComponent(alertId)}`]:[]),
];

function decodeClaims(jwt){
 const part=jwt?.split('.')[1];
 if(!part)throw new Error('Firebase did not return an ID token');
 return JSON.parse(Buffer.from(part,'base64url').toString('utf8'));
}
async function readResponse(response){
 const text=await response.text();
 try{return JSON.parse(text)}catch{return {message:text.slice(0,180)}}
}
const check=(pass,message)=>{if(!pass)throw new Error(message)};
export async function probeLiveReadOnly(env=process.env,transport=fetch){
 for(const key of required)check(!!env[key],`Missing ${key}`);
 const base=new URL(env.THESIS_API_BASE_URL);
 check(['http:','https:'].includes(base.protocol),'Unsupported API URL');
 check(base.pathname.endsWith('/api/v1'),'API URL must end in /api/v1');
 check(base.protocol==='https:'||['localhost','127.0.0.1','::1'].includes(base.hostname),
  'Use HTTPS for any non-local API');
 const tokenUrl=new URL('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword');
 tokenUrl.searchParams.set('key',env.THESIS_FIREBASE_WEB_API_KEY);
 const authResponse=await transport(tokenUrl,{
  method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({email:env.THESIS_TEST_EMAIL,password:env.THESIS_TEST_PASSWORD,returnSecureToken:true}),
  signal:AbortSignal.timeout(15000),
 });
 const credentials=await readResponse(authResponse);
 check(authResponse.ok,'Firebase sign-in failed (credentials, network or Email/Password provider)');
 const claims=decodeClaims(credentials.idToken);
 check(claims.aud===env.THESIS_FIREBASE_PROJECT_ID,'Firebase project mismatch; refusing cross-project tests');
 check(claims.email_verified===true,'Test user must verify email before live API smoke');
 const baseString=base.toString().replace(/\/$/,'');
 const headers={Authorization:`Bearer ${credentials.idToken}`};
 const report={mode:'existing-firebase-readonly',timestamp:new Date().toISOString(),
  projectId:env.THESIS_FIREBASE_PROJECT_ID,firestoreWrites:0,apiMethods:['GET'],results:[]};
 const healthUrl=new URL('/health',base.origin);
 const health=await transport(healthUrl,{signal:AbortSignal.timeout(15000)});
 report.results.push({endpoint:'/health',status:health.status});
 check(health.ok,'API /health failed');
 const fetchGet=async path=>{
  const response=await transport(baseString+path,{method:'GET',headers,signal:AbortSignal.timeout(15000)});
  report.results.push({endpoint:path,status:response.status});
  return {response,data:await readResponse(response)};
 };
 const me=await fetchGet('/auth/me');
 check(me.response.ok,'/auth/me denied existing verified test user; bootstrap the user manually once using the app first');
 check(me.data.uid===claims.user_id,'API profile belongs to a different user');
 const devices=await fetchGet('/devices');
 check(devices.response.ok&&Array.isArray(devices.data.items),'Device list failed');
 const alerts=await fetchGet('/alerts');
 check(alerts.response.ok&&Array.isArray(alerts.data.items),'Alert list failed');
 const allowedDeviceId=env.THESIS_TEST_DEVICE_ID?.trim();
 if(allowedDeviceId){
  const d=await fetchGet(`/devices/${encodeURIComponent(allowedDeviceId)}`);
  check(d.response.ok,'Specified device unavailable or outside user scope');
  for(const suffix of ['/measurements?limit=5','/measurements/latest','/health?limit=5','/config']){
   const value=await fetchGet(`/devices/${encodeURIComponent(allowedDeviceId)}${suffix}`);
   if(suffix==='/measurements/latest'&&value.response.status===404){
    report.results.at(-1).outcome='SKIP_EMPTY_HISTORY';
   }else check(value.response.ok,'Read-only device subresource failed: '+suffix);
  }
 }else{
  report.results.push({endpoint:'device-scoped screens',outcome:'SKIPPED_NO_TEST_DEVICE_ID'});
 }
 report.result='PASS';
 return report;
}

const invoked=process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1].replaceAll('\\','/')));
if(invoked){
 try{
  const report=await probeLiveReadOnly();
  const dir=join(root,'.test-output');
  mkdirSync(dir,{recursive:true});
  const filename=join(dir,'api-existing-firebase-readonly.json');
  writeFileSync(filename,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({result:report.result,mode:report.mode,checks:report.results,report:filename},null,2));
 }catch(e){console.error('FAIL: '+e.message);process.exitCode=1;}
}
