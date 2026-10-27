import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthSingleFlight} from '../src/auth-single-flight.js';

test('concurrent same token shares a single revocation/profile check, without retaining result afterward',async()=>{
 const flight=createAuthSingleFlight();
 let finish,checks=0;
 const pending=new Promise(resolve=>{finish=resolve});
 const work=async()=>{checks++;return pending};
 const first=flight.verify('jwt-demo-A',work);
 const second=flight.verify('jwt-demo-A',work);
 const third=flight.verify('jwt-demo-B',work);
 const result={uid:'test',status:'ACTIVE'};
 finish(result);
 assert.deepEqual(await Promise.all([first,second,third]),[result,result,result]);
 assert.equal(checks,2,'Different credentials never share a principal');
 await Promise.resolve();
 assert.equal(flight.active(),0,'Completed token checks are not cached');
 assert.equal(await flight.verify('jwt-demo-A',async()=>{checks++;return result}),result);
 assert.equal(checks,3,'Every non-overlapping request must recheck revocation and status');
});

test('failed Firebase verification is shared only during flight and removed for safe retry',async()=>{
 const flight=createAuthSingleFlight();let fail,checks=0;
 const wait=new Promise((resolve,reject)=>{fail=reject});
 const get=()=>flight.verify('bad-jwt',()=>{checks++;return wait});
 const a=get(),b=get();
 fail(new Error('revoked'));
 const results=await Promise.allSettled([a,b]);
 assert.deepEqual(results.map(x=>x.status),['rejected','rejected']);
 assert.equal(checks,1);
 await Promise.resolve();
 assert.equal(flight.active(),0);
 const valid=await flight.verify('bad-jwt',async()=>{checks++;return {uid:'now-valid'}});
 assert.equal(valid.uid,'now-valid');
 assert.equal(checks,2);
});
