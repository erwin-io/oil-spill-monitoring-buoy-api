# Oil Spill Monitoring Buoy API (Phase 1 working source)

Node.js 20+ / JavaScript ES modules / Express 4 / Cloud Firestore / Firebase Auth / Pusher Channels / FCM / Vercel.

**Scientific boundary:** The API accepts only device-reported **raw seawater** UV-fluorescence spectral measurements and advisory Random Forest classes (`NORMAL`, `PETROLEUM`, `INTERFERENCE`, `INCONCLUSIVE`). Coconut-husk/charcoal treatment is separate. No after-filter sensors, GPS, oil ppm estimates, or filter-removal percentages are implemented.

**Current validation:** GitHub Actions runs `npm ci`, Node syntax tests, unit tests, and isolated Firestore/Auth emulator integration checks. These checks exercise development behavior only; they do **not** replace live Firebase indexes, production credentials, Android/FCM delivery or actual buoy acceptance. See [Phase 1 validation and deployment gates](docs/PHASE1_VALIDATION_AND_DEPLOYMENT.md).

## Quick start (Windows PowerShell)

Install Node.js 22 LTS and npm first. In the extracted `api` folder:

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
npm run dev
```

Populate your **own** Firebase credentials and `DEVICE_KEY_PEPPER` first. Use `docs/FIREBASE_WINDOWS_SETUP.md` for a full step-by-step guide. Expected: `http://localhost:3000/health`, `/swagger`, `/swagger.json`.

```powershell
npm run check
npm test
```

If `/health` returns HTTP 503, inspect your Firebase service account project and Firestore database. Never embed real `FIREBASE_PRIVATE_KEY`, `PUSHER_SECRET`, `CRON_SECRET`, device secret, or service account JSON in a mobile app or Git repository.

## Existing endpoint contract

`/api/v1` endpoints:

- `POST /auth/bootstrap` (verified Firebase token, default VIEWER)
- `GET /auth/me`
- `GET /devices`, `POST /devices`, `GET|PATCH /devices/:deviceId`, `POST /devices/:deviceId/rotate-key`
- `POST /device/measurements`, `POST /device/health` (headers `X-Device-ID`, `X-Device-Key`)
- `GET /devices/:deviceId/measurements`, `/measurements/latest`, `/health`
- `GET /device/config` (buoy authentication)
- `GET|PUT /devices/:deviceId/config` (human account; PUT role restricted)
- `GET /alerts?status=OPEN&limit=30&cursor=...` (scoped cursor paging, `openCount`, buoy names, per-user unread state), `GET /alerts/:alertId`, `POST /alerts/:alertId/read`, `PATCH /alerts/:alertId/acknowledge`
- `POST /notifications/register-device`, `DELETE /notifications/unregister-device`
- `POST /realtime/auth`
- `GET /jobs/dispatch`, `GET /jobs/offline` (secret-protected scheduled invocations)

Human API: `Authorization: Bearer <Firebase ID token>`; bootstrap is the only route able to create the user record. New users have VIEWER role and **no assigned buoy access**. An operator must approve scopes with `users/{uid}.allowedDeviceIds` or assign ADMIN deliberately through an authorized administrator procedure. Device credentials are unique generated 256-bit values, returned exactly once at registration or rotation; their HMAC hashes alone are stored in Firestore.

Measurements are immutable under `devices/{deviceId}/measurements/{measurementId}`. Device retries with the same canonical payload return `duplicate: true`; changed contents return `409 MEASUREMENT_CONFLICT`. Older queued samples cannot overwrite the latest measured state. Alerts and delivery intents are written in the same Firestore transaction. Background delivery is best-effort and needs further acceptance testing for crash recovery, per-token outcomes, and high scale; the only authoritative record is Firestore.

## Deployment and release caveats

- `vercel.json` defaults to two **daily** cron tasks to avoid rejecting a Vercel Hobby deployment. This does **not** satisfy a 60-minute offline-monitoring SLA; for production use a Pro plan with `docs/vercel-pro-crons.json` cadence or an approved external scheduler with authenticated requests. See current Vercel cron limits.
- The repository includes a committed `package-lock.json`. Use `npm ci` for reproducible local and CI installations. CI also runs the Firebase emulator suite without accessing live project data.
- In-memory `express-rate-limit` is per serverless instance, so Phase 2 adds a shared Firestore transaction-based limiter for critical state-changing operations; ordinary GET requests still use per-instance express-rate-limit. The authenticated dispatcher prunes expired `_rateLimitWindows.expiresAt` records in bounded batches; billable Firestore TTL is optional, not required on Spark.
- Firestore page reads, token processing, offline sweeps, Pusher/FCM duplicate-dispatch semantics and index coverage require load/integration verification. Historical measurements must not be used as scientific proof of oil contamination.
- Swagger currently documents the route catalogue, but detailed request and response schemas are incomplete. Treat OpenAPI coverage as **not accepted** until expanded.
- The thesis uses ONE existing Firebase cloud project plus disposable local Auth/Firestore emulators. Never publish synthetic petroleum alerts to the real cloud. For live connectivity checks, use the existing-Firebase read-only smoke runner.

## Expected Firestore collections

`users/{uid}/readAlerts/{alertId}`, `devices/{id}/measurements`, `devices/{id}/health`, `devices/{id}/config/current`, `alerts`, `notificationTokens`, `deviceCredentials`, `notificationOutbox`, `_rateLimitWindows` (set TTL on `expiresAt`).

Client Firestore rules deny all operational access, requiring the Node API. Firebase Admin SDK bypasses Firestore rules; authorization must remain enforced on the Express side.

## One-command BlueGuard automated testing (Windows)

Keep the **API** (`oil-spill-monitoring-buoy-api`) and **Mobile** (`oil-spill-monitoring-buoy-app`) repositories as sibling folders in the same parent directory. After pulling the current `main` in both, open PowerShell **inside either repository** and run exactly:

```powershell
.\test-blueguard.cmd
```

The checked-in launcher automatically checks both repositories, uses existing dependencies when both `node_modules` folders are present (otherwise runs locked `npm ci`), and executes the same shared API `scripts/verify-thesis.ps1` coordinator. Default acceptance includes API syntax and unit tests, isolated Firebase Auth/Firestore emulator **HTTP pairing v2 + legacy regression** tests, Mobile QR/authorization/navigation tests, and Angular production builds. No production Firebase write, Vercel deployment, or physical ESP32 pairing is performed.

The command returns **exit code 0** only when both suites report PASS; failures return **exit code 1**. Results are saved under the API `.test-output/blueguard-one-command-report.json`, `.test-output/api-local-validation.json`, and Mobile `.test-output/mobile-local-validation.json`. Old report files are removed at start to prevent misleading stale PASS output.

Optional *still one-command* variants:

```powershell
.\test-blueguard.cmd -FreshDependencies
.\test-blueguard.cmd -Android
.\test-blueguard.cmd -Android -InstallOnDevice -Screenshot
```

Android options require Android SDK, JDK 21 and the existing Firebase Android configuration, and device installation requires a running emulator or authorized Android phone. **Without -Android, neither hardware nor a Firebase service account is needed.** A real PAIR GPIO + A7670C LTE test requires separately updated device firmware and physical hardware; software emulators do not prove it.

Equivalent npm command from either repository: `npm run verify:all`. Windows GitHub Actions also checks the real one-command launch path via `Verify BlueGuard one-command runner` in the API repository. The script never runs `git reset`, `git clean`, force-pushes, or modifies your local signing configuration.

### Firebase emulator port conflicts (Windows)

The one-command API test runner now generates a private, disposable Firebase
configuration and uses OS-allocated **127.0.0.1** ports for Firestore, Auth,
Firestore WebSocket, emulator hub and emulator logger. If ports 8080, 9099,
9150, 4400 or 4500 are already used by another Java/Firebase process, it
**does not kill that process, reuse its database or connect to production**.
The temporary `firebase-api-local-*.json` config is removed after success or
failure. Local test reports record only the selected port numbers.

Simply rerun `.\\test-blueguard.cmd -Android`; no `taskkill`, service-account
setup or manual edits to `firebase.json` are necessary. Firebase emulator
startup itself still needs Java and enough free local ports. A rare race in
which another process grabs an OS-selected free port between selection and
Firebase startup will fail safely rather than connect to that process.
