import {httpError} from './domain.js';

// Navigation-only link. Any operation still requires the invited Firebase uid,
// verified email, ACTIVE account and a current pending Firestore invitation.
const allowedHost='oil-spill-monitoring-buoy.firebaseapp.com';
const validId=/^[A-Za-z0-9_-]{1,80}$/;
export function invitationLink(id,action='invite'){
 if(!validId.test(id)||!['invite','transfer'].includes(action))
  throw httpError('INVALID_LINK_TARGET',422);
 const host=(process.env.P2_APP_LINK_HOST||allowedHost).trim().toLowerCase();
 if(host!==allowedHost)throw httpError('APP_LINK_DOMAIN_UNAPPROVED',503);
 return 'https://'+host+'/open/'+action+'?deviceId='+encodeURIComponent(id);
}
export async function sendInvitationEmail(email,id,fetchImpl=fetch){
 const link=invitationLink(id);
 if(process.env.P2_INVITE_EMAIL_ENABLED!=='true')return {status:'DISABLED',link};
 const apiKey=process.env.P2_EMAIL_API_KEY,from=process.env.P2_EMAIL_FROM;
 if(!apiKey||!from)return {status:'NOT_CONFIGURED',link};
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw httpError('INVITEE_EMAIL_INVALID',422);
 try{
  const response=await fetchImpl('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify({
    from,to:[email],subject:'BlueGuard Buoy — Invitation to view a buoy',
    text:'You were invited to view a BlueGuard Buoy. On your Android phone, tap this HTTPS link: '+link+
     '\n\nSign in to the installed BlueGuard Buoy app with your verified invited email and accept in My Buoys.'+
     '\n\nThis link does not sign you in or grant access by itself. If you did not expect this invitation, ignore it.'
   }),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)return {status:'FAILED',link};
  const body=await response.json();
  return {status:typeof body.id==='string'?'ACCEPTED':'FAILED',link};
 }catch{return {status:'FAILED',link}}
}
