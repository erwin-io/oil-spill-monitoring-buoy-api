# Thesis validation: one Firebase project, mostly automated
**Scope:** Existing Oil Spill Monitoring Buoy API + Ionic/Android app, October 2026.

## Firebase decision (approved by owner)
There is **one real Firebase project** for the thesis. You do **not** need to purchase or create a second Firebase project. Two test modes are deliberately different:

1. **Local automated mode** uses the Firebase Auth + Firestore **emulator binaries** on your PC with a disposable `demo-oil-spill-monitoring-buoy-local` name. `demo-` is not a new cloud Firebase project. The suite may write synthetic PETROLEUM events because **all data stays on the PC and is destroyed after the emulator run**.
2. **Existing Firebase read-only mode** signs into the **same Firebase project as your Android app** using a pre-existing, verified test account. It issues only GET requests to your API, plus the necessary Firebase Authentication password sign-in. It never calls write-enabled API endpoints.

### Automated API suite (recommended first)
Requirements: Windows 11/PowerShell, Node.js 22+, npm, Java JDK 21+, internet for initial npm/Firebase emulator download. The repository needs `firebase.json`, `firestore.rules` and lockfile as committed.

```powershell
cd C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api
git fetch origin
git switch fix/phase1-offline-sweep-cursor
git pull --ff-only
npm run verify:local
```

The runner performs **npm ci**, **npm run check**, **npm test**, and **Firestore+Auth emulator HTTP/integration tests** in that order. If one fails, the runner exits nonzero and records `FAIL`; it **never forces a green result**. Output: `.test-output/api-local-validation.json` (ignored by git). Later, you may use `npm run verify:local -- --skip-install`. Use `--dry-run` to print what would run.

Acceptance tested automatically includes registration/duplicate prevention, Firebase verified/disabled/scoped users, simulated raw-seawater measurement and history, 135-sample cursor pagination, immutable replay, stale latest projection, health and oil alarms, alert acknowledgment/recovery, config version conflict, device disable/rotation, offline alerts and notification outbox/receipts with mocked providers, and Firestore rules deny-all.

**No real Firebase key is required for this suite.** The runner forces a `demo-` Firebase project, clears imported credential environment variables and disables external FCM/Pusher. If you have real service credentials in `.env`, do not share the file; the suite requires both emulator hosts and the demo project ID before exercising test fixtures. Do not override those safeguards.

### Smoke test the SAME real Firebase project (read-only)
This optional check requires a **pre-existing verified Email/Password user whose API profile is already bootstrapped**. Register/sign in through the app once to create the `users/{uid}` profile; bootstrap is not called by the read-only automation because it can write.

Start your regular API locally via `npm run dev` with `.env` pointing to the existing project (or use the existing hosted HTTPS API). Then in a second PowerShell window:

```powershell
$env:THESIS_API_BASE_URL = "http://localhost:3000/api/v1"
$env:THESIS_FIREBASE_PROJECT_ID = "<your existing Firebase project ID>"
$env:THESIS_FIREBASE_WEB_API_KEY = "<Firebase public Web API key>"
$env:THESIS_TEST_EMAIL = "<existing verified user email>"
$secure = Read-Host "Firebase test password" -AsSecureString
$env:THESIS_TEST_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
# Optional: only when this user is assigned a REAL test buoy (read-only).
# $env:THESIS_TEST_DEVICE_ID = "TEST-BUOY-001"
npm run verify:existing-firebase
Remove-Item Env:THESIS_TEST_PASSWORD
```

For a hosted API instead of local, use `THESIS_API_BASE_URL=https://<approved-host>/api/v1`. The script refuses unencrypted non-local HTTP, wrong Firebase token audience, and unverified email. It checks API health, identity, fleet and alerts; when `THESIS_TEST_DEVICE_ID` is supplied, it checks device/latest/history/health/config. Missing latest history is explicitly recorded as `SKIP_EMPTY_HISTORY`, **not** invented data. A user without an assigned device can still pass the read-only API smoke, but populated mobile acceptance remains untested.

Output: `.test-output/api-existing-firebase-readonly.json`; it never prints access tokens or passwords.

### Do not automatically generate thesis incidents in the real project
The runner intentionally does not provision/rotate/disable real devices, change roles/config, create artificial oil incidents, acknowledge genuine alerts, dispatch FCM, or clean/delete records in the live project. Such changes require a controlled dedicated test-buoy record with explicit owner authorization and a clear cleanup procedure; a `TEST-` prefix alone does **not** isolate system-wide alerts, dashboards or provider jobs.

### What still requires a real Android observation
- Email verification, sign-in and role-scoped data display.
- Populated buoy/history/trends/health rendering, if actual safe test telemetry already exists.
- Private Pusher delivery and reconnect using valid provider configuration.
- FCM foreground/background/tap navigation, and token deactivation after logout.
- Physical UV-fluorescence/Random Forest calibration and buoy telemetry (future hardware phase).

**Green automated checks are software evidence, not proof of real hydrocarbon accuracy or phone notification delivery.** Follow `oil-spill-monitoring-buoy-app/docs/THESIS_LOCAL_MOBILE_VALIDATION.md` for native testing. Neither PR is automatically merged by these commands.
