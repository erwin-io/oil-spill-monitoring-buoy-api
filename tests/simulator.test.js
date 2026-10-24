import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkSandbox,sampleMeasurement} from '../scripts/simulator-pipeline.mjs';

const base={
 FIREBASE_PROJECT_ID:'demo-oil-spill-isolated',
 FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',
 FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'
};
test('buoy simulator refuses missing emulator or real Firebase project',()=>{
 assert.throws(()=>checkSandbox({...base,FIREBASE_PROJECT_ID:'oil-spill-monitoring-buoy'},new Set()),/CLOUD_FIREBASE_WRITE_PROTECTION/);
 assert.throws(()=>checkSandbox({...base,FIRESTORE_EMULATOR_HOST:''},new Set()),/FIRESTORE_EMULATOR_HOST/);
 assert.throws(()=>checkSandbox({...base,FIRESTORE_EMULATOR_HOST:'production.firestore.googleapis.com:443'},new Set()),/FIRESTORE_EMULATOR_HOST/);
 assert.throws(()=>checkSandbox({...base,FIREBASE_AUTH_EMULATOR_HOST:''},new Set()),/FIREBASE_AUTH_EMULATOR_HOST/);
 assert.equal(checkSandbox(base,new Set()),true);
});
test('real Pusher and FCM require explicit consent and full provider configuration',()=>{
 assert.throws(()=>checkSandbox(base,new Set(['--with-pusher'])),/confirmation required/);
 assert.throws(()=>checkSandbox({...base,THESIS_PROVIDER_CONFIRM:'SEND_TEST_PROVIDER_EVENTS'},new Set(['--with-pusher'])),/Missing PUSHER_APP_ID/);
 assert.throws(()=>checkSandbox({...base,THESIS_PROVIDER_CONFIRM:'SEND_TEST_PROVIDER_EVENTS'},new Set(['--with-fcm'])),/Missing THESIS_FCM_TEST_TOKEN/);
 assert.throws(()=>checkSandbox(base,new Set(['--inject-into-prod'])),/UNSUPPORTED_OPTION/);
});
test('simulator telemetry is always identified as synthetic, never scientific observation',()=>{
 const value=sampleMeasurement('thesis_001','PETROLEUM');
 assert.equal(value.classification,'PETROLEUM');
 assert.ok(value.qualityFlags.includes('SIMULATED_DO_NOT_USE_FOR_SCIENCE'));
 assert.equal(value.modelVersion,'no-real-sensor');
 assert.equal(value.measurementId,'thesis_001');
});
