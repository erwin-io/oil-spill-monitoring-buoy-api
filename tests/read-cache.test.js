import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadCache} from '../src/read-cache.js';

function request(uid='alice',path='/api/v1/devices',query={}){
 return {method:'GET',path,query,params:{},user:{uid,role:'VIEWER'}};
}
function response(){
 const headers={};
 return {
  headers,statusCode:200,headersSent:false,
  set(k,v){headers[k]=v;return this},
  type(x){headers['type']=x;return this},
  send(x){this.body=JSON.parse(x);this.headersSent=true;return this},
  json(x){this.body=x;this.headersSent=true;return this}
 };
}
const echo=(get)=>async(req,res)=>{
 const body=await get(req);
 res.json(body);
};
test('user and canonical query separate cached Firestore results; hit avoids handler',async()=>{
 let calls=0;
 const cache=createReadCache();
 const handler=cache.cache('devices',20000,echo(async()=>({items:[{id:'buoy-a',seq:++calls}]})));
 const alice=request(),bob=request('bob');
 const a=response();await handler(alice,a);
 assert.equal(a.headers['X-BlueGuard-Cache'],'MISS');
 const b=response();await handler(alice,b);
 assert.equal(b.headers['X-BlueGuard-Cache'],'HIT');
 assert.deepEqual(b.body,a.body);
 assert.equal(calls,1);
 await handler(bob,response());
 assert.equal(calls,2);
 const ordered=request('alice','/api/v1/devices',{a:'1',b:'2'});
 await handler(ordered,response());assert.equal(calls,3);
 await handler(request('alice','/api/v1/devices',{b:'2',a:'1'}),response());
 assert.equal(calls,3);
});
test('read receipts invalidate only that users alerts and never cached buoy lists',async()=>{
 const c=createReadCache();let calls=0;
 const get=(scope)=>c.cache(scope,20000,echo(async()=>({value:++calls})));
 const devices=get('devices'),alerts=get('alerts');
 await devices(request(),response());
 await alerts(request('alice','/api/v1/alerts'),response());
 assert.equal(calls,2);
 const write=c.invalidateAfter(()=>['alerts-user:alice'],async(_req,res)=>res.json({ok:true}));
 const changed=response();changed.statusCode=201;
 await write({...request(),method:'POST'},changed);
 await devices(request(),response());
 assert.equal(calls,2);
 await alerts(request('alice','/api/v1/alerts'),response());
 assert.equal(calls,3);
});
test('device invalidation reaches associated user list and details, leaves other devices intact',async()=>{
 const c=createReadCache();let reads=0;
 const get=c.cache('devices',15000,echo(async req=>{
  req.cacheDeviceIds=[req.query.deviceId];
  return {items:[{id:req.query.deviceId}],number:++reads};
 }));
 for(const id of ['buoy-a','buoy-b'])await get(request('alice','/api/v1/devices',{deviceId:id}),response());
 assert.equal(reads,2);
 assert.equal(c.invalidate(['device:buoy-a']),1);
 await get(request('alice','/api/v1/devices',{deviceId:'buoy-a'}),response());
 await get(request('alice','/api/v1/devices',{deviceId:'buoy-b'}),response());
 assert.equal(reads,3);
});
test('permission check executes on EVERY hit, and denied memberships never return cached JSON',async()=>{
 const c=createReadCache();let permitted=true,reads=0;
 const handler=c.cache('alert-detail',10000,echo(async()=>({deviceId:'abc',id:'event',v:++reads})),async()=>permitted);
 const req=request('a','/api/v1/alerts/event');
 await handler(req,response());
 const res=response();await handler(req,res);
 assert.equal(res.headers['X-BlueGuard-Cache'],'HIT');
 permitted=false;
 const denied=response();await handler(req,denied);
 assert.equal(denied.headers['X-BlueGuard-Cache'],'MISS');
 assert.equal(reads,2);
});
test('cache expires, evicts bounded LRU and refuses oversized items',async()=>{
 let clock=1000,reads=0;
 const c=createReadCache({now:()=>clock,maxEntries:1,maxBytes:1000,maxEntryBytes:100});
 const handler=c.cache('test',10,echo(async()=>({n:++reads})));
 await handler(request('a','/one'),response());
 await handler(request('a','/two'),response());
 assert.equal(c.stats().entries,1);
 await handler(request('a','/one'),response());
 assert.equal(reads,3);
 clock+=11;
 await handler(request('a','/one'),response());
 assert.equal(reads,4);
});
test('in-flight Firestore read never caches a response after a concurrent write',async()=>{
 const c=createReadCache();let release,reads=0;
 const pending=new Promise(r=>{release=r});
 const handler=c.cache('devices',20000,echo(async()=>{reads++;await pending;return {reads}}));
 const ongoing=handler(request(),response());
 c.invalidate(['user:alice']);
 release();await ongoing;
 assert.equal(c.stats().entries,0);
 await handler(request(),response());
 assert.equal(reads,2);
});
test('non-2xx writes never invalidate successful cached reads',async()=>{
 const c=createReadCache();let count=0;
 const get=c.cache('devices',10000,echo(async()=>({count:++count})));
 await get(request(),response());
 const fail=c.invalidateAfter(()=>['user:alice'],async(_req,res)=>{res.statusCode=409;return res.json({error:'CONFLICT'})});
 await fail({...request(),method:'PATCH'},response());
 await get(request(),response());
 assert.equal(count,1);
});

test('Pusher refresh header forces a current read and replaces a previously warm response',async()=>{
 const c=createReadCache();let backing=1,reads=0;
 const handler=c.cache('alerts',10000,echo(async()=>({value:backing,reads:++reads})));
 const req=request('alice','/api/v1/alerts');
 await handler(req,response());
 backing=2; // external write on another Vercel instance, no local invalidate
 const stale=response();await handler(req,stale);
 assert.equal(stale.headers['X-BlueGuard-Cache'],'HIT');
 assert.equal(stale.body.value,1);
 const freshReq={...req,get:name=>name==='x-blueguard-cache-refresh'?'true':undefined};
 const fresh=response();await handler(freshReq,fresh);
 assert.equal(fresh.headers['X-BlueGuard-Cache'],'MISS');
 assert.equal(fresh.body.value,2);
 assert.equal(reads,2);
 const now=response();await handler(req,now);
 assert.equal(now.headers['X-BlueGuard-Cache'],'HIT');
 assert.equal(now.body.value,2);
});

test('invalidated cache hit is not served after asynchronous ACL check races a write',async()=>{
 const c=createReadCache();let value=1,reads=0,release;
 let delayValidation=false;
 const gate=new Promise(resolve=>{release=resolve});
 const handler=c.cache('devices',20000,echo(async()=>({value:value,reads:++reads})),async()=>{
  if(delayValidation)await gate;
  return true;
 });
 await handler(request(),response());
 value=2;delayValidation=true;
 const out=response(),pending=handler(request(),out);
 c.invalidate(['user:alice']);release();
 await pending;
 assert.equal(out.headers['X-BlueGuard-Cache'],'MISS');
 assert.equal(out.body.value,2);
 assert.equal(reads,2);
});
