import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import swagger from './swagger.js';
import {randomUUID} from 'node:crypto';
import * as h from './handlers.js';
import * as transfer from './transfer.js';
import * as pairV2 from './pair-intents.js';
import * as sessions from './push-sessions.js';
import * as avatar from './avatar.js';
import * as emailAction from './auth-email.js';
import {dispatch,offlineSweep} from './jobs.js';
import {userAuth,deviceAuth,requireRole,deviceScope,deviceOwnerScope,deviceOperatorScope,asyncRoute,errorHandler,distributedRateLimit} from './security.js';
import {httpError} from './domain.js';
import {firebase} from './firebase.js';
import {accessibleDeviceIds,accessibleDeviceAccess,requireAccess} from './access.js';
import {cached,invalidating} from './read-cache.js';
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
// Capacitor 7's default Android WebView origin is https://localhost
// (not the Ionic dev server's http://localhost:8100); iOS uses capacitor://localhost.
// These are CORS origins, NOT authentication bypasses. All protected routes
// still verify Firebase ID tokens or per-device credentials.
const nativeOrigins=['https://localhost','capacitor://localhost'];
const origins=new Set([...nativeOrigins,...(process.env.ALLOWED_ORIGINS??'').split(',').map(x=>x.trim()).filter(Boolean)]);
app.use((req,res,next)=>helmet(req.path.startsWith('/swagger')?{contentSecurityPolicy:false}:{})(req,res,next));
// Browser/Capacitor preflight responses can be cached by the WebView for one
// hour. This does not cache protected GET data and does not relax the origin
// allowlist. DevTools "Disable cache" can defeat browser-side caching.
app.use(cors({
 origin:(o,cb)=>!o||origins.has(o)?cb(null,true):cb(httpError('ORIGIN_DENIED',403)),
 maxAge:3600,
 exposedHeaders:['X-BlueGuard-Cache','X-Request-Id','Server-Timing']
}));
app.use(express.json({limit:'24kb',strict:true}));app.use((req,res,next)=>{
 req.requestId=randomUUID();res.set('x-request-id',req.requestId);
 const started=Date.now();
 res.once('finish',()=>{
  // Deliberately exclude raw path/query, IP, body, credentials and response contents.
  console.log(JSON.stringify({event:'api.request',timestamp:new Date().toISOString(),
   requestId:req.requestId,method:req.method,route:req.route?.path??'unmatched',
   status:res.statusCode,durationMs:Date.now()-started}));
 });
 next();
});
app.use(rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
const R=(m,path,...handlers)=>app[m](path,...handlers.map(fn=>fn.length===3?fn:asyncRoute(fn)));
R('get','/health',h.readiness);R('get','/swagger.json',(req,res)=>res.json(swagger));app.use('/swagger',swaggerUi.serve,swaggerUi.setup(swagger));
const p='/api/v1';
// A warm-instance cache never bypasses Firebase token/profile validation.
// Lists also re-check current ownership/sharing on every cache hit, to avoid
// exposing stale devices after a revocation or transfer.
const sameIds=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
 [...a].sort().every((id,index)=>id===[...b].sort()[index]);
const validateMembership=async(req,body,allowedIds)=>{
 const db=firebase().db;
 const current=await accessibleDeviceAccess(db,req.user);
 if(!sameIds(current.map(item=>item.id),allowedIds))return false;
 // A Viewer can become Owner without changing their authorized buoy IDs.
 // Access levels are retrieved in the SAME pass as membership checks.
 if(Array.isArray(body?.items)){
  const byId=new Map(current.map(item=>[item.id,item.access]));
  if(body.items.some(item=>typeof item?.access==='string'&&item.access!==byId.get(item.id)))return false;
 }
 return true;
};
const validateDeviceAccess=(req,body)=>body?.access===req.deviceAccess;
const validateAlertDetail=async(req,body)=>{
 if(typeof body?.deviceId!=='string')return false;
 await requireAccess(firebase().db,req.user,body.deviceId);
 return true;
};
const userTag=req=>req.user?.uid?'user:'+req.user.uid:null;
const deviceTag=req=>'device:'+(req.params?.deviceId??req.deviceId);
const changedUsers=req=>(req.cacheAffectedUsers??[]).map(uid=>'user:'+uid);
const invalidateUser=(req)=>[userTag(req),...changedUsers(req)];
const invalidateDevice=(req)=>[deviceTag(req),userTag(req),...changedUsers(req)];

R('get',p+'/auth/email/config',emailAction.authEmailConfig);
R('post',p+'/auth/email/verification',emailAction.unverifiedIdentity,
  distributedRateLimit('auth_email_verify',5),emailAction.requestVerification);
R('post',p+'/auth/email/password-reset',
  distributedRateLimit('auth_email_reset',8),emailAction.requestPasswordReset);

R('post',p+'/auth/bootstrap',distributedRateLimit('bootstrap',30),invalidating(invalidateUser,h.bootstrap));R('get',p+'/auth/me',userAuth,cached('me',10000,h.me,validateMembership));
R('patch',p+'/auth/me',userAuth,distributedRateLimit('user_change',60),invalidating(invalidateUser,h.updateOwnProfile));
R('put',p+'/auth/avatar',userAuth,distributedRateLimit('avatar_upload',12),express.raw({type:['image/jpeg','image/png','image/webp'],limit:'2mb'}),invalidating(invalidateUser,avatar.putAvatar));
R('delete',p+'/auth/avatar',userAuth,distributedRateLimit('avatar_delete',6),invalidating(invalidateUser,avatar.deleteAvatar));
R('get',p+'/devices',userAuth,cached('devices',20000,h.listDevices,validateMembership));R('post',p+'/devices',userAuth,requireRole('ADMIN'),distributedRateLimit('user_change',60),invalidating(()=>['scope:devices','scope:alerts'],h.registerDevice));
R('get',p+'/devices/:deviceId',userAuth,deviceScope,cached('device',20000,h.getDevice,validateDeviceAccess));R('patch',p+'/devices/:deviceId',userAuth,requireRole('ADMIN'),distributedRateLimit('user_change',60),invalidating(invalidateDevice,h.updateDevice));
R('post',p+'/devices/:deviceId/rotate-key',userAuth,requireRole('ADMIN'),distributedRateLimit('user_change',60),invalidating(invalidateDevice,h.rotateKey));
R('post',p+'/devices/:deviceId/claim-code',userAuth,requireRole('ADMIN'),distributedRateLimit('claim_admin',10),invalidating(invalidateDevice,h.reissueClaimCode));
// Protocol 2 uses QR with public deviceId only. Protocol 1 handlers remain
// temporarily available for installed old clients until a coordinated cutover.
R('post',p+'/devices/:deviceId/pair-intents',userAuth,distributedRateLimit('pair_intent',6),pairV2.requestPairIntent);
R('get',p+'/devices/:deviceId/pair-intents/:intentId',userAuth,pairV2.pairIntentStatus);
R('delete',p+'/devices/:deviceId/pair-intents/:intentId',userAuth,distributedRateLimit('pair_cancel',12),pairV2.cancelPairIntent);
R('post',p+'/device/pairing-challenges',deviceAuth,distributedRateLimit('pair_start',6),(req,res)=>{
 if(req.body?.protocol===2&&Object.keys(req.body).length===1)return pairV2.deviceStartPairing(req,res);
 if(req.body&&Object.keys(req.body).length===0)return h.startPairing(req,res);
 throw httpError('INVALID_PAIRING_PROTOCOL',422);
});
R('post',p+'/devices/:deviceId/claims',userAuth,distributedRateLimit('claim_request',10),h.requestClaim);
R('get',p+'/devices/:deviceId/claims/:challengeId',userAuth,h.pairingStatus);
R('post',p+'/device/pairing-confirmations',deviceAuth,distributedRateLimit('pair_confirm',12),invalidating(invalidateDevice,(req,res)=>{
 if(req.body?.protocol===2)return pairV2.deviceConfirmPairing(req,res);
 if(req.body&&Object.keys(req.body).sort().join('|')==='challengeId|nonce')return h.confirmPairing(req,res);
 throw httpError('INVALID_PAIRING_PROTOCOL',422);
}));
R('post',p+'/devices/:deviceId/invitations',userAuth,deviceOwnerScope,distributedRateLimit('invite',10),invalidating(invalidateDevice,h.inviteViewer));
R('get',p+'/invitations',userAuth,cached('invitations',20000,h.myInvitations));
R('post',p+'/devices/:deviceId/invitations/accept',userAuth,distributedRateLimit('invite_accept',15),invalidating(invalidateDevice,h.acceptInvitation));
R('delete',p+'/devices/:deviceId/viewers/:viewerUid',userAuth,deviceOwnerScope,distributedRateLimit('invite',10),invalidating(invalidateDevice,h.revokeViewer));
R('post',p+'/devices/:deviceId/transfer',userAuth,deviceOwnerScope,distributedRateLimit('transfer',6),invalidating(invalidateDevice,transfer.startTransfer));
R('delete',p+'/devices/:deviceId/transfer',userAuth,deviceOwnerScope,distributedRateLimit('transfer',6),invalidating(invalidateDevice,transfer.cancelTransfer));
R('get',p+'/transfers/incoming',userAuth,cached('transfers',20000,transfer.incomingTransfers));
R('post',p+'/devices/:deviceId/transfer/accept',userAuth,distributedRateLimit('transfer_accept',6),invalidating(invalidateDevice,transfer.acceptTransfer));
R('post',p+'/device/measurements',deviceAuth,distributedRateLimit('telemetry',240),invalidating(invalidateDevice,h.ingestMeasurement));R('post',p+'/device/health',deviceAuth,distributedRateLimit('telemetry',240),invalidating(invalidateDevice,h.ingestHealth));
R('get',p+'/devices/:deviceId/measurements',userAuth,deviceScope,cached('measurements',15000,h.history));R('get',p+'/devices/:deviceId/measurements/latest',userAuth,deviceScope,cached('latest',15000,h.latest));
R('get',p+'/devices/:deviceId/health',userAuth,deviceScope,cached('health',15000,h.healthHistory));
R('get',p+'/device/config',deviceAuth,h.deviceConfig);R('get',p+'/devices/:deviceId/config',userAuth,deviceScope,cached('config',20000,h.userConfig));
R('put',p+'/devices/:deviceId/config',userAuth,deviceOperatorScope,distributedRateLimit('user_change',60),invalidating(invalidateDevice,h.putConfig));
R('post',p+'/notifications/read-all',userAuth,distributedRateLimit('user_change',60),invalidating(req=>['alerts-user:'+req.user.uid],h.markAllAlertsRead));
R('get',p+'/alerts',userAuth,cached('alerts',10000,h.alerts,validateMembership));R('get',p+'/alerts/:alertId',userAuth,cached('alert-detail',10000,h.alertDetail,validateAlertDetail));R('post',p+'/alerts/:alertId/read',userAuth,distributedRateLimit('user_change',60),invalidating(req=>['alerts-user:'+req.user.uid],h.markAlertRead));R('patch',p+'/alerts/:alertId/acknowledge',userAuth,distributedRateLimit('user_change',60),invalidating(req=>['user:'+req.user.uid,...changedUsers(req),...(req.cacheDeviceIds??[]).map(id=>'device:'+id)],h.acknowledge));
R('post',p+'/notifications/sessions',userAuth,distributedRateLimit('push_session',12),sessions.createPushSession);
R('post',p+'/notifications/sessions/:sessionId/refresh',userAuth,distributedRateLimit('push_session',12),sessions.refreshPushSession);
R('delete',p+'/notifications/sessions/:sessionId',userAuth,distributedRateLimit('push_session',12),sessions.revokePushSession);
R('post',p+'/notifications/register-device',userAuth,distributedRateLimit('push_register',30),h.registerPush);R('delete',p+'/notifications/unregister-device',userAuth,distributedRateLimit('push_register',30),h.unregisterPush);
R('get',p+'/realtime/config',userAuth,(req,res)=>{res.set('Cache-Control','no-store');const key=process.env.PUSHER_KEY??'',cluster=process.env.PUSHER_CLUSTER??'';const enabled=process.env.PUSHER_ENABLED==='true'&&!!process.env.PUSHER_APP_ID&&!!process.env.PUSHER_SECRET&&/^[A-Za-z0-9_-]{5,120}$/.test(key)&&/^[a-z0-9-]{2,20}$/.test(cluster);res.json(enabled?{enabled:true,key,cluster}:{enabled:false});});
R('post',p+'/realtime/auth',userAuth,distributedRateLimit('realtime_auth',120),h.pusherAuth);
R('get',p+'/jobs/dispatch',dispatch);R('get',p+'/jobs/offline',offlineSweep);
app.use((req,res,next)=>next(httpError('NOT_FOUND',404)));app.use(errorHandler);
export default app;
