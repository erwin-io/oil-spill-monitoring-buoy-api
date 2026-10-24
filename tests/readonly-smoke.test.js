import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeLiveReadOnly,resourcePaths} from '../scripts/verify-existing-firebase.mjs';

const token=claims=>'x.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
const ok=(value,status=200)=>({status,ok:status>=200&&status<300,text:async()=>JSON.stringify(value)});
const env={
 THESIS_API_BASE_URL:'http://localhost:3000/api/v1',
 THESIS_FIREBASE_WEB_API_KEY:'public-client-key',
 THESIS_FIREBASE_PROJECT_ID:'existing-thesis-project',
 THESIS_TEST_EMAIL:'verified@example.test',
 THESIS_TEST_PASSWORD:'test-password',
 THESIS_TEST_DEVICE_ID:'THESIS_TEST_01',
};
test('existing-project smoke has only GET API probes and properly escaped device paths',()=>{
 const paths=resourcePaths('THESIS TEST/1','alert/1');
 assert.ok(paths.every(x=>x.startsWith('/')));
 assert.ok(paths.includes('/devices/THESIS%20TEST%2F1'));
 assert.ok(paths.includes('/alerts/alert%2F1'));
});
test('existing-project smoke authenticates a verified user, makes only GET API requests, and skips missing latest history',async()=>{
 const calls=[];
 const fake=async(url,options={})=>{
  const path=new URL(String(url)).pathname;
  calls.push({path,method:options.method||'GET'});
  if(path.includes(':signInWithPassword'))return ok({idToken:token({aud:'existing-thesis-project',email_verified:true,user_id:'uid-1'})});
  if(path==='/health')return ok({status:'ok'});
  if(path.endsWith('/auth/me'))return ok({uid:'uid-1',role:'VIEWER',allowedDeviceIds:['THESIS_TEST_01']});
  if(path.endsWith('/devices')||path.endsWith('/alerts'))return ok({items:[]});
  if(path.endsWith('/measurements/latest'))return ok({code:'NO_MEASUREMENTS'},404);
  if(path.endsWith('/measurements')||path.endsWith('/health'))return ok({items:[],nextCursor:null});
  if(path.endsWith('/config'))return ok({configVersion:1});
  if(path.endsWith('/THESIS_TEST_01'))return ok({id:'THESIS_TEST_01'});
  throw new Error('Unexpected URL '+path);
 };
 const result=await probeLiveReadOnly(env,fake);
 assert.equal(result.result,'PASS');
 assert.equal(result.firestoreWrites,0);
 assert.ok(result.results.some(x=>x.outcome==='SKIP_EMPTY_HISTORY'));
 assert.deepEqual(calls.filter(x=>x.method!=='GET').map(x=>x.method),['POST']);
 assert.ok(calls.every(c=>c.method==='GET'||c.path.includes(':signInWithPassword')));
});
test('existing-project smoke rejects cross-project token before contacting API',async()=>{
 let calls=0;
 const fake=async()=>{calls++;return ok({idToken:token({aud:'different-project',email_verified:true,user_id:'uid'})})};
 await assert.rejects(probeLiveReadOnly(env,fake),/project mismatch/);
 assert.equal(calls,1);
});
test('existing-project smoke blocks public HTTP and missing credentials before contacting API',async()=>{
 let calls=0;
 const fake=async()=>{calls++;throw new Error('Should not execute');};
 await assert.rejects(probeLiveReadOnly({...env,THESIS_API_BASE_URL:'http://example.com/api/v1'},fake),/HTTPS/);
 await assert.rejects(probeLiveReadOnly({...env,THESIS_TEST_PASSWORD:''},fake),/Missing THESIS_TEST_PASSWORD/);
 assert.equal(calls,0);
});
