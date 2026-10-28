/** CI-only listener proving one-command tests tolerate occupied Firebase ports.
 * Binds loopback defaults, never contacts Firebase or opens public interfaces.
 * Exits when the owning CI process terminates it.
 */
import {createServer} from 'node:net';
import {writeFileSync} from 'node:fs';

const readyFile=process.argv[2];
if(!readyFile)throw Error('Pass a temporary readiness-file path');
const ports=[8080,9099,9150,4400,4500],listeners=[];
try{
 for(const port of ports){
  const server=createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(port,'127.0.0.1',resolve);
  });
  listeners.push(server);
 }
 writeFileSync(readyFile,JSON.stringify({pid:process.pid,ports})+'\n',{flag:'wx'});
 console.log('Holding default Firebase ports on loopback:',ports.join(', '));
}catch(error){
 for(const server of listeners)server.close();
 throw error;
}
for(const signal of ['SIGINT','SIGTERM']){
 process.on(signal,()=>{
  for(const server of listeners)server.close();
  process.exitCode=0;
 });
}
