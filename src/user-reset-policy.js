// BlueGuard test-account deletion plan. Nothing in this module deletes data.
// Inventory is deliberately exhaustive for the Phase 2 active account indexes.
export const MAX_SCAN = 10000;
export const MAX_DELETE = 12000;
export const eligibleForReset = ({role, ownedDeviceIds = [], accountEmail, requestedEmail}) => {
 if (typeof accountEmail!=='string'||accountEmail.toLowerCase()!==requestedEmail.toLowerCase())
  throw Error('ACCOUNT_EMAIL_MISMATCH');
 if (['ADMIN','OPERATOR'].includes(role))
  throw Error('PRIVILEGED_ACCOUNT_BLOCKED: use a dedicated VIEWER staging test account');
 if (ownedDeviceIds.length)
  throw Error('OWNED_BUOYS_BLOCKED: transfer ownership through the approved Owner workflow first; this utility does not re-provision devices: '+ownedDeviceIds.join(','));
 return true;
};
export const policy = {
 // One-to-one user documents and active authorization/index records can be removed.
 removableCollections: ['users','notificationTokens','pushSessions','pushInstallations',
  'devicePairings','deviceTransfers','devices/*/invitations','devices/*/viewers',
  'notificationOutbox/*/fcmReceipts'],
 // Global telemetry, buoy documents, alerts, credentials, and historical audit
 // are NEVER deleted as a side effect of resetting an individual user.
 retainedCollections: ['devices','deviceCredentials','alerts','devices/*/measurements',
  'devices/*/health','devices/*/config','devices/*/ownershipAudit',
  'notificationOutbox (shared incident jobs)','historical accepted deviceTransfers',
  '_rateLimitWindows (short-lived anonymous hashed rate window)']
};
export function assertBounded(list,limit=MAX_DELETE){
 if(list.length>limit)throw Error('RESET_TOO_LARGE: '+list.length+' matching documents exceed safe limit '+limit);
 return list;
}
export function requireExactConfirmation(input,email,project){
 const expected='DELETE '+email+' FROM '+project;
 if(input!==expected)throw Error('CONFIRMATION_MISMATCH');
 return true;
}
