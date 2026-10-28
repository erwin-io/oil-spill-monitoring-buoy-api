import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync} from 'node:fs';
import {selectEmulatorPorts,createIsolatedEmulatorConfig} from '../scripts/emulator-ports.mjs';

async function occupyPort(port=0){
 const server=createServer();
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(port,'127.0.0.1',resolve);
 });
 return {port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('Firebase test selection bypasses occupied Firebase ports (8080, 9099, 9150, 4400 and 4500) without terminating their listeners',async()=>{
 const held=[];
 for(const port of [8080,9099,9150,4400,4500]){
  try{held.push(await occupyPort(port))}
  catch(error){
   if(error.code!=='EADDRINUSE'&&error.code!=='EACCES')throw error;
   // A separate process already owns this port: leave it untouched.
  }
 }
 const out=mkdtempSync(join(tmpdir(),'blueguard-emulator-ports-'));
 try{
  const {ports,path,config,cleanup}=await createIsolatedEmulatorConfig(process.cwd(),out);
  const selected=Object.values(ports);
  assert.equal(new Set(selected).size,5,'All Firebase emulators must have distinct ports');
  for(const n of selected){
   assert.ok(Number.isInteger(n)&&n>=1024&&n<=65535);
   assert.ok(![8080,9099,9150,4400,4500].includes(n),'Do not use fixed legacy ports');
  }
  assert.equal(config.emulators.firestore.host,'127.0.0.1');
  assert.equal(config.emulators.auth.host,'127.0.0.1');
  assert.equal(config.emulators.ui.enabled,false);
  assert.equal(config.emulators.firestore.port,ports.firestore);
  assert.equal(config.emulators.firestore.websocketPort,ports.websocket);
  assert.equal(config.emulators.auth.port,ports.auth);
  assert.equal(config.emulators.hub.port,ports.hub);
  assert.equal(config.emulators.logging.port,ports.logging);
  assert.equal(JSON.parse(readFileSync(path,'utf8')).emulators.auth.port,ports.auth);
  assert.equal(existsSync(path),true);
  cleanup();
  assert.equal(existsSync(path),false,'Temporary config must be removed');
  cleanup(); // Safe idempotent cleanup
  for(const listener of held)assert.ok([8080,9099,9150,4400,4500].includes(listener.port));
 }finally{
  for(const server of held)await server.close();
  rmSync(out,{recursive:true,force:true});
 }
});
test('free port discovery gives distinct OS-selected loopback ports',async()=>{
 const ports=await selectEmulatorPorts();
 assert.equal(new Set(Object.values(ports)).size,5);
});
