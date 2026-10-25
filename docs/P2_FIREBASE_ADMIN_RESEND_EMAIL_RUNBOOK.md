# P2-15 — Firebase email verification and password reset via Firebase Admin + Resend

## Verified blocker

2026-10-25 owner screenshot: Firebase Console Authentication → Templates → Customize action URL save returns `400 INVALID_ARGUMENT` / `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`. **Leave the Firebase Auth email templates at their current default `/__/auth/action`; do not try to bypass Firebase Console restrictions.**

The separate BlueGuard Firebase Hosting custom action handler is already available at `https://oil-spill-monitoring-buoy.firebaseapp.com/auth/action`. It consumes real one-time Firebase action codes and displays **Open BlueGuard Buoy**. The API now uses Firebase Admin to generate a genuine Firebase-issued action link, validates that it came from our Firebase project, takes only its Firebase mode/code/API key, and creates a same-origin HTTPS URL to BlueGuard's handler. Resend emails it. The app needs **no Firebase Auth email-template update**. Standard Firebase verification token validation and password-reset cryptography are unchanged.

## Safety / activation: disabled by default

```dotenv
P2_AUTH_EMAIL_ENABLED=false
P2_FIREBASE_WEB_API_KEY=
# Already used for invitation/test email:
P2_EMAIL_API_KEY=
P2_EMAIL_FROM=
FIREBASE_PROJECT_ID=oil-spill-monitoring-buoy
DEVICE_KEY_PEPPER=<existing-real-secret>
```

Set `P2_FIREBASE_WEB_API_KEY` from Mobile `src/environments/environment.prod.ts` `firebase.apiKey` (this is a public web configuration key, **not** a Firebase Admin credential). Reuse your existing Resend API key and verified sender. The default `onboarding@resend.dev` sender typically allows delivery only to permitted test recipients; for other accounts, first verify your own sender domain in Resend.

**Only after backend deployment and real provider readiness**, configure the API deployment environment `P2_AUTH_EMAIL_ENABLED=true`. This is an operator-approved external release action and is not performed by a GitHub source merge. Production Git-connected Vercel auto-deploy from `main` has been deliberately disabled; review deployed app/provider configuration before a controlled manual deployment.

### Public readiness route

`GET /api/v1/auth/email/config` returns:
- `{"delivery":"firebase"}` when API email delivery is OFF, missing any key, or running older deployed API code.
- `{"delivery":"resend"}` when **this version of the deployed API** has opt-in enabled and required server-side credentials.

**Older API versions return HTTP 404.** The mobile app treats it as `firebase`, keeping existing SDK email delivery until the new backend is actually ready. This avoids breaking new registrations merely by merging source.

### Requests

- `POST /api/v1/auth/email/verification` requires **Bearer token of that same currently authenticated, password-based Firebase account**, even when the user isn't verified yet. It never trusts a request body to pick a target, and verifies the email/UID against Firebase Admin. Returns `202` on provider acceptance; `204` if already verified; rejects missing credentials or disabled provider. Distributed user-based rate limits apply.
- `POST /api/v1/auth/email/password-reset` accepts `{"email":"user@example.com"}` without login, as expected for a forgotten password. Returns the **same generic 202** for existing, missing, disabled, rate-limited, and provider-failure cases. Never prints or returns user existence or the one-time link. Limits requests by IP and SHA-256-hashed (peppered) email per hour; Firebase Admin generates actual reset codes.
- Firebase Admin generation validates the project-issued `/__/auth/action` link and its `mode`/`oobCode`/`apiKey` before building `/auth/action`; codes never go to the Android app via `/open/**`.
- No Firebase console Templates settings changed. No Firebase user, buoy, FCM record or account history is altered by source deployment itself.

## One-time operator acceptance sequence

1. Ensure BlueGuard Hosting handler `GET https://oil-spill-monitoring-buoy.firebaseapp.com/auth/action` responds **HTTP 200** and returns the custom error page without query parameters (expected); ensure `/.well-known/assetlinks.json` remains HTTP 200.
2. Deploy **the updated API** to an approved HTTPS test/staging environment, or run through an authorized local HTTPS tunnel. Set all required `.env`/deployment variables and `P2_AUTH_EMAIL_ENABLED=true` only for the test environment. Confirm `GET /api/v1/auth/email/config` returns `resend` from the **same URL configured in the mobile build**.
3. Build/reinstall the updated mobile `main` (or test with a suitable staged API environment), using the same Android signing fingerprint that already passed `adb shell pm get-app-links`.
4. Registration: create a **fresh** email/password account in BlueGuard. Backend must send an email whose actual link begins `https://oil-spill-monitoring-buoy.firebaseapp.com/auth/action?mode=verifyEmail`. Gmail → custom BlueGuard page → **Verify email** → **Email verified** → **Open BlueGuard Buoy** → app checks Firebase verification.
5. Forgot password: request reset; email opens `/auth/action?mode=resetPassword` in browser → new password twice → **Password updated** → **Open BlueGuard Buoy** → login with new password.
6. Negative checks: expired/replayed code, outsider URL, duplicate mode/code/key, rate-limited resend, wrong Gmail recipient, unverified account trying to authenticate API, and session switch must not grant unauthorized access.
7. Preserve **redacted screenshots only**: hide full action URLs containing `oobCode`, account emails, registration tokens or secrets. Record the actual observed pass/fail in the development checklist; do not claim mobile acceptance from CI.

### Rollback

If provider delivery fails, set `P2_AUTH_EMAIL_ENABLED=false` on the backend and redeploy/refresh configuration. New mobile builds will use Firebase SDK's default emails again after reading `firebase` from capability route. The Firebase default browser CONTINUE issue may still be present during rollback; it is a *known existing issue*, not a fix. Do not edit Firebase Auth templates in the console.

### Run development checks

```powershell
# Backend
cd C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api
git switch main
git pull --ff-only
npm ci
npm run verify:local

# Mobile
cd C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-app
git switch main
git pull --ff-only
npm ci
npm run verify:local
```

**Do not rerun user-reset against a real existing user solely to test the mail provider**. First use a disposable test account, or just use the authenticated Resend Verification endpoint for the current verified/unverified test user; old accounts that already verified cannot trigger another new verification email.

Reference: Firebase official [Generate email action links](https://firebase.google.com/docs/auth/admin/email-action-links) and [Custom email action handlers](https://firebase.google.com/docs/auth/custom-email-handler).
