import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');

test('top-level Windows one-command entrypoint invokes the shared cross-repo coordinator',()=>{
 assert.equal(existsSync(resolve(root,'test-blueguard.cmd')),true);
 assert.equal(existsSync(resolve(root,'test-blueguard.ps1')),true);
 const batch=read('test-blueguard.cmd');
 const ps=read('test-blueguard.ps1');
 const verify=read('scripts/verify-thesis.ps1');
 const pkg=JSON.parse(read('package.json'));
 assert.match(batch,/powershell\.exe .* -File "%~dp0test-blueguard\.ps1" %\*/i);
 assert.match(batch,/exit \/b %errorlevel%/i);
 assert.match(ps,/oil-spill-monitoring-buoy-app/);
 assert.match(ps,/verify-thesis\.ps1/);
 assert.match(ps,/& \$verifyScript @options/);
 assert.match(ps,/physicalLtePairingProven = \$false/);
 assert.match(ps,/productionFirebaseWrites = \$false/);
 assert.match(ps,/blueguard-one-command-report\.json/);
 assert.match(verify,/npm\.cmd/);
 assert.match(verify,/verify:local/);
 assert.match(pkg.scripts['verify:all'],/test-blueguard\.ps1/);
 assert.doesNotMatch(ps,/git\s+(reset|clean|push|pull)|Remove-Item.*(deviceCredentials|\.env)/i);
});

test('Windows PowerShell parses one-command entrypoint without syntax errors',()=>{
 if(process.platform!=='win32')return;
 const psPath=resolve(root,'test-blueguard.ps1').replaceAll("'","''");
 const shell=[
  '$tokens=$null;$errors=$null;',
  '[System.Management.Automation.Language.Parser]::ParseFile(\''+psPath+'\',[ref]$tokens,[ref]$errors)|Out-Null;',
  'if($errors.Count){$errors|ForEach-Object{Write-Error $_.Message};exit 1}'
 ].join('');
 const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',shell],{
  cwd:root,encoding:'utf8',timeout:30000
 });
 assert.equal(r.status,0,r.stderr||r.stdout||r.error?.message);
});
