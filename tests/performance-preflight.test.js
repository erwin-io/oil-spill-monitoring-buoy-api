import test from 'node:test';
import assert from 'node:assert/strict';
import {accessibleDeviceAccess} from '../src/access.js';
import app from '../src/app.js';

test('owned/share memberships start concurrently and still produce empty authorized list',async()=>{
 let finishOwned,finishShared;
 const owned=new Promise(resolve=>{finishOwned=resolve});
 const shared=new Promise(resolve=>{finishShared=resolve});
 const reads=[];
 const db={
  collection:name=>{
   if(name==='devices')return {where:()=>({get:()=>{
    reads.push('owned');return owned;
   }})};
   if(name==='users')return {doc:()=>({collection:sub=>{
    assert.equal(sub,'sharedDevices');
    return {get:()=>{reads.push('shared');return shared}};
   }})};
   throw Error('Unexpected collection '+name);
  }
 };
 const pending=accessibleDeviceAccess(db,{uid:'user-1',role:'VIEWER',allowedDeviceIds:[]});
 assert.deepEqual(reads,['owned','shared'],'No serial Firestore membership waterfall');
 finishOwned({docs:[]});finishShared({docs:[]});
 assert.deepEqual(await pending,[]);
});

test('CORS preflights use strict origin allowlist with one-hour WebView preflight max-age',async()=>{
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/api/v1/devices';
 try{
  const response=await fetch(url,{
   method:'OPTIONS',
   headers:{origin:'https://localhost','access-control-request-method':'GET',
    'access-control-request-headers':'authorization,x-blueguard-cache-refresh'}
  });
  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'),'https://localhost');
  assert.equal(response.headers.get('access-control-max-age'),'3600');
  assert.match(response.headers.get('access-control-expose-headers')??'',/X-BlueGuard-Cache/);
  const blocked=await fetch(url,{
   method:'OPTIONS',headers:{origin:'https://untrusted.example',
    'access-control-request-method':'GET'}
  });
  assert.equal(blocked.status,403);
  assert.equal(blocked.headers.get('access-control-allow-origin'),null);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
