import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presenceJob} from '../src/jobs.js';

test('Offline/online private-device events are stable, episode-scoped outbox jobs',()=>{
 const off=presenceJob('buoy_A','OFFLINE',0),back=presenceJob('buoy_A','ONLINE',0);
 assert.equal(off.value.type,'device.offline');
 assert.equal(back.value.type,'device.online');
 assert.equal(off.value.payload.status,'OFFLINE');
 assert.equal(back.value.payload.status,'ONLINE');
 assert.equal(off.value.deviceId,'buoy_A');
 assert.equal(off.value.status,'PENDING');
 assert.notEqual(off.id,back.id);
 assert.notEqual(off.id,presenceJob('buoy_A','OFFLINE',1).id);
 assert.deepEqual(presenceJob('buoy_A','OFFLINE',0).id,off.id);
 assert.throws(()=>presenceJob('buoy_A','OFFLINE',-1),/episode/);
});
