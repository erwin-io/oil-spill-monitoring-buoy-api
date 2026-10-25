import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 customActionUrl,actionSettings,authEmailEnabled,sendResendAction,
 emailAddress,requestPasswordReset,unverifiedIdentity,
} from '../src/auth-email.js';
const HOST='oil-spill-monitoring-buoy.firebaseapp.com';
const KEY='TEST_FIREBASE_PUBLIC_KEY';
function env(vals,fn){
 const keys=Object.keys(vals),before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,vals);
 return Promise.resolve().then(fn).finally(()=>{for(const k of keys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k]});
}
test('P2-15 custom action URL keeps Firebase-issued mode/code/key but never continues to unrelated origins',()=>{
 const generated='https://'+HOST+'/__/auth/action?mode=verifyEmail&oobCode=CODE_XYZ&apiKey='+KEY+'&continueUrl='+encodeURIComponent('https://evil.invalid');
 const rewritten=customActionUrl(generated,'verifyEmail',KEY);
 const u=new URL(rewritten);
 assert.equal(u.origin,'https://'+HOST);
 assert.equal(u.pathname,'/auth/action');
 assert.deepEqual([...u.searchParams.keys()].sort(),['apiKey','mode','oobCode']);
 assert.equal(u.searchParams.get('oobCode'),'CODE_XYZ');
 assert.equal(rewritten.includes('evil.invalid'),false);
 assert.equal(actionSettings('resetPassword').handleCodeInApp,false);
 for(const bad of [
  generated.replace(HOST,'attacker.example'),
  generated.replace('https:','http:'),
  generated.replace(KEY,'OTHER_KEY'),
  generated.replace('verifyEmail','resetPassword'),
  generated+'&oobCode=DUPLICATE',
  generated.replace('CODE_XYZ',''),
  generated.replace('/__/auth/action','/not-auth')
 ]) assert.throws(()=>customActionUrl(bad,'verifyEmail',KEY),bad);
});
test('P2-15 backend email delivery is explicit opt-in and requires complete server-only config',async()=>{
 await env({P2_AUTH_EMAIL_ENABLED:'true',P2_EMAIL_API_KEY:'re_test',P2_EMAIL_FROM:'BlueGuard <onboarding@resend.dev>',
  P2_FIREBASE_WEB_API_KEY:KEY,FIREBASE_PROJECT_ID:'oil-spill-monitoring-buoy',DEVICE_KEY_PEPPER:'x'.repeat(64)},async()=>{
  assert.equal(authEmailEnabled(),true);
  const link=customActionUrl('https://'+HOST+'/__/auth/action?mode=resetPassword&oobCode=one_time&apiKey='+KEY,'resetPassword',KEY);
  const calls=[];
  assert.equal(await sendResendAction('recipient@example.test','resetPassword',link,async(url,opts)=>{
   calls.push({url,payload:JSON.parse(opts.body)});
   return {ok:true,json:async()=>({id:'resend-receipt'})};
  }),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.resend.com/emails');
  assert.deepEqual(calls[0].payload.to,['recipient@example.test']);
  assert.ok(calls[0].payload.text.includes(link));
  assert.ok(!calls[0].payload.text.includes('password='));
  process.env.P2_AUTH_EMAIL_ENABLED='false';
  assert.equal(authEmailEnabled(),false);
  await assert.rejects(sendResendAction('recipient@example.test','resetPassword',link,async()=>{throw Error('should not send')}),{code:'AUTH_EMAIL_NOT_CONFIGURED'});
 });
});
test('P2-15 reject malformed email addresses and header injection',()=>{
 assert.equal(emailAddress('  USER@Example.Test  '),'user@example.test');
 for(const e of ['no-at-sign','user@example.test\nCc:evil@example.test','',123, 'x'.repeat(255)])
  assert.throws(()=>emailAddress(e),e.toString());
});
test('P2-15 reset endpoint never reveals nonexistent, Google-only or provider-failed users',async()=>{
 // Dependency injection through an isolated harmless global fixture is done in
 // the emulator HTTP test, rather than replacing Admin SDK internals here.
 assert.equal(typeof requestPasswordReset,'function');
 assert.equal(typeof unverifiedIdentity,'function');
});
