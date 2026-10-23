# BlueWatch API: Phase 1 validation and deployment checkpoints

Updated 2026-10-24. This separates validated development code from production-dependent acceptance.

## Confirmed architecture
Keep NEW Express API as primary. Useful OLD compatibility fields already merged:
`calibrationVersion`, `configVersion`, diagnostic metadata and `queueDepth`;
`sensor='FAULT'` or `FAILED`; configurable battery thresholds; maintenance alarms.
There is **no** after-filter water telemetry and no GPS/ppm claims.

## Automated validation without project credentials
The GitHub API CI contains two independent jobs:
- `test` runs locked dependencies, Node syntax checks and unit/contract tests.
- `firestore-emulator` installs Java 21 and Firebase CLI, starts **Firestore and Firebase Auth emulators**
  using isolated `demo-bluewatch-ci`, and runs `tests/integration/firestore.test.js`.
  Tests verify immutable measurements, conflicting replays, stale projections,
  diagnostic alerts, scoped FCM delivery receipts and repeated offline episodes.

Firebase Admin automatically redirects Firestore calls to the emulator when
`FIRESTORE_EMULATOR_HOST` is set; NO live Firebase Admin credentials are needed.
Emulator behavior is close to, but not identical with, real Firestore: notably
indexes, transaction contention and limits must still be staged.

## Remaining operator-dependent release gates
1. **Secrets:** Revoke the Firebase service-account private key and rotate Pusher
   and device pepper values exposed by previous source exports. Re-provision device
   keys through an approved migration if the current pepper protects deployed buoys.
2. **Indexes:** Deploy `firestore.indexes.json` to the selected Firebase project
   before enabling the scheduled outbox worker. CLI (authenticated locally):
   `npx firebase-tools deploy --only firestore:indexes --project oil-spill-monitoring-buoy`.
   Inspect the console until the indexes are **Ready**, not just Building.
3. **HTTP smoke:** Test deployed HTTPS `/health`, authenticated `/auth/bootstrap`,
   scoped `/devices`, device-key ingestion, and versioned `/config`.
   Never put service-account private keys into Ionic/Vercel public client variables.
4. **Pusher & FCM:** Enable only after setting server-side credentials and
   registering real Android FCM tokens. Verify actual device notification tap,
   scoped listeners, retry after error and token revocation.
5. **Scheduler:** Vercel Hobby native cron supports daily intervals only. For
   low-cost development, use `.github/workflows/development-scheduler.yml`.
   Set repository secrets `BLUEWATCH_API_BASE_URL` (HTTPS **origin only**, no slash)
   and `BLUEWATCH_CRON_SECRET` equal to the Vercel `CRON_SECRET`.
   Then enable repo variable `BLUEWATCH_SCHEDULER_ENABLED=true`.
   Keep disabled until indexes, credentials and staging data are prepared.
   GitHub Actions schedules may start late or be dropped and are **not suitable
   for contractual 60-minute detection/delivery guarantees**.
   Production SLA requires a reliable scheduler/worker and monitoring.
6. **Scale:** Per-instance Express rate limit is not distributed. Authenticated
   fleet reads are limited to 100 devices and alerts list is not fully paginated.
   Realtime/FCM receipts improve retries but exactly-once delivery across a
   process crash cannot be guaranteed by FCM.
7. **Staging:** Use a separate Firebase project for artificial petroleum alerts and
   high-concurrency load tests. Obtain explicit approval before touching live data.

## Local commands
```powershell
npm ci
npm run check
npm test

# Requires Java 21 and the Firebase CLI, does NOT access production:
$env:FIREBASE_PROJECT_ID='demo-bluewatch-ci'
$env:GCLOUD_PROJECT='demo-bluewatch-ci'
npx firebase-tools@15.9.0 emulators:exec --project demo-bluewatch-ci --only firestore,auth "node --test tests/integration/*.test.js"
```
