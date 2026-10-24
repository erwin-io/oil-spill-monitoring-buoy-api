import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import swagger from './swagger.js';
import {randomUUID} from 'node:crypto';
import * as h from './handlers.js';
import {dispatch,offlineSweep} from './jobs.js';
import {userAuth,deviceAuth,requireRole,deviceScope,asyncRoute,errorHandler,distributedRateLimit} from './security.js';
import {httpError} from './domain.js';
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
// Capacitor 7's default Android WebView origin is https://localhost
// (not the Ionic dev server's http://localhost:8100); iOS uses capacitor://localhost.
// These are CORS origins, NOT authentication bypasses. All protected routes
// still verify Firebase ID tokens or per-device credentials.
const nativeOrigins=['https://localhost','capacitor://localhost'];
const origins=new Set([...nativeOrigins,...(process.env.ALLOWED_ORIGINS??'').split(',').map(x=>x.trim()).filter(Boolean)]);
app.use((req,res,next)=>helmet(req.path.startsWith('/swagger')?{contentSecurityPolicy:false}:{})(req,res,next));
app.use(cors({origin:(o,cb)=>!o||origins.has(o)?cb(null,true):cb(httpError('ORIGIN_DENIED',403))}));
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
R('post',p+'/auth/bootstrap',distributedRateLimit('bootstrap',30),h.bootstrap);R('get',p+'/auth/me',userAuth,h.me);
R('get',p+'/devices',userAuth,h.listDevices);R('post',p+'/devices',userAuth,requireRole('ADMIN'),distributedRateLimit('user_change',60),h.registerDevice);
R('get',p+'/devices/:deviceId',userAuth,deviceScope,h.getDevice);R('patch',p+'/devices/:deviceId',userAuth,requireRole('ADMIN'),distributedRateLimit('user_change',60),h.updateDevice);
R('post',p+'/devices/:deviceId/rotate-key',userAuth,requireRole('ADMIN'),distributedRateLimit('user_change',60),h.rotateKey);
R('post',p+'/devices/:deviceId/claim-code',userAuth,requireRole('ADMIN'),distributedRateLimit('claim_admin',10),h.reissueClaimCode);
R('post',p+'/device/pairing-challenges',deviceAuth,distributedRateLimit('pair_start',6),h.startPairing);
R('post',p+'/devices/:deviceId/claims',userAuth,distributedRateLimit('claim_request',10),h.requestClaim);
R('get',p+'/devices/:deviceId/claims/:challengeId',userAuth,h.pairingStatus);
R('post',p+'/device/pairing-confirmations',deviceAuth,distributedRateLimit('pair_confirm',12),h.confirmPairing);
R('post',p+'/device/measurements',deviceAuth,distributedRateLimit('telemetry',240),h.ingestMeasurement);R('post',p+'/device/health',deviceAuth,distributedRateLimit('telemetry',240),h.ingestHealth);
R('get',p+'/devices/:deviceId/measurements',userAuth,deviceScope,h.history);R('get',p+'/devices/:deviceId/measurements/latest',userAuth,deviceScope,h.latest);
R('get',p+'/devices/:deviceId/health',userAuth,deviceScope,h.healthHistory);
R('get',p+'/device/config',deviceAuth,h.deviceConfig);R('get',p+'/devices/:deviceId/config',userAuth,deviceScope,h.userConfig);
R('put',p+'/devices/:deviceId/config',userAuth,requireRole('OPERATOR','ADMIN'),deviceScope,distributedRateLimit('user_change',60),h.putConfig);
R('get',p+'/alerts',userAuth,h.alerts);R('get',p+'/alerts/:alertId',userAuth,h.alertDetail);R('post',p+'/alerts/:alertId/read',userAuth,distributedRateLimit('user_change',60),h.markAlertRead);R('patch',p+'/alerts/:alertId/acknowledge',userAuth,requireRole('OPERATOR','ADMIN'),distributedRateLimit('user_change',60),h.acknowledge);
R('post',p+'/notifications/register-device',userAuth,distributedRateLimit('push_register',30),h.registerPush);R('delete',p+'/notifications/unregister-device',userAuth,distributedRateLimit('push_register',30),h.unregisterPush);
R('post',p+'/realtime/auth',userAuth,distributedRateLimit('realtime_auth',120),h.pusherAuth);
R('get',p+'/jobs/dispatch',dispatch);R('get',p+'/jobs/offline',offlineSweep);
app.use((req,res,next)=>next(httpError('NOT_FOUND',404)));app.use(errorHandler);
export default app;
