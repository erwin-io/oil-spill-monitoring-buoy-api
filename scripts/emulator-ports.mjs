/** Isolated Firebase emulator port and config selection.
 * Always use OS-assigned loopback ports instead of fixed 8080/9099/9150.
 * Port inspection never stops, reconnects to or reuses another process.
 * The selected sockets are released before firebase-tools binds them.
 */
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

async function freeLoopbackPort(){
 const server=createServer();
 return await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const address=server.address();
   server.close(err=>err?reject(err):resolve(address.port));
  });
 });
}
export async function selectEmulatorPorts(){
 // Never select the legacy defaults, even on hosts with a custom ephemeral range.
 const reserved=new Set([8080,9099,9150,4400,4500]);
 async function unique(){
  for(let retry=0;retry<20;retry++){
   const port=await freeLoopbackPort();
   if(!reserved.has(port)){reserved.add(port);return port;}
  }
  throw new Error('Unable to allocate distinct local emulator ports');
 }
 return {firestore:await unique(),auth:await unique(),websocket:await unique(),hub:await unique(),logging:await unique()};
}
export async function createIsolatedEmulatorConfig(root,outputDir){
 const ports=await selectEmulatorPorts();
 const path=join(outputDir,'firebase-api-local-'+randomUUID()+'.json');
 const config={
  firestore:{
   rules:join(root,'firestore.rules'),
   indexes:join(root,'firestore.indexes.json')
  },
  emulators:{
   firestore:{host:'127.0.0.1',port:ports.firestore,websocketPort:ports.websocket},
   auth:{host:'127.0.0.1',port:ports.auth},
   hub:{host:'127.0.0.1',port:ports.hub},
   logging:{host:'127.0.0.1',port:ports.logging},
   ui:{enabled:false}
  }
 };
 mkdirSync(outputDir,{recursive:true});
 writeFileSync(path,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
 return {path,ports,config,cleanup:()=>{
  try{unlinkSync(path)}catch(error){
   if(error.code!=='ENOENT')throw error;
  }
 }};
}
