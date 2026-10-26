import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Vercel source uploads explicitly exclude developer env, FCM account and telemetry credentials',()=>{
 const rules=new Set(readFileSync('.vercelignore','utf8').split(/\r?\n/).map(s=>s.trim()));
 for(const name of ['.env','.env.*','secrets/','scripts/telemetry-lab.config.json',
   '*.pem','*.p12','*.jks','*.keystore','firebase-admin.json','credentials.json']){
  assert.equal(rules.has(name),true,name+' must be ignored by Vercel CLI');
 }
});
