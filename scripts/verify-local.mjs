#!/usr/bin/env node
/**
 * Single-command LOCAL acceptance runner. No additional Firebase project,
 * service account, Pusher account or physical buoy is required.
 *
 * npm run verify:local
 * npm run verify:local -- --skip-install
 *
 * All destructive scenarios use Firebase Authentication + Firestore EMULATORS
 * with a demo- project ID. Never point this runner at real Firebase.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const args = new Set(process.argv.slice(2));
const supported = new Set(['--skip-install', '--dry-run']);
for (const arg of args) {
  if (!supported.has(arg)) {
    console.error(`Unknown option: ${arg}. Supported: --skip-install, --dry-run`);
    process.exit(2);
  }
}
const demoProject = 'demo-oil-spill-monitoring-buoy-local';
const safeEnv = {
  ...process.env,
  NODE_ENV: 'test',
  FIREBASE_PROJECT_ID: demoProject,
  GCLOUD_PROJECT: demoProject,
  GOOGLE_CLOUD_PROJECT: demoProject,
  // Block accidentally inheriting real project/service account or providers.
  FIREBASE_CLIENT_EMAIL: '',
  FIREBASE_PRIVATE_KEY: '',
  GOOGLE_APPLICATION_CREDENTIALS: '',
  GOOGLE_CLOUD_KEYFILE_JSON: '',
  PUSHER_ENABLED: 'false',
  FCM_ENABLED: 'false',
};
delete safeEnv.FIRESTORE_EMULATOR_HOST;
delete safeEnv.FIREBASE_AUTH_EMULATOR_HOST;
const windows = process.platform === 'win32';
const commands = [
  ...(!args.has('--skip-install') ? [{name:'Reproducible dependencies',command:'npm',argv:['ci','--no-audit','--no-fund']}] : []),
  {name:'Node syntax checks',command:'npm',argv:['run','check']},
  {name:'Unit and validation tests',command:'npm',argv:['test']},
  {name:'Firebase Auth + Firestore HTTP integration',command:'npx',argv:[
    '--yes','firebase-tools@15.9.0','emulators:exec',
    '--project',demoProject,'--only','firestore,auth',
    'node --test --test-force-exit tests/integration/*.test.js',
  ]},
];
const results = [];
let failure = null;
console.log('Oil Spill Monitoring Buoy API: SAFE LOCAL AUTOMATED ACCEPTANCE');
console.log('Firebase target: LOCAL EMULATORS ONLY (demo- project, no cloud writes).');
console.log('External Pusher/FCM delivery: intentionally disabled.');
if (args.has('--dry-run')) {
  for (const step of commands) console.log(`[PLAN] ${step.name}: ${step.command} ${step.argv.join(' ')}`);
  process.exit(0);
}
try {
  for (const step of commands) {
    console.log(`\n=== ${step.name} ===`);
    const start = Date.now();
    const ret = spawnSync(windows ? `${step.command}.cmd` : step.command,step.argv,{
      cwd: root, env: safeEnv, stdio: 'inherit',
      // npm.cmd / npx.cmd are batch entrypoints on Windows.
      shell: windows,
    });
    const elapsedMs = Date.now() - start;
    const ok = !ret.error && ret.status === 0;
    results.push({name:step.name,status:ok?'PASS':'FAIL',elapsedMs});
    if (!ok) {
      failure = ret.error?.message || `${step.name} exited ${String(ret.status)}`;
      break;
    }
  }
} finally {
  const outputDir = join(root,'.test-output');
  mkdirSync(outputDir,{recursive:true});
  const report = {
    suite:'API local automated acceptance',
    timestamp:new Date().toISOString(),
    project:demoProject,
    target:'firebase-emulators-only',
    cloudWrites:false,
    externalPushDeliveryTested:false,
    steps:results,
    result:failure?'FAIL':'PASS',
    ...(failure ? {failure} : {}),
  };
  const path = join(outputDir,'api-local-validation.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n');
  console.log(`\nResult: ${report.result} | Report: ${path}`);
}
if (failure) process.exit(1);
