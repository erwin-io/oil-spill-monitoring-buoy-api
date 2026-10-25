#!/usr/bin/env node
// Explicit SMTP/Gmail configuration and optional controlled 1-email smoke test.
// Reads existing .env, never displays secrets or one-time Firebase auth links.
import 'dotenv/config';
import {emailProvider,mailReadiness,verifySmtpConnection,sendTransactionalEmail} from '../src/mail-transport.js';
const args=process.argv.slice(2);
if(args.some(x=>x!=='--send')){
 console.error('Usage: npm run email:check [-- --send]');
 process.exitCode=2;
}else{
 const provider=emailProvider(),readiness=mailReadiness();
 console.log('Selected email provider: '+(provider||'invalid'));
 console.log('Transport configured: '+(readiness!=='firebase'?'YES':'NO'));
 console.log('Firebase Admin email enabled: '+(process.env.P2_AUTH_EMAIL_ENABLED==='true'?'YES':'NO'));
 if(provider!=='smtp'||readiness!=='smtp'){
  console.error('SMTP is not configured. Require P2_EMAIL_PROVIDER=smtp and valid SMTP_HOST/PORT/SECURE/USER/PASSWORD/FROM.');
  process.exitCode=1;
 }else{
  const connected=await verifySmtpConnection();
  console.log('SMTP TLS connection + authentication: '+(connected?'PASS':'FAIL'));
  if(!connected)process.exitCode=1;
  else if(args.includes('--send')){
   const recipient=process.env.P2_EMAIL_TEST_TO?.trim();
   if(!recipient||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)){
    console.error('P2_EMAIL_TEST_TO is missing or invalid; refusing test send.');
    process.exitCode=2;
   }else{
    const sent=await sendTransactionalEmail({
     to:recipient,
     subject:'BlueGuard Buoy — SMTP staging/prod demo test',
     text:'BlueGuard Buoy SMTP configuration test. This email contains no Firebase action code and does not modify accounts.\n\nIf you received this email, your selected SMTP server accepted the message.'
    });
    console.log('SMTP test recipient accepted: '+(sent?'PASS':'FAIL'));
    console.log('Inbox delivery/Spam receipt must still be verified by the user.');
    if(!sent)process.exitCode=1;
   }
  }else console.log('No email sent. Use: npm run email:check -- --send');
 }
}
