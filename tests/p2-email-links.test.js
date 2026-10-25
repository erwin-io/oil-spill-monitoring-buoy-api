import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invitationLink,sendInvitationEmail} from '../src/email-links.js';
const domain='https://oil-spill-monitoring-buoy.firebaseapp.com';
test('P2-15 email App Link does not include credentials or encode access grants',()=>{
 const url=invitationLink('buoy_21');
 assert.equal(url,domain+'/open/invite?deviceId=buoy_21');
 assert.equal(invitationLink('b-01','transfer'),domain+'/open/transfer?deviceId=b-01');
 for(const id of ['../secrets','b?token=x','', 'x'.repeat(81)])assert.throws(()=>invitationLink(id),{code:'INVALID_LINK_TARGET'});
 assert.throws(()=>invitationLink('abc','oauth'),{code:'INVALID_LINK_TARGET'});
});
test('P2-15 sending email is disabled by default, requires explicit provider permission',async()=>{
 const old=process.env.P2_INVITE_EMAIL_ENABLED;
 try{
  process.env.P2_INVITE_EMAIL_ENABLED='false';
  const result=await sendInvitationEmail('recipient@example.test','buoy_22',async()=>{throw Error('should not send')});
  assert.equal(result.status,'DISABLED');
  assert.match(result.link,/\/open\/invite\?deviceId=buoy_22/);
 }finally{if(old===undefined)delete process.env.P2_INVITE_EMAIL_ENABLED;else process.env.P2_INVITE_EMAIL_ENABLED=old}
});
test('P2-15 send approved recipient only after explicit opt-in, without Firebase credentials',async()=>{
 const vars=['P2_INVITE_EMAIL_ENABLED','P2_EMAIL_API_KEY','P2_EMAIL_FROM'];
 const old=Object.fromEntries(vars.map(x=>[x,process.env[x]]));
 try{
  process.env.P2_INVITE_EMAIL_ENABLED='true';process.env.P2_EMAIL_API_KEY='test-provider-key';
  process.env.P2_EMAIL_FROM='BlueGuard <invites@example.test>';
  let calls=0;
  const result=await sendInvitationEmail('viewer@example.test','buoy_25',async(url,opts)=>{
   calls++;assert.equal(url,'https://api.resend.com/emails');
   assert.equal(opts.headers.Authorization,'Bearer test-provider-key');
   const payload=JSON.parse(opts.body);
   assert.deepEqual(payload.to,['viewer@example.test']);
   assert.ok(payload.text.includes(domain+'/open/invite?deviceId=buoy_25'));
   assert.ok(!payload.text.includes('deviceKey'));
   return {ok:true,json:async()=>({id:'test-sent-message'})};
  });
  assert.equal(result.status,'ACCEPTED');assert.equal(calls,1);
 }finally{for(const name of vars){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name]}}
});
