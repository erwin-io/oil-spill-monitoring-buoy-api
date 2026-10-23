# Oil Spill Monitoring Buoy — Senior Full-Stack / Mobile Tech Lead Agent Handoff
**Review date:** 2026-10-24 (Asia/Manila)  
**Status:** Phase 1 development under active validation; NOT a production or complete-system acceptance certificate.  
**Scope:** A. API / Middleware, B. Firebase / Realtime / Notifications, C. Mobile Application; downstream D–G are future device/build workstreams.  
**Product name:** **Oil Spill Monitoring Buoy** (singular). Do not reintroduce the former invented nickname.

## 1. Mandatory authoritative sources and order of precedence

1. [Live 103-item Development Build Checklist](https://docs.google.com/spreadsheets/d/1u7q7yetXcge09qaLFywK7s6wSRKjLJcKP-R6pi8t1pQ/edit) — tab **Development Checklist**, columns A–J, status in column I. Sheet summary formulas in L:M; source of record for item-by-item status. Updated and re-read on 2026-10-24.
2. [Complete Features, Modules & System Documentation](https://docs.google.com/document/d/1-yEWfGoWpRc_EmNREoHWi7Hqt7ByTaSJ/edit) — architectural scope and acceptance criteria.
3. [Node.js Express API repository](https://github.com/erwin-io/oil-spill-monitoring-buoy-api), branch `main`. Functional baseline commit `69ef8d068bcf032b6d85f37bb2cb528532856f9f` plus this documentation commit. Check the current `main` SHA again on takeover.
4. [Ionic Angular Capacitor mobile repository](https://github.com/erwin-io/oil-spill-monitoring-buoy-app), branch `main`. Latest code repair `f879183fdcc4dab070f18366a85909e9d75da20e`; README/native-ID correction `31f67f77a49f7e92fc672969b3f54c70583eccf1`. Check newest CI run again before changes.
5. Existing API docs `docs/KNOWN_GAPS_AND_RELEASE_GATES.md`, `docs/PHASE1_VALIDATION_AND_DEPLOYMENT.md` and `docs/OLD_NEW_MERGE_REVIEW.md`. Some older deployment-gate statements predate the owner's completed index/HTTPS/scheduler checks: **prefer the dated evidence in this handoff and the live checklist**.

Treat snapshots, tests, screenshots and Firestore records as distinct evidence. Do not claim functionality was exercised on hardware simply because an API route or Ionic screen exists.

## 2. Frozen system decisions

- Architecture: ESP32-S3 / MicroPython future buoy controller → A7670C LTE via HTTPS → Node.js/Express (Vercel) → Firebase Cloud Firestore → Pusher private realtime and Firebase Cloud Messaging → Ionic Angular Capacitor mobile.
- UV-induced fluorescence is for **raw seawater only** (365 nm UV excitation, ZWB2, quartz/optical cell, L39/UV390 filter, AS7341 spectral sensor). Inference is advisory Random Forest, pending real labeled measurements/calibration; do **not** claim lab-grade oil concentration, ppm, or certified contamination detection.
- Coconut-husk + coconut-shell charcoal filter is a separate treatment subsystem: **no post-filter UV measurement, no calculated filtration efficacy from this sensor**.
- No GPS, position tracking or map features in approved scope.
- Initial account flow is Firebase **Email/Password**, with Google sign-in intentionally deferred. Do not add Google authentication without a separate approved provider/mobile SHA/OAuth plan.
- No API contract or production-data changes without impact review. Keep role scopes, immutable measurements, replay protection, status/config version behavior and notification idempotency.
- User explicitly requires the product title **Oil Spill Monitoring Buoy**; avoid other brand names.

## 3. Current checklist update — VERIFIED LIVE

**2026-10-24 update to original native Google Sheet:** 103 items total; **13 Completed**, **25 In Progress**, **0 Blocked**, **65 Not Started**. Completion formula displays approximately **13%**. No invented metrics or status reclassification outside the listed 13 rows.

**Completed IDs** (a Completed status here means the described software capability is implemented and supported by CI/emulator or observed Android/Google Cloud evidence; it does NOT mean complete field deployment):
- **A**: #1 Express API foundation; #2 Vercel deployment and health; #3 CORS/HTTPS/request security; #4 device auth middleware; #5 mobile user auth middleware; #7 measurement ingestion; #8 health ingestion; #11 versioned remote config API.
- **B**: #16 Firestore indexes; #17 Firebase Authentication; #18 latest device projection; #19 immutable historical measurement storage.
- **C**: #24 Ionic Angular Capacitor foundation and installed Android app.

**Still In Progress**:
- **A** #6 provisioning full acceptance, #9 paginated history/latest-state acceptance, #10 alert details/acknowledgment lifecycle acceptance, #12 distributed rate limit/logging/security operational acceptance.
- **B** #13 separate dev/prod Firebase environments and credential governance, #14 full deployed data-model integration, #15 Firestore rules acceptance, #20 alerts persistence/status lifecycle acceptance, #21 live Pusher, #22 end-to-end FCM, #23 notification deduplication/retries under live failures.
- **C** #25–#38 except #24: auth expiry/session restoration, data-dependent overview/list/detail/history/trends/health/config, actual realtime, alert acknowledgment, FCM foreground/background/tap, error/reconnect UX and full Android device acceptance.

**Not Started:** D. GSM / IoT Firmware #39–52 (14), E. UV / Calibration / Edge ML #53–68 (16), F. Water / Cleaning / Separate Coconut Filter #69–84 (16), G. Power / Physical Build #85–103 (19). Do not mark firmware or field acceptance Complete based solely on mock or emulator API tests.

The 13 edited status cells include dated evidence notes. The summary formulas update automatically.

## 4. Observed real-device manual acceptance evidence

Owner's 2026-10-24 Samsung Android screenshots demonstrate:
- Installed APK launches and no longer abruptly closes after adding matching native `google-services.json` and rebuilding. The prior crash was `Default FirebaseApp is not initialized` during Capacitor Push Notifications registration.
- Firebase email/password sign-in, authenticated API bootstrap, and verified-email profile show successfully.
- Log Out returns to Sign in. The Profile page has account identity, verified email badge, assigned buoys, separate About section, and sticky Log Out button.
- Bottom tabs Overview / Buoys / Alerts / Profile render, including the Dashboard's empty summary, gray rounded search bar, classification filter, Alerts status selector and dialog.
- **No assigned buoys (0), no alerts, no real measurement charts in screenshots.** These are UI/empty-state tests only. No push notification was shown. The screenshot's “Realtime: REST fallback” means realtime connection is not proven.

The manual tests do not establish actual FCM token registration to backend, FCM delivery, Pusher subscription/recovery, buoy onboarding, petroleum/health alert handling, chart correctness or session expiry behavior.

## 5. CI and source review

**API**: main `69ef8d0` GitHub Actions [run 40033850723](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40033850723) passed. 18 unit/contract/CORS tests plus 9 Firebase Auth and Firestore emulator integration tests. These test the APIs with synthetic credentials; no real buoy/device on the cloud is exercised. Previous PR #1 and #2 are merged. As checked 2026-10-24, only API `main` branch remains.

**Mobile**: a native-identity change to `com.oilspillmonitoringbuoy.app` caused prior run 40033746319 to fail **one stale structural assertion** expecting the former `io.erwin.oilspillbuoy` value; it was not an Angular or Android runtime failure. Corrected `tests/structure.test.mjs` in commit `f879183` to assert Capacitor and Gradle's actual ID. [Run 40036520991](https://github.com/erwin-io/oil-spill-monitoring-buoy-app/actions/runs/40036520991) passed **21/21 structural tests and Angular production compilation**. The README was then corrected to use the actual native package name in commit `31f67f7`; verify that follow-up CI remains green. These tests **do not include a native Gradle APK build** or true Android FCM transmission.

The native package ID in BOTH `capacitor.config.ts` and `android/app/build.gradle` is **`com.oilspillmonitoringbuoy.app`**. The Firebase Android app's `google-services.json` package name must match exactly. `google-services.json` may exist locally in the rebuilt Android project, but should not be assumed to be available from GitHub; next agent must verify via local operator and never substitute Firebase Admin service-account JSON.

## 6. Deployed cloud evidence and remaining uncertainty

**Firebase**: project ID `oil-spill-monitoring-buoy`. Owner ran Firebase CLI login, project list, and `deploy --only firestore:indexes` successfully. Firebase Console screenshot confirms **three composite indexes Enabled**:
- `alerts` — `deviceId` ascending, `createdAt` descending
- `notificationOutbox` — `status` / `leaseUntil` ascending
- `notificationOutbox` — `status` / `nextAttemptAt` ascending

**Vercel HTTPS API**: `https://oil-spill-monitoring-buoy-api.vercel.app`, routes rooted at `/api/v1`; `/health` health check exists and Android authenticated bootstrap works after native CORS fix. API CORS recognizes `https://localhost` for Capacitor Android and `capacitor://localhost` for iOS; no wildcard allowed.

**Scheduler**: `.github/workflows/development-scheduler.yml` requests every 15 minutes; GitHub Actions manual tick succeeded in owner's screenshot with `{"checked":0,"newOffline":0,"recovered":0}` and `{"processed":0,"scanned":0}`. This establishes scheduler authentication and API reachability **only**, not any actual offline event or notification delivery; confirm an automatic scheduled run separately. GitHub schedule is best-effort, not a strict SLA.

**Duplicate scheduler risk**: API `vercel.json` still contains daily native cron definitions at 01:00 and 02:00 UTC, alongside GitHub Actions. Decide and disable/remove one source after owner's explicit approval; duplicate triggers can complicate evidence and retries.

**Realtime and push status**: The checked-in mobile production environment presently has an empty Pusher client key; actual deployed backend `PUSHER_ENABLED`/`FCM_ENABLED` and credential validity are not verified in this handoff. The earlier Android Firebase native initialization crash is resolved, but **FCM token collection, POST /notifications/register-device, server multicast, foreground/background/terminated notification and tap deep link are unverified**.

## 7. API endpoints and contracts: do not change casually

The API exposes:
- `GET /health` and `GET /swagger.json`, Swagger UI `/swagger`.
- `POST /api/v1/auth/bootstrap` and `GET /api/v1/auth/me`: verified Firebase identity and application profile.
- `GET/POST /api/v1/devices`, `GET/PATCH /api/v1/devices/:deviceId`, `POST /api/v1/devices/:deviceId/rotate-key`: scoped devices and ADMIN provisioning.
- `POST /api/v1/device/measurements`, `POST /api/v1/device/health`: device-key protected ingestion.
- `GET /api/v1/devices/:deviceId/measurements`, `.../measurements/latest`, `.../health`.
- `GET /api/v1/device/config` (buoy), `GET/PUT /api/v1/devices/:deviceId/config` (authorized user; optimistic `configVersion`).
- `GET /api/v1/alerts`, `GET /api/v1/alerts/:alertId`, `PATCH /api/v1/alerts/:alertId/acknowledge`.
- `POST /api/v1/notifications/register-device`, `DELETE /api/v1/notifications/unregister-device`; `POST /api/v1/realtime/auth`.
- `GET /api/v1/jobs/offline`, `GET /api/v1/jobs/dispatch` require cron authorization.

Server schemas (see `src/schemas.js`) accept immutable raw-seawater measurement IDs, timestamps, spectral AS7341 channels `f415, f445, f480, f515, f555, f590`, classification `NORMAL / PETROLEUM / INTERFERENCE / INCONCLUSIVE`, confidence, total fluorescence, optional battery/GSM/cell/diagnostics/calibration/config version. Device health contains battery/charging/signal/sensor/sample pump/wash pump/valve/cell/storage/queue status. Do not invent a post-filter measurement API.

Authorization: application roles `VIEWER / OPERATOR / ADMIN` and `allowedDeviceIds`. New user remains viewer until a trusted admin grants device access. Do not self-elevate or manually change production user roles without operator approval.

## 8. Working directories and validation commands (Windows 11)

API checkout: `C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api`
`git switch main` → `git pull --ff-only origin main` → `npm ci` → `npm run check` → `npm test` → `npm run dev`.

Mobile checkout: `C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-app`
`git switch main` → `git pull --ff-only origin main` → `npm ci` → `npm test` → `npm run check` → `npm run build` → `npx cap sync android` → `npx cap open android`.
For a fresh Android project, preserve native customizations and `google-services.json`; app ID is `com.oilspillmonitoringbuoy.app`. Test debug APK before signing release; use a valid private .jks. The prior Android signing error was an invalid relative keystore path, not backend failure.

If Windows `EPERM unlink node_modules/@esbuild/win32-x64/esbuild.exe` occurs, stop Ionic/esbuild/VS Code debugger, clear `NODE_OPTIONS` and `VSCODE_INSPECTOR_OPTIONS` in CMD, close locking processes and reinstall with `npm ci`. Do not delete `package-lock.json` or bypass peer deps.

Secrets: API `.env.example` documents `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `DEVICE_KEY_PEPPER`, Pusher fields, `FCM_ENABLED`, `CRON_SECRET`, `OFFLINE_MINUTES`. GitHub schedule uses secret names `OIL_SPILL_API_BASE_URL` / `OIL_SPILL_CRON_SECRET` and variable `OIL_SPILL_SCHEDULER_ENABLED`. These are names only: **never copy actual values to chat, GitHub, logs or documentation**. A previous source export exposed credentials; rotation verification is STILL OPEN. Pepper rotation must consider existing device keys.

## 9. Highest-priority next-agent tasks — evidence-driven sequence

**P0 — Build test data and authorization gate:**
1. Read current checklist and BOTH repos. Confirm latest SHAs, Actions checks, deployed Vercel revision, mobile Android package ID and Firestore indexes.
2. Safely provision one **development/test** buoy through ADMIN API after verifying who has authorization. Owner's current account shows 0 assigned buoys. Prefer isolated staging project for artificial PETROLEUM incidents; do not seed fake spills into production.
3. Assign that buoy to a non-admin test account via approved admin workflow; confirm a scoped user sees only authorized records.

**P0 — Full backend and device-simulator acceptance (no sensor yet):**
4. Send syntactically valid raw-seawater measurement and health records with a test device credential; verify idempotent replay, conflicting duplicates, timestamps, latest projection and history pagination.
5. Exercise `NORMAL / PETROLEUM / INTERFERENCE / INCONCLUSIVE`, low battery, sensor FAULT/FAILED, maintenance and offline/recovery episodes; verify alert IDs, severity, acknowledgment roles and notifications without spamming repeated measurements.
6. Exercise authorized config update with version conflict handling, real Android detail/history/trend/health/config UI; capture screenshots/test traces.

**P0 — Real FCM and realtime:**
7. Confirm Android notification permission, FCM registration callback and backend token registration; never display token secret in screenshots. Turn on backend FCM only after correct server credentials and a scoped staging recipient exist.
8. Send a **real FCM push** to test device, confirm app foreground, background, and terminated handling plus alert-tap navigation, permission denied handling, logout token unregister and retries.
9. Configure Pusher safely (server credentials only on API; client key is public), verify private-channel authorization and event refresh, disconnect/reconnect, fallback API reconciliation.

**P0 — Scheduling and infrastructure:**
10. Observe an automatic GitHub Actions tick (not only manual), then simulate offline/recovery and examine outbox delivery; decide removal/disablement of duplicate Vercel daily crons. Keep production SLA unaccepted.
11. Confirm prior Firebase Admin/Pusher/pepper exposures have been rotated as appropriate, with migration plan for provisioned devices. Do not rotate blindly.
12. Update the live Google Sheet **as acceptance evidence is obtained**, not based on implemented-looking UI.

**P1 — Hardening:** native Firebase build-time fail-fast if `android/app/google-services.json` is missing; fleet listing beyond 100 and offline sweep beyond 1,000 devices; shared/distributed rate limiting; Pusher/FCM production observability; exactly-once *not* guaranteed after crash; documentation reconciliation. Scope out field hardware D–G unless separately approved.

## 10. Known limitations and acceptance caveats

- No actual instrument calibration, labeled training set, RF performance or seawater sample measurements are accepted.
- No real ESP32-S3/A7670C LTE telemetry yet, no certified oil detection efficacy and no complete float/solar/fluidics field trial.
- UI remains data-empty because no assigned buoy; dashboard zeros must not be treated as algorithm validation.
- Pusher REST fallback indicates live transport wasn't exercised.
- Native FCM init fixed by local Firebase Android config; **delivery remains untested**.
- Backend notification receipts mitigate repeated sends on ordinary retries but FCM is not exactly-once after process crash.
- Express rate limiting is per instance; production distributed enforcement is pending; some pagination/sweep queries have caps.
- GitHub schedule may delay/miss ticks; monitoring SLA requires a production-grade worker decision.
- No live Firebase test data, production secrets, Google OAuth or user-account roles should be edited without current owner approval.

## 11. Next agent operational instructions / taking the Tech Lead role

Act as the Senior Full-Stack and Senior Mobile Tech Lead for **Oil Spill Monitoring Buoy**. First actions: read this handoff, the official system documentation and all 103 checklist items; inspect BOTH repositories at current `main`; compare live CI and owner-provided Android evidence. Preserve accepted architecture and role boundaries. Maintain a dated, explicit matrix per checklist item with state, code commit, test result, real-device/cloud evidence and release gate. Report meaningful issues with exact file/line/endpoint/test and propose bounded fixes. Prefer reversible PRs for material changes; obtain explicit approval before merges, cloud-data mutations, credential rotation, destructive migration or production-impacting changes. Do not relabel CI as production acceptance. No background autonomous actions unless the owner requests scheduled work.

**Next actionable user-facing milestone:** one authorized test buoy + actual end-to-end synthetic (prefer staging) measurement, alert, push and realtime flow shown on Android, with screenshots/log evidence and no production pollution.

## 12. Review links

- [Official checklist](https://docs.google.com/spreadsheets/d/1u7q7yetXcge09qaLFywK7s6wSRKjLJcKP-R6pi8t1pQ/edit)
- [Specification source](https://docs.google.com/document/d/1-yEWfGoWpRc_EmNREoHWi7Hqt7ByTaSJ/edit)
- [API GitHub](https://github.com/erwin-io/oil-spill-monitoring-buoy-api)
- [Mobile GitHub](https://github.com/erwin-io/oil-spill-monitoring-buoy-app)
- [API 18 + 9 CI](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40033850723)
- [Mobile repaired identity CI](https://github.com/erwin-io/oil-spill-monitoring-buoy-app/actions/runs/40036520991)
- [API deployment validation guide](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/blob/main/docs/PHASE1_VALIDATION_AND_DEPLOYMENT.md)

*Last reviewed: 2026-10-24 Asia/Manila. Update this file as new evidence becomes available.*
