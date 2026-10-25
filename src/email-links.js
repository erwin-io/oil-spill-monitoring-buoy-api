import {httpError} from './domain.js';
import {mailConfigReady,sendTransactionalEmail} from './mail-transport.js';

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
 if(!mailConfigReady())return {status:'NOT_CONFIGURED',link};
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw httpError('INVITEE_EMAIL_INVALID',422);
 const sent=await sendTransactionalEmail({
  to:email,subject:'BlueGuard Buoy — Invitation to view a buoy',
  text:'You were invited to view a BlueGuard Buoy. On your Android phone, tap this HTTPS link: '+link+
     '\n\nSign in to the installed BlueGuard Buoy app with your verified invited email and accept in My Buoys.'+
     '\n\nThis link does not sign you in or grant access by itself. If you did not expect this invitation, ignore it.'
 },{fetch:fetchImpl});
 return {status:sent?'ACCEPTED':'FAILED',link};
}
