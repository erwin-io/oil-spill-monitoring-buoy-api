import {test} from 'node:test';
import assert from 'node:assert/strict';
import {healthAlerts,CONFIG_DEFAULT} from '../src/domain.js';
import {measurement,health,editDevice} from '../src/schemas.js';

test('legacy FAULT and new FAILED diagnostics both produce sensor faults',()=>{
 assert.deepEqual(healthAlerts({sensor:'FAULT'}),[{type:'SENSOR_FAULT',severity:'HIGH'}]);
 assert.deepEqual(healthAlerts({sensor:'FAILED'}),[{type:'SENSOR_FAULT',severity:'HIGH'}]);
 assert.deepEqual(healthAlerts({sensor:'OK'}),[]);
});

test('battery warning uses configured threshold, not hardcoded 20 percent',()=>{
 assert.deepEqual(healthAlerts({batteryPercent:24},25),[{type:'LOW_BATTERY',severity:'WARNING'}]);
 assert.deepEqual(healthAlerts({batteryPercent:24},20),[]);
 assert.deepEqual(healthAlerts({batteryPercent:19}),[{type:'LOW_BATTERY',severity:'WARNING'}]);
 assert.equal(CONFIG_DEFAULT.lowBatteryThreshold,20);
});

test('multiple health faults are all preserved',()=>{
 assert.deepEqual(healthAlerts({sensor:'FAULT',batteryPercent:7,cellStatus:'MAINTENANCE_REQUIRED'},20).map(x=>x.type),
 ['LOW_BATTERY','SENSOR_FAULT','CELL_MAINTENANCE_REQUIRED']);
});

test('legacy device telemetry fields remain supported without dropping strict validation',()=>{
 const v=measurement.safeParse({measurementId:'m1',measuredAt:'2026-10-24T00:00:00Z',classification:'NORMAL',confidence:0.9,
 totalFluorescence:5,spectral:{f415:1,f445:1,f480:1,f515:1,f555:1,f590:1},
 calibrationVersion:'cal-1',configVersion:3,diagnostics:{pumpCurrent:0.13,ready:true}});
 assert.equal(v.success,true);
 assert.equal(measurement.safeParse({...v.data,suspicious:'unexpected'}).success,false);
 const h=health.safeParse({healthId:'h1',measuredAt:'2026-10-24T00:00:00Z',queueDepth:15,sensor:'FAULT'});
 assert.equal(h.success,true);
});

test('empty device patch is not accepted',()=>{
 assert.equal(editDevice.safeParse({}).success,false);
 assert.equal(editDevice.safeParse({status:'ACTIVE'}).success,true);
});
