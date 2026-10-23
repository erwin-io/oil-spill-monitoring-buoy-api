import {test} from 'node:test';
import assert from 'node:assert/strict';

// Import the Express app after setting a known browser allowlist.
// This tests native defaults even when ALLOWED_ORIGINS is set on Vercel.
process.env.ALLOWED_ORIGINS='http://localhost:8100,http://localhost:4200';
const {default:app}=await import('../src/app.js');

async function preflight(origin) {
 const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{
  if(server.listening)return resolve();
  server.once('listening',resolve);
  server.once('error',reject);
 });
 try {
  const url=`http://127.0.0.1:${server.address().port}/api/v1/auth/bootstrap`;
  const response=await fetch(url,{
   method:'OPTIONS',
   headers:{
    Origin:origin,
    'Access-Control-Request-Method':'POST',
    'Access-Control-Request-Headers':'authorization,content-type',
   },
  });
  return {
   status:response.status,
   allowedOrigin:response.headers.get('access-control-allow-origin'),
   allowedMethods:response.headers.get('access-control-allow-methods'),
   allowedHeaders:response.headers.get('access-control-allow-headers'),
  };
 }finally {
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
}

test('Android Capacitor 7 HTTPS WebView origin passes auth bootstrap preflight',async()=>{
 const r=await preflight('https://localhost');
 assert.equal(r.status,204);
 assert.equal(r.allowedOrigin,'https://localhost');
 assert.match(r.allowedMethods,/POST/);
 assert.match(r.allowedHeaders,/authorization/i);
 assert.match(r.allowedHeaders,/content-type/i);
});

test('iOS Capacitor WebView origin passes preflight',async()=>{
 const r=await preflight('capacitor://localhost');
 assert.equal(r.status,204);
 assert.equal(r.allowedOrigin,'capacitor://localhost');
});

test('configured browser dev origin remains allowed',async()=>{
 const r=await preflight('http://localhost:8100');
 assert.equal(r.status,204);
 assert.equal(r.allowedOrigin,'http://localhost:8100');
});

test('untrusted website is not granted cross-origin API access',async()=>{
 const r=await preflight('https://untrusted.example');
 assert.equal(r.status,403);
 assert.equal(r.allowedOrigin,null);
});
