import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 smtpSettings,mailReadiness,mailConfigReady,sendTransactionalEmail,
 verifySmtpConnection,emailProvider
} from '../src/mail-transport.js';
const valid={
 P2_EMAIL_PROVIDER:'smtp',
 SMTP_HOST:'smtp.gmail.com',
 SMTP_PORT:'465',
 SMTP_SECURE:'true',
 SMTP_USER:'blueguard.sender@gmail.com',
 SMTP_PASSWORD:'abcd efgh ijkl mnop',
 SMTP_FROM:'BlueGuard Buoy <blueguard.sender@gmail.com>'
};
const message={to:'registered.owner@gmail.com',subject:'BlueGuard Buoy — Verify Email',
 text:'Firebase one-time link is included only in email content.'};
test('P2 email: authenticated Gmail SSL/465 and mandatory STARTTLS/587 are validated',()=>{
 const v=smtpSettings(valid);
 assert.equal(v.host,'smtp.gmail.com');
 assert.equal(v.port,465);assert.equal(v.secure,true);
 assert.equal(v.auth.pass,'abcdefghijklmnop');assert.equal(v.tls.rejectUnauthorized,true);
 assert.equal(mailReadiness(valid),'smtp');
 const tls587={...valid,SMTP_PORT:'587',SMTP_SECURE:'false'};
 assert.equal(smtpSettings(tls587).requireTLS,true);
 for(const env of [
 {...valid,SMTP_PASSWORD:''},
 {...valid,SMTP_PASSWORD:'YOUR_APP_PASSWORD'},
 {...valid,SMTP_PORT:'587',SMTP_SECURE:'true'},
 {...valid,SMTP_PORT:'465',SMTP_SECURE:'false'},
 {...valid,SMTP_PORT:'25'},
 {...valid,SMTP_FROM:'Someone Else <outsider@example.com>'},
 {...valid,SMTP_FROM:'bad\nBcc:attack@example.com'},
 {...valid,SMTP_USER:'bad-email'},
 {...valid,SMTP_HOST:'localhost:123'},
 {...valid,SMTP_SECURE:'false'},
 ]){
  assert.equal(smtpSettings(env),null,JSON.stringify({...env,SMTP_PASSWORD:'[REDACTED]'}));
  assert.equal(mailReadiness(env),'firebase');
 }
});
test('P2 email: provider choice is explicit and Resend compatibility preserved',()=>{
 assert.equal(mailReadiness({...valid,P2_EMAIL_PROVIDER:'bogus'}),'firebase');
 assert.equal(emailProvider({...valid,P2_EMAIL_PROVIDER:'bogus'}),null);
 assert.equal(mailReadiness({
   P2_EMAIL_PROVIDER:'resend',P2_EMAIL_API_KEY:'re_test',
   P2_EMAIL_FROM:'BlueGuard <noreply@verified.example>'
 }),'resend');
 assert.equal(mailConfigReady(valid),true);
});
test('P2 email: Nodemailer sends through authenticated TLS with no leaked passwords or fallback',async()=>{
 let sent=0,closed=0,seen;
 const fake=options=>{
  seen=options;
  return {
   sendMail:async mail=>{
    sent++;
    assert.equal(mail.to,message.to);
    assert.equal(mail.from,valid.SMTP_FROM);
    assert.equal(mail.disableFileAccess,true);
    assert.equal(mail.disableUrlAccess,true);
    return {accepted:[mail.to],rejected:[]}
   },
   verify:async()=>true,
   close:()=>{closed++}
  };
 };
 const result=await sendTransactionalEmail(message,{env:valid,createTransport:fake,
  fetch:()=>{throw Error('Resend must not be invoked')}});
 assert.equal(result,true);
 assert.equal(sent,1);assert.equal(closed,1);
 assert.equal(seen.auth.user,valid.SMTP_USER);
 assert.equal(seen.auth.pass,'abcdefghijklmnop');
 assert.equal(seen.tls.rejectUnauthorized,true);
 assert.equal(await verifySmtpConnection({env:valid,createTransport:fake}),true);
 assert.equal(closed,2);
});
test('P2 email: SMTP rejection and network failures never claim success; no fallback sender',async()=>{
 for(const mode of ['reject','throw','notAccepted']){
  let closeCount=0;
  const ok=await sendTransactionalEmail(message,{env:valid,createTransport:()=>({
   sendMail:async()=>{
    if(mode==='throw')throw Error('AUTH_INVALID fake password');
    if(mode==='notAccepted')return {accepted:['someone-else@example.com']};
    return {accepted:[],rejected:[message.to]}
   },
   close:()=>{closeCount++}
  })});
  assert.equal(ok,false);
  assert.equal(closeCount,1);
 }
 const untrusted={...message,subject:'Reset password\r\nBcc:outsider@example.com'};
 assert.equal(await sendTransactionalEmail(untrusted,{env:valid,createTransport:()=>{throw Error('should not connect')}}),false);
});
test('P2 email: HTTP provider remains usable only when explicitly selected',async()=>{
 let called=0;
 const cfg={...valid,P2_EMAIL_PROVIDER:'resend',P2_EMAIL_API_KEY:'re_test',
  P2_EMAIL_FROM:'BlueGuard <noreply@verified.example>'};
 const yes=await sendTransactionalEmail(message,{env:cfg,fetch:async(url,options)=>{
  called++;assert.equal(url,'https://api.resend.com/emails');
  const body=JSON.parse(options.body);
  assert.deepEqual(body.to,[message.to]);
  return {ok:true,json:async()=>({id:'receipt-42'})};
 },createTransport:()=>{throw Error('never SMTP for Resend')}});
 assert.equal(yes,true);assert.equal(called,1);
});
