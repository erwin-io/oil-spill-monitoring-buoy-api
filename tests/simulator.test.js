import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkSandbox,sampleMeasurement,readTelemetryPlan,safeFcmErrorCode,shouldRecordPusherEvent} from '../scripts/simulator-pipeline.mjs';
import {readFileSync} from 'node:fs';

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


test('all editable telemetry scenarios have constrained steps and alert expectations',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../scripts/telemetry-lab.scenarios.json',import.meta.url),'utf8'));
 const cases={
  normal:[],interference:[],inconclusive:[],below_threshold:[],
  petroleum:['PETROLEUM'],
  low_battery:['LOW_BATTERY'],
  sensor_fault:['SENSOR_FAULT'],
  maintenance:['CELL_MAINTENANCE_REQUIRED'],
  all:['PETROLEUM','LOW_BATTERY','SENSOR_FAULT','CELL_MAINTENANCE_REQUIRED']
 };
 for(const [name,alertTypes]of Object.entries(cases)){
  const plan=readTelemetryPlan(name,fixture);
  assert.ok(plan.steps.length>0);
  assert.deepEqual([...plan.expectedAlerts].sort(),[...alertTypes].sort());
  assert.ok(plan.steps.every(s=>['health','measurement'].includes(s.kind)));
 }
 assert.throws(()=>readTelemetryPlan('unknown',fixture),/UNKNOWN_TELEMETRY_SCENARIO/);
});

test('non-alert measurements cannot be configured to send accidental FCM from lab fixtures',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../scripts/telemetry-lab.scenarios.json',import.meta.url),'utf8'));
 for(const name of ['normal','interference','inconclusive','below_threshold']){
  const plan=readTelemetryPlan(name,fixture);
  assert.equal(plan.expectedAlerts.length,0,name+' must never ask for an FCM token');
 }
 const bad={scenarios:{bad:{steps:[{kind:'arbitrary'}],expectedAlerts:[]}}};
 assert.throws(()=>readTelemetryPlan('bad',bad),/SCENARIO_STEP_KIND_INVALID/);
});

test('FCM failure diagnostics expose only safe SDK codes and never sensitive error messages',()=>{
 assert.equal(safeFcmErrorCode({code:'messaging/registration-token-not-registered',message:'token-secret'}),'messaging/registration-token-not-registered');
 assert.equal(safeFcmErrorCode({code:'messaging/mismatched-credential',message:'service-account-secret'}),'messaging/mismatched-credential');
 assert.equal(safeFcmErrorCode({code:'not safe token-secret'}),'FCM_UNKNOWN_ERROR');
 assert.equal(safeFcmErrorCode({message:'private data'}),'FCM_UNKNOWN_ERROR');
});

test('Pusher simulator captures online/offline transitions after telemetry wait, scoped to private channel',()=>{
 const expected=['measurement.created','health.updated','alert.created'];
 const scoped='private-device-sim_abc';
 for(const event of [...expected,'device.offline','device.online']){
  assert.equal(shouldRecordPusherEvent(expected,event,scoped,scoped),true,event);
  assert.equal(shouldRecordPusherEvent(expected,event,'private-device-other',scoped),false,event);
 }
 assert.equal(shouldRecordPusherEvent(expected,'pusher:ping',scoped,scoped),false);
 assert.equal(shouldRecordPusherEvent(expected,'unknown.event',scoped,scoped),false);
});
