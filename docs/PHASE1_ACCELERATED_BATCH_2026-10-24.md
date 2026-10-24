# Oil Spill Monitoring Buoy — Phase 1 Accelerated Batch Handoff
**Date:** 2026-10-24 (Asia/Manila)  
**Status:** Development PRs open. NOT production acceptance or 15 newly Completed items.  
**Authoritative tracker:** [Official Development Checklist](https://docs.google.com/spreadsheets/d/1u7q7yetXcge09qaLFywK7s6wSRKjLJcKP-R6pi8t1pQ/edit), tab `Development Checklist`, IDs 1–103.  
**Baseline:** 13 Completed / 25 In Progress / 0 Blocked / 65 Not Started.

## 1. Immutable architectural decisions
- ESP32-S3 + A7670C HTTPS → Express/Vercel → Cloud Firestore → private Pusher hints + FCM → Ionic/Angular/Capacitor.
- 365 nm UV + ZWB2 + quartz optical cell + L39 + AS7341 measures **raw seawater only**; edge Random Forest is advisory and requires labeled experimental calibration. Do not claim certified oil concentration, ppm, sensitivity or accuracy.
- Coconut-husk + coconut-shell charcoal is a **separate treatment system**, not measured after filtration.
- No GPS/maps, no Google sign-in, no fabricated production oil incidents.
- Role/scope access, immutable IDs, optimistic config versions and cloud secrets stay as defined by `docs/TECH_LEAD_AGENT_HANDOFF_2026-10-24.md`.

## 2. Work actually performed
### API (review-only PR)
- Base main verified `4a69f5f2b061be387735b2435c555ed54228dceb`.
- Branch `fix/phase1-offline-sweep-cursor`; code/test SHA before this handoff: `7beef0c6fd2a5598a29889bf367698d57f034e47`.
- [API PR #3](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/pull/3).
- `src/jobs.js`: replaces hard first-1000 ACTIVE-buoy scan with deterministic, paginated Firestore cursor stored at `_workerState/offlineSweep`. Controlled by `MAX_OFFLINE_SWEEP_DEVICES` (default 1000, max 1000). Cursor is committed after the full page; re-scans retain transactional incident-idempotency. Reports `morePages` in addition to existing response fields. No API route changes.
- `tests/integration/firestore.test.js`: an isolated emulator regression checks two-page offline sweeps and duplicate episode prevention.
- `tests/integration/auth-http.test.js`: one emulator HTTP acceptance scenario checks admin provisioning, duplicate rejection, scoped access, empty/history cursor/latest state, petroleum alert creation, viewer denial, operator acknowledgment and recovery. It does not test real hardware or Android display.
- Earlier code/test head `fc002278d9e3` passed [API PR CI](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40055024354). **The later HTTP acceptance test commit needs exact-head CI readback before merge.**

### Mobile (review-only PR)
- Base main at branch start `31f67f77a49f7e92fc672969b3f54c70583eccf1`; main was observed later advancing to `f5964c8cbf7930d861fc9cc0904870806f32ce15` (Android release-related files). Review changed-base diff before merge.
- Branch `fix/phase1-push-session-race`, head `561beb09236355bcf41475c1c811240d5aa2c854`.
- [Mobile PR #1](https://github.com/erwin-io/oil-spill-monitoring-buoy-app/pull/1).
- `src/app/core/push.service.ts`: adds a session generation guard; sequences token callback registration; ignores stale callbacks and notification tap navigation after logout; retires old tokens after refresh; revokes tokens registered while logout was in flight.
- `tests/push-platform.test.mjs`: adds native callback simulation covering refresh, duplicate registration, logout/registration race and stale callback.
- [Mobile PR CI](https://github.com/erwin-io/oil-spill-monitoring-buoy-app/actions/runs/40055101034) **passed** on exact mobile PR head. This is Node/Angular CI, not a Gradle APK or real-device FCM delivery proof.
- No production Firebase/Pusher/FCM configuration, live accounts, Google Sheets status or deployed Vercel code was modified by the source PRs.

## 3. Checklist review matrix
All 25 remain **In Progress** unless separately reclassified in the original checklist with test evidence. No artificial completion increments.
| ID | Current code/evidence | Gate still required |
|---|---|---|
| A-06 | Existing admin lifecycle + new HTTP emulator scenario | CI readback, complete role assignment administrative workflow and staging scope acceptance |
| A-09 | New HTTP emulator cursor/latest/empty checks | Large-data pagination and mobile populated history acceptance |
| A-10 | New HTTP test for oil alert ACK/recovery | Full severity, status filtering/pagination and health lifecycle |
| A-12 | Helmet, CORS, Zod, correlation ID, per-instance rate limiter | Distributed enforcement, redacted logging/abuse tests |
| B-13 | Single project + emulator setup documented | Separate live dev/staging/prod and secret rotation governance |
| B-14 | Core Firestore collections + emulator API tests | Full data-model/integrity and retention testing |
| B-15 | Firestore rules deny all direct client access; API Admin only | Authenticated Firestore rules emulator regression on deployed rules |
| B-20 | Petroleum/health/offline persisted and tested; new HTTP ack test | Full lifecycle, stable alert episode history and live scope evidence |
| B-21 | Private Pusher server auth and mobile subscription code | Authorized live event publish/subscription, reconnect, fallback |
| B-22 | FCM server outbox + native token code; mobile session hardening PR | Real Android token registration and foreground/background/tap delivery |
| B-23 | Durable outbox, receipts, retry/backoff, offline sweep hardening PR | Concurrency/lease retry integration, real provider failure behavior |
| C-25 | Firebase auth, route guards, logout seen on Android | Revoked/expired session and account switching integration test |
| C-26 | Dashboard API/empty state UI | Populated, stale, offline and error behavior on device |
| C-27 | Buoy list/search/filter UI | Authorized test buoy populated/scoped list on Android, fleet pagination |
| C-28 | Detail screen exists | Verified populated latest health/spectral/firmware model |
| C-29 | Pusher listener and REST refetch code | Live private event and duplicate/reconnect behavior |
| C-30 | Paginated history UI + new API history test | Populated Android history and large-page UX |
| C-31 | Chart.js trend component exists | Verified real fixture/API values and Android rendering |
| C-32 | Alerts list/detail and role-gated ACK | Real populated Android acknowledgment and state change |
| C-33 | Capacitor FCM plugin and push session race hardening | Foreground/background/terminated delivery and deep-link behavior on Android |
| C-34 | Device health page exists | Populated API-driven health fields + Android fault display |
| C-35 | Config read/edit, server CAS conflict handling | Client input validation, permission UX and Android optimistic-concurrency run |
| C-36 | Pusher connection/fallback code exists | Reconnect and REST reconciliation tests |
| C-37 | Some Ionic error/empty states present | Consistent offline, stale, retry, auth-error user testing |
| C-38 | Android APK previously installed + sign-in/logout witnessed | Exact-head Gradle native build, Firebase init, FCM and lifecycle on device |

## 4. CI and commands
API checkout (`C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api`):
```powershell
git fetch origin
git switch fix/phase1-offline-sweep-cursor
git pull --ff-only
npm ci
npm run check
npm test
$env:FIREBASE_PROJECT_ID = "demo-oil-spill-monitoring-buoy-ci"
$env:GCLOUD_PROJECT = $env:FIREBASE_PROJECT_ID
$env:GOOGLE_CLOUD_PROJECT = $env:FIREBASE_PROJECT_ID
npx firebase-tools@15.9.0 emulators:exec --project demo-oil-spill-monitoring-buoy-ci --only firestore,auth "node --test --test-force-exit tests/integration/*.test.js"
```
Mobile checkout (`C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-app`):
```powershell
git fetch origin
git switch fix/phase1-push-session-race
git pull --ff-only
npm ci
npm test
npm run check
npm run build
npx cap sync android
npx cap open android
```
Build Android through Android Studio/Gradle after installing the appropriate Android SDK. `android/app/google-services.json` must match `com.oilspillmonitoringbuoy.app` and remain private. Never use a Firebase Admin service-account file in Android.

## 5. Mandatory next agent actions
1. Inspect exact-head GitHub Actions, review PR diffs and new Android-main changes. Repair any red checks and re-verify SHA.
2. Keep both PRs unmerged until owner review; do not rotate secrets or touch live Firestore data.
3. Provide a separate emulator rule-denial test and test alert filtering/pagination; current code clips admin alerts at 100 and per-device groups at 100. Fleet listing also clips first 100.
4. Prepare an isolated staging account, administrator-authorized test buoy and assigned viewer/operator, then run HTTP integration against staging with explicitly labeled synthetic telemetry.
5. Test mobile with populated measurement/history/health/trends/alerts and real FCM and Pusher from staging, recording actual Android evidence.
6. Decide between daily Vercel crons and best-effort GitHub scheduling only after operator approval. Confirm prior credential exposure remediation.
7. Update only the exact original checklist status/notes with evidence; don't claim 15 Completed without 15 accepted IDs.
8. Finish D–G firmware/optical/fluidics/power work separately; no hardware/field acceptance is implied here.

## 6. Open problems and constraints
- Offline sweep checkpoint is a single global cursor and page processing is bounded by Vercel execution time; overlapping runs may rescan a page but are expected to remain incident-idempotent. Monitor function duration, missed ticks and backlog; no strict SLA guarantee.
- Notification delivery is at-least-once/best-effort; a provider send/receipt crash window can replay.
- Latest mobile main added Android release artifacts after branch creation; inspect potential accidental artifacts and no secrets before merging.
- The local workspace had no network route to github.com for a full clone. CI on PR head is the execution/test authority for the connector-created commits.
- Neither PR proves native FCM delivery or UV hydrocarbon detection. User account previously showed 0 assigned buoys.

**Status rule:** Keep the original tracker at 13 Completed / 25 In Progress / 0 Blocked / 65 Not Started until justified evidence and source-of-truth re-read establish a change.
