# BlueGuard Buoy — ONE-COMMAND Phase 2 Acceptance (P2-13, P2-15, P2-16, P2-17)

**Owner request:** source merges into `main` for local checkout/tests. This plan does **not** authorize server deployment, real Firestore re-provisioning, Firebase Hosting deploy, cloud account billing change, or hardware acceptance.

## Windows 11 setup — once
Clone repositories as siblings:
```powershell
cd C:\Development
git clone https://github.com/erwin-io/oil-spill-monitoring-buoy-api.git
git clone https://github.com/erwin-io/oil-spill-monitoring-buoy-app.git
cd .\oil-spill-monitoring-buoy-api
Copy-Item .env.example .env
npm ci
cd ..\oil-spill-monitoring-buoy-app
npm ci
cd ..\oil-spill-monitoring-buoy-api
npm run verify:p2
```
For existing clones use `git fetch origin; git switch main; git pull --ff-only` within **both** repos. Do not check in or attach `.env`, provider keys, Android keystores, FCM tokens, ID tokens, or Cloudinary test credentials.

**Prerequisites:** Node 22, Java JDK 21 (for Firestore emulator), local Firebase CLI executable retrieved by pinned npx `firebase-tools@15.9.0` on first run, internet for package setup and optional live provider probes. Mobile Android SDK/ADB optional, but needed for installed-phone checks.

## Every time — exactly one command
```powershell
cd C:\Development\oil-spill-monitoring-buoy-api
npm run verify:p2
```
Runner reads **existing API `.env`** via dotenv, needs no interactive input, automatically:
1. Runs API syntax + unit + Firebase Auth/Firestore emulator HTTP E2E through the established `verify:local` runner. Safety forces `demo-` project, clears service-account credentials and disables real FCM/Pusher. Never edits live Firestore.
2. Runs isolated full API telemetry simulator for `normal`, `interference`, `inconclusive`, `petroleum`, `low_battery`, `sensor_fault`, `maintenance`, and `all`. Actual fixture execution remains emulator-only.
3. If the mobile repo is present as a sibling, runs mobile tests and Angular production build. If absent, reports SKIP.
4. If `THESIS_PROVIDER_CONFIRM=SEND_TEST_PROVIDER_EVENTS` and test-only provider secrets are provided, runs the same isolated simulator with optional *real Pusher/FCM delivery to the explicitly configured TEST receiver*. Synthetic Firestore records **stay in emulator**. Never infer provider acceptance otherwise.
5. If `P2_STAGING_API_BASE` and a verified account's short-lived `P2_STAGING_ID_TOKEN` are configured, tests read-only HTTPS `auth/me`, `devices`, `alerts`; optional outsider/test device checks read-denial.
6. If Cloudinary `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` are filled, creates a **new disposable 1×1 PNG test asset** under `blueguard-p2-test/`, uses signed Cloudinary Upload API, verifies public delivery, then always attempts signed destruction. This uses provider credits but **never touches a real user's avatar**. Check for cleanup failure explicitly.
7. Builds action link `https://oil-spill-monitoring-buoy.firebaseapp.com/open/invite?deviceId=TEST_BUOY`. Discovers an existing Android **debug** keystore SHA-256 automatically, or reads `P2_ANDROID_SHA256` for the intended release certificate. Emits `assetlinks.json`; probes Hosting URL and certificate association.
8. If `P2_EMAIL_TEST_SEND=true` and the **verified Resend sender** `P2_EMAIL_FROM`, `P2_EMAIL_API_KEY`, `P2_EMAIL_TEST_TO` are configured, sends ONE staging-link email per script invocation to that recipient (who can open it in Gmail). An ACCEPTED API email response is not a real inbox-open receipt.
9. When ADB exists, checks that `com.oilspillmonitoringbuoy.app` is installed on a connected Android device. It **cannot** certify scanner optics, Android notification UX, App Link tap behavior, or physical PAIR automatically. Those are `MANUAL` entries.

Outputs:
- `.test-output/p2-gates/report.json`
- `.test-output/p2-gates/report.md`
- `.test-output/p2-gates/assetlinks.json` (only when signing SHA known)
- `.test-output/p2-gates/invitation-example.txt`

Statuses: `PASS` only where tested; `FAIL` means executed test failed; `SKIP` means absent environment/credentials (not passing); `MANUAL` means impossible to automate without user action/hardware. Overall `PARTIAL` does not establish release acceptance. An executed FAIL sets process exit code 1.

## `.env` keys

Cloudinary:
```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Firebase Hosting / Gmail deep-link test:
```env
FIREBASE_PROJECT_ID=oil-spill-monitoring-buoy
P2_APP_LINK_HOST=oil-spill-monitoring-buoy.firebaseapp.com
# Optional: if blank auto-discover the standard installed debug keystore.
P2_ANDROID_SHA256=
P2_EMAIL_API_KEY=
P2_EMAIL_FROM=
P2_EMAIL_TEST_TO=
P2_EMAIL_TEST_SEND=false
# Actual invited-viewer outgoing email is separately opt-in.
P2_INVITE_EMAIL_ENABLED=false
```
BlueGuard app cannot send email merely from the recipient's Gmail app. Sender delivery uses a server-side provider, currently **Resend**, and the From address/domain must be configured there. The link is **navigation-only**; Firebase sign-in and API verified recipient checks remain authoritative. For the live invitation route, `P2_INVITE_EMAIL_ENABLED=true` sends after a current Owner creates an invitation; response includes `emailDelivery`. A failed send does not revert the recorded invitation; owner can retry.

Staging optional:
```env
P2_STAGING_API_BASE=
P2_STAGING_ID_TOKEN=
P2_STAGING_OUTSIDER_ID_TOKEN=
P2_STAGING_PRIVATE_DEVICE_ID=
# Optional test provider sends, enable only with dedicated TEST account/token.
THESIS_PROVIDER_CONFIRM=
THESIS_FCM_PROJECT_ID=
THESIS_FCM_TEST_TOKEN=
THESIS_FCM_CREDENTIALS_FILE=
```

## P2-15 Android verified-link deployment is a separate gate
This script **generates and verifies** association evidence but deliberately does not deploy public Hosting files or sign/flash a release build. Copy the generated `assetlinks.json` to mobile repo `hosting/public/.well-known/assetlinks.json` and obtain separate Hosting deployment authorization. See mobile `docs/PHASE2_ANDROID_APP_LINKS_STAGING.md`. The Android manifest already claims verified HTTPS `/open/` actions on the existing Firebase domain, and native MainActivity queues deep links for the authenticated My Buoys page. It does not use Firebase Dynamic Links, magic auto-login, or unsolicited device takeover.

## P2-17 and no physical ESP32
**No ESP32 required for software contract, telemetry simulation, access isolation, account switch, Firebase-emulator integration, Pusher/FCM test provider dispatch, APK compilation, or Gmail App Link configuration checks.**

**A physical ESP32 / PAIR input or equivalent physical-buoy prototype is required for the actual physical security acceptance**: prove firmware only starts PAIR after a real separate button press; verify tamper/reset cannot steal ownership, QR protection, upload secret separation, retry after power cuts, pump/optics/weatherproof enclosure. These cannot be truthfully closed by a synthetic REST client, no matter how complete the test runner. Mark physical acceptance awaiting hardware rather than as FAIL or PASS.

An installed Android device is independently required to certify real Gmail tap, OS domain verification, permission prompts, camera QR scan, push foreground/background/killed states, and deep link reconnect. Android emulator may aid UI tests but is not a complete replacement for the intended installed-phone acceptance.

## Source merge vs deployment
For the owner-requested merge-to-main **for local testing**, API `vercel.json` adds `git.deploymentEnabled.main=false` to suppress automatic Vercel production deploys from main. This must be restored/reviewed when a later **production** deployment is separately approved. Do not confuse CI green with production/field acceptance.
