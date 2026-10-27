import test from 'node:test';
import assert from 'node:assert/strict';
import {queueRefresh} from '../src/realtime-refresh.js';

test('one ownership transition queues one atomic outbox record for both parties and device',()=>{
 const created=[];
 const writer={create:(ref,value)=>created.push({ref,value})};
 const db={collection:name=>{
  assert.equal(name,'notificationOutbox');
  return {doc:id=>({id})};
 }};
 queueRefresh(writer,db,{
  deviceId:'buoy-abc',uids:['old-owner','new-owner','new-owner'],resource:'ownership'
 });
 assert.equal(created.length,1);
 assert.equal(created[0].value.type,'data.changed');
 assert.equal(created[0].value.deviceId,'buoy-abc');
 assert.deepEqual(created[0].value.notifyUsers,['old-owner','new-owner']);
 assert.deepEqual(created[0].value.payload,{resource:'ownership',deviceId:'buoy-abc'});
 assert.equal(created[0].value.status,'PENDING');
 assert.equal(JSON.stringify(created[0].value).includes('email'),false);
});

test('one personal alert-read change queues no device signal',()=>{
 const values=[];
 const db={collection:()=>({doc:()=>({})})};
 queueRefresh({create:(_ref,val)=>values.push(val)},db,{uid:'reader',resource:'alerts'});
 assert.equal(values.length,1);
 assert.equal(values[0].payload.uid,'reader');
 assert.equal(values[0].deviceId,null);
});
