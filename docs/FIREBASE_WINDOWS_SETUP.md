# Beginner setup — Firebase → Node API → Ionic app (Windows 11)

## 1. Install prerequisites

1. Download/install Node.js **22 LTS** from https://nodejs.org/ ; open a new PowerShell window.
2. Check `node --version` and `npm --version`.
3. Extract `BlueWatch_API_Phase1.zip`; open PowerShell in its `api` folder.
4. Run `npm install` once, with internet access.

## 2. Create a Firebase development project

1. Open https://console.firebase.google.com/ and select **Add project**.
2. Enter an identifiable development name, e.g. `bluewatch-dev`. Choose your own project ID; do not use the sample in production.
3. Open **Build → Firestore Database → Create database**. Select a region close to your devices/users. Select production/security mode; this API uses Admin SDK only. Confirm billing eligibility for the chosen region/features.
4. Open **Build → Authentication → Get started → Sign-in method**. Enable **Email/Password**, then **Google**. Set the support email for Google as requested by Firebase.
5. Under Authentication → Settings → Authorized domains, confirm localhost for browser testing where applicable and your approved hosted domain.
6. Under **Project Settings → Service accounts**, click **Generate new private key**. Save the downloaded JSON **outside the project and git checkout**; never share it in chat or paste it in mobile config.
7. Firebase Console → Project settings → General → Your apps → **Web app**. Register e.g. `bluewatch-web-dev` and copy the public web config (`apiKey`, `authDomain`, `projectId`, `appId`, `messagingSenderId`). These client config values are *not* Firebase Admin secrets.

## 3. Configure the backend `.env`

```powershell
cd api
Copy-Item .env.example .env
notepad .env
```

From the service account JSON copy these **to the server environment only**:

- `FIREBASE_PROJECT_ID` ← `project_id`
- `FIREBASE_CLIENT_EMAIL` ← `client_email`
- `FIREBASE_PRIVATE_KEY` ← the complete `private_key` value encoded in one line with literal `\n` characters between PEM lines (inside double quotes if needed)

**Simpler local option:** instead of pasting private key in `.env`, put the JSON outside the extracted package and set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path. Keep project ID in `.env`; leave private key/email blank. For example:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\secure\bluewatch-dev-service-account.json'
```

Generate two independent strong secrets:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Place the first in `.env` as `DEVICE_KEY_PEPPER` and the second as `CRON_SECRET`. Keep these stable and secret; changing the pepper invalidates already-provisioned device credentials. For local browser testing set `ALLOWED_ORIGINS=http://localhost:8100,http://localhost:4200`.

## 4. Firestore security & indexes

From the `api` folder, optionally install Firebase CLI and log in:

```powershell
npm install --global firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

Select your development project. Confirm `firestore.rules` denies direct Firestore reads/writes. The Node API uses Firebase Admin credentials and is still required to enforce user roles. Deployment of rules/indexes may require a billing plan, depending on Firebase feature use.

## 5. Start Node API

```powershell
npm run check
npm test
npm run dev
```

In a separate terminal:

```powershell
Invoke-RestMethod http://localhost:3000/health
Start-Process http://localhost:3000/swagger
```

`/health` must report `database: ready`. Do not proceed as if Firestore works if it returns 503.

## 6. Create the first administrator

1. Set up mobile public Firebase config (step 8) and register through the mobile app using email/password.
2. Click the emailed verification link and return to BlueWatch; choose **I verified my email**.
3. The app calls `POST /api/v1/auth/bootstrap` and creates `users/{uid}` with role `VIEWER` and `allowedDeviceIds: []`.
4. Open Firebase Console → Authentication → Users; copy **your own** UID.
5. Open Firestore → `users` → document with that UID. Change only your user document's `role` to `ADMIN`. Keep `status: ACTIVE`. This is a *manual first-admin setup* in the development project, not a public API that lets users promote themselves.
6. Reopen the app or refresh its session. `GET /auth/me` should return your new role.

Do not promote anonymous or unverified identities. For other operators, assign `role: OPERATOR` and `allowedDeviceIds: ['BUOY-001']`; for viewers, assign permitted IDs explicitly.

## 7. Register a synthetic bench buoy (development project only)

Get your Firebase ID token from an authenticated development client. Never paste it into GitHub, logs, or a shared document. In PowerShell:

```powershell
$base = 'http://localhost:3000/api/v1'
$userToken = '<SHORT_LIVED_FIREBASE_ID_TOKEN>'
$headers = @{ Authorization = "Bearer $userToken" }
$device = Invoke-RestMethod -Method Post -Uri "$base/devices" -Headers $headers -ContentType 'application/json' -Body '{"deviceId":"BUOY-001","name":"Bench Buoy 001","firmwareVersion":"dev","modelVersion":"rf-dev"}'
$device | Format-List
```

Safely record the `deviceKey` **once**. With `X-Device-ID: BUOY-001` and `X-Device-Key: <deviceKey>`, send only a valid synthetic **staging** example:

```powershell
$deviceHeaders = @{ 'X-Device-ID'='BUOY-001'; 'X-Device-Key'=$device.deviceKey }
$payload = @{
 measurementId='TEST-001';measuredAt=(Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz');classification='NORMAL';confidence=0.90
 spectral=@{f415=5;f445=4;f480=3;f515=2;f555=1;f590=1};totalFluorescence=16;batteryPercent=80;signalStrengthDbm=-75;cellStatus='CLEAN';modelVersion='rf-dev';firmwareVersion='dev'
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "$base/device/measurements" -Headers $deviceHeaders -ContentType 'application/json' -Body $payload
```

Repeat the identical HTTP request to check `duplicate: true`. Do **not** interpret these invented values as scientific measurements.

## 8. Configure BlueWatch Ionic (public configuration only)

Extract `BlueWatch_Mobile_Phase1.zip`. Edit:

- `app/src/environments/environment.ts` (local development)
- `app/src/environments/environment.prod.ts` (deployment)

Paste the Firebase **Web app** config from step 2. Set dev `api` to `http://localhost:3000/api/v1`; keep production URL HTTPS. Fill **public** Pusher key and cluster only when configured. Never put server Firebase service accounts or Pusher secret in the app.

```powershell
cd app
npm install
npm test
npm run build
npx ionic serve
```

The app has `ionic.config.json` and Angular project name `app`; `npx ionic serve` should recognize it from the extracted app root. For native Android testing you will later need the Ionic/Capacitor CLI and Android Studio.

## 9. Configure Pusher Channels (optional for first REST run)

1. Open https://dashboard.pusher.com/ and create a **Channels** app, selecting a nearby cluster.
2. Backend `.env`: set `PUSHER_ENABLED=true`, `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, and `PUSHER_CLUSTER`.
3. Mobile environment: set only `pusher.key` and `pusher.cluster`.
4. The backend authorizes private device channels using Firebase user identity and `allowedDeviceIds`. `private-fleet-all` requires ADMIN; alerts are sent on `private-device-<id>`.
5. Realtime signals only tell clients to fetch updated REST state; the event payload is not the scientific truth.

## 10. Configure Android Firebase Cloud Messaging

1. Under Firebase project settings → Your apps, register **Android** using application ID `com.bluewatch.monitoring` (must match `capacitor.config.ts`).
2. Download the Android `google-services.json`. This is Android app configuration, not a service account private key. Store it at `app/android/app/google-services.json` after Android initialization; the path is gitignored in this package.
3. Enable the required Firebase Google sign-in OAuth setup and register Android SHA-1/SHA-256 fingerprints for your debug/release keystores.
4. Install Android Studio and run in the app directory:

```powershell
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

5. In the Android project, ensure the Google Services Gradle plugin and Firebase configuration are present according to the current Capacitor plugin and Firebase instructions. Use a physical Android device or eligible Google-APIs emulator for FCM testing. Accept notification permission when prompted.
6. Sign in on the test device, obtain an FCM token, verify a `notificationTokens` record through the API, and trigger a **staging** health alert. Test foreground/background delivery and alert tap navigation.

**Device-owner acceptance pending:** Real native Google sign-in and FCM on Android cannot be called passed from Node unit tests.

## 11. Deploy API to Vercel

1. Upload the verified API project source to your GitHub repository (or import the extracted folder into a new Vercel project).
2. Vercel → Add New Project → Import repository; configure serverless Node/Express from `api/index.js` with `vercel.json` rewrites.
3. Add environment variables from `.env` into Vercel project settings, with **production service account credentials** and unique `DEVICE_KEY_PEPPER` and `CRON_SECRET`. Do not upload `.env` itself.
4. Set `ALLOWED_ORIGINS` to the approved web domain(s). Native Capacitor origins may differ and must be checked under actual runtime conditions.
5. Deploy; visit `/health`, `/swagger`, `/swagger.json` and run authenticated staging smoke tests.
6. **Vercel Hobby only allows daily cron schedules**. `vercel.json` uses daily jobs as a deployment-compatible default; a 60-minute offline-detection objective requires Pro cron cadence (see `docs/vercel-pro-crons.json`) or an approved alternative scheduler. Daily jobs do not meet the 60-minute objective.

## 12. Release gates

Before marking checklist A/B/C Completed, execute `npm install` + test suites, Firestore emulator integration, concurrency/idempotency tests, Firebase provider tests (Google and email/password), security/role tests, Pusher reconnect, FCM invalid-token/retry checks, exact GitHub CI run, live Vercel smoke tests, Android build, and owner-managed real-device acceptance.
