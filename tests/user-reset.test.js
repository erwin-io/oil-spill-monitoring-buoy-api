import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eligibleForReset,requireExactConfirmation,assertBounded,policy} from '../src/user-reset-policy.js';
test('P2 test-account reset rejects privileged Firebase-backed accounts',()=>{
 for(const role of ['ADMIN','OPERATOR'])
  assert.throws(()=>eligibleForReset({role,ownedDeviceIds:[],accountEmail:'test@example.com',requestedEmail:'test@example.com'}),/PRIVILEGED_ACCOUNT_BLOCKED/);
});
test('P2 account reset never unclaims an owned buoy',()=>{
 assert.throws(()=>eligibleForReset({role:'VIEWER',ownedDeviceIds:['buoy_owned'],accountEmail:'test@example.com',requestedEmail:'test@example.com'}),/OWNED_BUOYS_BLOCKED/);
});
test('P2 cleanup requires exact email match from authoritative Firebase identity',()=>{
 assert.throws(()=>eligibleForReset({role:'VIEWER',ownedDeviceIds:[],accountEmail:'alice@example.com',requestedEmail:'bob@example.com'}),/ACCOUNT_EMAIL_MISMATCH/);
 assert.equal(eligibleForReset({role:'VIEWER',ownedDeviceIds:[],accountEmail:'A@example.com',requestedEmail:'a@example.com'}),true);
});
test('P2 destructive confirmation is case-sensitive and project-scoped',()=>{
 const email='viewer@example.com',p='oil-spill-monitoring-buoy-staging';
 assert.equal(requireExactConfirmation('DELETE '+email+' FROM '+p,email,p),true);
 for(const str of ['DELETE '+email, 'delete '+email+' FROM '+p,'DELETE '+email+' FROM wrong-project'])
  assert.throws(()=>requireExactConfirmation(str,email,p),/CONFIRMATION_MISMATCH/);
});
test('P2 large data scans abort instead of partially purging unknown amounts',()=>{
 assert.throws(()=>assertBounded([1,2,3],2),/RESET_TOO_LARGE/);
 assert.deepEqual(assertBounded([1,2],2),[1,2]);
});
test('P2 clean-up policy preserves buoy ownership, immutable history and audit',()=>{
 for(const c of ['devices','deviceCredentials','alerts','devices/*/measurements','devices/*/ownershipAudit'])
  assert.ok(policy.retainedCollections.includes(c));
 assert.ok(policy.removableCollections.includes('notificationTokens'));
 assert.ok(policy.removableCollections.includes('pushSessions'));
});
