import {createHash} from 'node:crypto';
const fingerprint=value=>value?createHash('sha256').update(value).digest('hex').slice(0,12):null;
export function planReprovision(inventory){
 if(!Array.isArray(inventory)||inventory.some(x=>!x.deviceId||!Number.isInteger(x.measurements)||!Number.isInteger(x.alerts)))
  throw Error('INVALID_INVENTORY');
 const duplicate=new Set();
 for(const row of inventory){if(duplicate.has(row.deviceId))throw Error('DUPLICATE_DEVICE');duplicate.add(row.deviceId);}
 return {
  mode:'CLEAN_REPROVISION',dryRunOnly:true,deviceCount:inventory.length,
  requiresIndividualSecureClaim:inventory.map(x=>x.deviceId),
  blocked:inventory.filter(x=>x.hasOwner).map(x=>({deviceId:x.deviceId,reason:'EXISTING_OWNER_REQUIRES_AUTHORIZED_TRANSFER'})),
  preserved:{measurements:inventory.reduce((n,x)=>n+x.measurements,0),
   alerts:inventory.reduce((n,x)=>n+x.alerts,0),
   notificationOutbox:inventory.reduce((n,x)=>n+(x.notificationOutbox??0),0)},
  devices:inventory.map(x=>({deviceId:x.deviceId,ownerFingerprint:fingerprint(x.ownerUid),
   transition:x.hasOwner?'TRANSFER_ONLY':'REQUIRE_PAIR_AND_CLAIM',
   keepDeviceId:true,retainHistory:true,retireLegacyAclOnlyAtAuthorizedCutover:true})),
 };
}
// This models an isolated disposable snapshot, NOT a write plan. Restoring its
// original clone must preserve every identity and historical record exactly.
export function simulateReprovisionAndRollback(snapshot){
 const original=structuredClone(snapshot);
 const simulated=structuredClone(snapshot);
 for(const d of simulated.devices??[]){
  if(d.ownerUid)continue; // Owned buoys cannot be reset/reclaimed without authorized transfer.
  d.needsPairing=true;
 }
 for(const u of simulated.users??[])u.allowedDeviceIds=[];
 const rolledBack=structuredClone(original);
 const unchanged=JSON.stringify(rolledBack)===JSON.stringify(original);
 const sameHistory=JSON.stringify(simulated.measurements)===JSON.stringify(original.measurements)&&
  JSON.stringify(simulated.alerts)===JSON.stringify(original.alerts)&&
  JSON.stringify(simulated.notifications)===JSON.stringify(original.notifications);
 if(!unchanged||!sameHistory)throw Error('PRESERVATION_FAILURE');
 return {dryRunOnly:true,simulated,rolledBack,preservedHistory:sameHistory,rollbackExact:unchanged};
}
