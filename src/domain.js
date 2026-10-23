import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
export const CLASSES=['NORMAL','PETROLEUM','INTERFERENCE','INCONCLUSIVE'];
export const ROLES=['VIEWER','OPERATOR','ADMIN'];
export const CONFIG_DEFAULT={samplingIntervalMinutes:15,measurementRepeats:3,settleSeconds:3,cleaningCycles:2,maxCleaningRetries:3,oilConfidenceThreshold:0.8,lowBatteryThreshold:20};
export function keyHash(secret, pepper){if(!pepper||pepper.length<32)throw new Error('DEVICE_KEY_PEPPER must be >=32 chars');return createHmac('sha256',pepper).update(secret).digest('hex');}
export function keysEqual(a,b){try{const A=Buffer.from(a,'hex'),B=Buffer.from(b,'hex');return A.length===32&&B.length===32&&timingSafeEqual(A,B)}catch{return false}}
export const makeKey=()=>randomBytes(32).toString('base64url');
export const tokenId=t=>createHash('sha256').update(t).digest('hex');
export function canRead(user,deviceId){return user?.role==='ADMIN'||(Array.isArray(user?.allowedDeviceIds)&&user.allowedDeviceIds.includes(deviceId));}
export function canOperate(user){return user?.role==='OPERATOR'||user?.role==='ADMIN'}
export function httpError(code,status=400,message=code){return Object.assign(new Error(message),{code,status})}
export function parseTime(value){const time=new Date(value).getTime();if(!Number.isFinite(time))throw httpError('INVALID_TIMESTAMP');return time}
export function latestWins(current,incoming){return !current?.lastMeasurementAt||parseTime(incoming)>=parseTime(current.lastMeasurementAt)}
export function alertKey(kind,deviceId,source){return `${kind}_${deviceId}_${source}`.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,500)}
export function configNext(current,version,patch){if(!Number.isInteger(version)||version!==(current?.configVersion??1))throw httpError('CONFIG_CONFLICT',409);return {...current,...patch,configVersion:version+1}}
export function retryDelay(attempt){return Math.min(3600000,Math.pow(2,attempt)*15000)}
export function authorizedChannels(user){const channels=[`private-user-${user.uid}`];if(user.role==='ADMIN')channels.push('private-fleet-all');for(const d of user.allowedDeviceIds??[])channels.push(`private-device-${d}`);return channels}

/** Diagnostic conditions accepted from current firmware and the legacy telemetry contract.
 * A single health event can report more than one simultaneous fault.
 */
export function healthAlerts(health, lowBatteryThreshold = CONFIG_DEFAULT.lowBatteryThreshold) {
 const issues=[];
 if(health.batteryPercent!==undefined && health.batteryPercent<lowBatteryThreshold)
  issues.push({type:'LOW_BATTERY',severity:'WARNING'});
 if(['FAULT','FAILED'].includes(health.sensor))
  issues.push({type:'SENSOR_FAULT',severity:'HIGH'});
 if(health.cellStatus==='MAINTENANCE_REQUIRED')
  issues.push({type:'CELL_MAINTENANCE_REQUIRED',severity:'HIGH'});
 return issues;
}
