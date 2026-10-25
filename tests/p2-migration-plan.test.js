import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planReprovision,simulateReprovisionAndRollback} from '../src/migration-plan.js';
test('P2-06 inventory preserves identity and counts, never maps legacy ACL to ownership',()=>{
 const p=planReprovision([{deviceId:'sim_a',ownerUid:null,hasOwner:false,measurements:8,alerts:2,notificationOutbox:2},
 {deviceId:'sim_b',ownerUid:'ownerB',hasOwner:true,measurements:3,alerts:1,notificationOutbox:0}]);
 assert.equal(p.dryRunOnly,true);assert.equal(p.deviceCount,2);
 assert.deepEqual(p.preserved,{measurements:11,alerts:3,notificationOutbox:2});
 assert.deepEqual(p.blocked.map(x=>x.deviceId),['sim_b']);
 assert.equal(p.devices[0].transition,'REQUIRE_PAIR_AND_CLAIM');
 assert.equal(p.devices[1].transition,'TRANSFER_ONLY');
 assert.equal(JSON.stringify(p).includes('ownerB'),false);
 assert.throws(()=>planReprovision([{deviceId:'a',measurements:0,alerts:0},{deviceId:'a',measurements:0,alerts:0}]),/DUPLICATE/);
});
test('P2-06 isolated simulation retains records and restores the exact original snapshot',()=>{
 const snapshot={devices:[{id:'sim_a',ownerUid:null},{id:'sim_b',ownerUid:'uid_owner'}],
 users:[{id:'viewer',allowedDeviceIds:['sim_a']}],
 measurements:[{id:'m1',deviceId:'sim_a'}],alerts:[{id:'a1',deviceId:'sim_b'}],notifications:[{id:'n1'}]};
 const text=JSON.stringify(snapshot);
 const report=simulateReprovisionAndRollback(snapshot);
 assert.equal(report.rollbackExact,true);
 assert.equal(report.preservedHistory,true);
 assert.equal(report.simulated.devices[0].needsPairing,true);
 assert.equal(report.simulated.devices[1].ownerUid,'uid_owner');
 assert.deepEqual(report.simulated.users[0].allowedDeviceIds,[]);
 assert.equal(JSON.stringify(snapshot),text,'no input mutation');
 assert.deepEqual(report.rolledBack,snapshot);
});
