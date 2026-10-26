#!/usr/bin/env node
// Read-only production Firebase/API probe. Never mutates cloud indexes or data.
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const project='oil-spill-monitoring-buoy';
const root=process.cwd();
const report={project,readOnly:true,time:new Date().toISOString(),checks:[]};
const record=(name,pass,detail)=>{report.checks.push({name,result:pass?'PASS':'FAIL',detail});};
function signature(entry){
 return [entry.collectionGroup,entry.queryScope,
  ...(entry.fields??[]).map(f=>f.fieldPath+':'+(f.order??f.arrayConfig??''))].join('|');
}
const expected=JSON.parse(readFileSync('firestore.indexes.json','utf8')).indexes;
let result;
try{
 const cli=process.platform==='win32'?'npx.cmd':'npx';
 const run=spawnSync(cli,['--yes','firebase-tools@15.9.0','firestore:indexes',
  '--project',project],{encoding:'utf8',timeout:120000,windowsHide:true,
  ...(process.platform==='win32'?{shell:true}:{})});
 if(run.error||run.status!==0){
  record('Production Firestore index listing',false,
   'Firebase CLI could not read live indexes. Run firebase login and retry; no deployment was attempted.');
 }else{
  const text=run.stdout.trim(),start=text.indexOf('{'),end=text.lastIndexOf('}');
  const remote=JSON.parse(text.slice(start,end+1));
  const found=new Set((remote.indexes??[]).map(signature));
  const missing=expected.filter(index=>!found.has(signature(index)));
  record('Required deployed composite indexes',missing.length===0,
   missing.length?'Missing: '+missing.map(signature).join(', '):
   expected.length+' required index definitions are deployed');
 }
}catch(e){record('Production Firestore indexes',false,String(e.message).slice(0,160));}
const origin=process.env.BLUEGUARD_API_ORIGIN??'https://oil-spill-monitoring-buoy-api.vercel.app';
try{
 const parsed=new URL(origin);
 if(parsed.protocol!=='https:')throw Error('HTTPS API origin required');
 const response=await fetch(new URL('/health',parsed),{signal:AbortSignal.timeout(15000)});
 const body=await response.json();
 record('Live API /health and Firebase Admin connectivity',
  response.ok&&body.status==='ok'&&body.database==='ready',
  'HTTP '+response.status+', database '+String(body.database??'unknown'));
}catch(e){record('Live API Firebase health',false,String(e.message).slice(0,160));}
record('Production worker & Vercel flags','SKIP',
 'Requires authorized Vercel team inspection; no job was triggered.');
report.result=report.checks.some(x=>x.result==='FAIL')?'FAIL':'PARTIAL';
mkdirSync('.test-output',{recursive:true});
const path=join('.test-output','production-firebase-readonly.json');
writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:report.result,checks:report.checks,report:path},null,2));
if(report.result==='FAIL')process.exitCode=1;
