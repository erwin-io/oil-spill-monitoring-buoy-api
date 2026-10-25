# BlueGuard Phase 2 — Firebase Authentication + Gmail SMTP (Dev, Staging, Production Demo)

## What remains Firebase
Firebase Authentication owns account identity, passwords, verified-email state, refresh/ID tokens, expiry, and issuance/validation of one-time verification/reset codes. Firebase Admin generates a real action link, the API maps only its signed-project mode/code/API key into the already published HTTPS `/auth/action` handler, and the user taps an Android App Link only after the web action succeeds. Gmail SMTP transports email; it never decides whether the user is verified.

## Create dedicated sender and configure the API
Enable Google 2-Step Verification on a dedicated Gmail account, then create its 16-character Google App Password at https://myaccount.google.com/apppasswords. The ordinary Gmail login password must never be used. Put the following in the ignored **API/server** `.env` (or your hosting platform secret configuration), not in Angular:

```dotenv
FIREBASE_PROJECT_ID=oil-spill-monitoring-buoy
P2_FIREBASE_WEB_API_KEY=YOUR_EXISTING_FIREBASE_WEB_SDK_KEY
DEVICE_KEY_PEPPER=KEEP_EXISTING_REAL_PEPPER
P2_EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-dedicated-sender@gmail.com
SMTP_PASSWORD=GOOGLE_16_CHARACTER_APP_PASSWORD
SMTP_FROM=BlueGuard Buoy <your-dedicated-sender@gmail.com>
P2_EMAIL_TEST_TO=your-permitted-test-inbox@gmail.com
P2_EMAIL_TEST_SEND=false
P2_INVITE_EMAIL_ENABLED=false
P2_AUTH_EMAIL_ENABLED=false
```

Keep existing Firebase Admin credentials in `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`. To use STARTTLS instead of implicit TLS, switch to `SMTP_PORT=587` and `SMTP_SECURE=false`; the implementation **requires successful STARTTLS** and validates the certificate (no plaintext fallback). `SMTP_FROM` must have the same mailbox address as `SMTP_USER` (display name is optional). App passwords sometimes display spaces; the transport strips those spaces in memory. No `.env` or secret should be committed or pasted into chat.

## Local acceptance
```powershell
cd C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api
git switch main
git pull --ff-only
npm ci
npm run check
npm test
npm run email:check
npm run email:check -- --send
```

`email:check` verifies authenticated SMTP/TLS without sending an email. The explicit `--send` sends ONE harmless message to `P2_EMAIL_TEST_TO`; confirm it actually reaches Gmail Inbox or Spam. After PASS, set `P2_AUTH_EMAIL_ENABLED=true`, restart API with `npm start`, and confirm:

```powershell
Invoke-RestMethod 'http://localhost:3000/api/v1/auth/email/config'
```

Expected: `delivery = smtp`. The config route shows only provider configuration readiness, not real provider connectivity. Do not interpret HTTP 202 on forgot-password as delivery proof: the API deliberately returns identical responses for absent, blocked or failed accounts to prevent account enumeration.

Use an existing disposable Firebase **email/password** test user to request a real password reset from the local API, check Gmail, complete the `/auth/action?mode=resetPassword&...` browser action, tap Open BlueGuard Buoy and sign in with the new password. To validate registration, create a fresh user in a mobile build targeting the API configured for SMTP, and check email verification + return. Do not share any URL containing `oobCode`.

## Staging / production-demo deployment
1. Both mobile and API `main` contain source code only. The API's `vercel.json` disables Git-connected automatic deployment of `main`. The installed production APK calls the deployed Vercel API, NOT localhost. Local `.env` changes alone cannot activate real Android registration email delivery.
2. In the existing Vercel project, configure environment-specific SMTP secrets plus Firebase Admin credentials, `P2_FIREBASE_WEB_API_KEY`, `DEVICE_KEY_PEPPER`, and `P2_AUTH_EMAIL_ENABLED=true` **only after** authenticated SMTP delivery passes. Preview and Production environments have separate settings; configure each intentionally.
3. Deploy the specifically reviewed API source as a **manual Preview** deployment, validate Preview's `/api/v1/auth/email/config` returns `smtp`, and test provider connectivity and Gmail delivery from that runtime. Outbound ports 465/587 may be blocked by a hosting platform; a local PASS cannot prove a Vercel PASS. A different provider/hosting plan may be needed if SMTP egress is blocked.
4. The currently published custom Firebase action handler is pinned to Firebase project `oil-spill-monitoring-buoy`. A fully separate staging Firebase project is NOT automatically supported; for staging acceptance either use dedicated test accounts inside the approved current Firebase project or deploy/validate a distinct handler and matching API key/domain before testing.
5. After preview Gmail + phone success, set the same secrets in **Vercel Production** and perform an owner-authorized, coordinated manual Production deployment. This deploys the entire current API, including unrelated Phase 2 authorization changes; preserve the approved P2 ownership and re-provision gates. The existing code has no automated production cutover in this branch.
6. Pull/rebuild/install the latest mobile `main`. The app uses `delivery:smtp` when the API advertises it; for an old/disabled API it continues to use Firebase's default email templates (which still have the previously observed browser CONTINUE defect).

## Failure, rollback, quotas and observability
- For email delivery errors, check SMTP app password, Google account 2-Step Verification/App Password availability, Google anti-abuse notices, and Vercel SMTP outbound access. The transporter returns success only if the server explicitly accepts the intended recipient; actual inbox receipt still needs to be checked.
- Google Gmail SMTP is free within provider limits, not unlimited or delivery-guaranteed, and is suitable for small-scale staging/production demonstrations. Do not promise unrestricted production throughput or guaranteed inbox delivery. A verified-domain transactional transport is preferable at scale.
- To disable Firebase Admin emails safely, set `P2_AUTH_EMAIL_ENABLED=false` and redeploy/restart. The mobile app then uses Firebase SDK emails (known browser redirect issue), with all Firebase Authentication data intact.
- To restore Resend intentionally, set `P2_EMAIL_PROVIDER=resend`, configure its sender credentials and re-enable after verifying recipients. There is NO automatic SMTP→Resend fallback after a failed send (avoids double sending/uncertain security state).
- Owner invitations additionally require `P2_INVITE_EMAIL_ENABLED=true`; `npm run verify:p2` only sends the separate harmless test email when `P2_EMAIL_TEST_SEND=true`.
- Never log raw Firebase action links, Google App Passwords, Firebase Admin service keys, OAuth/FCM secrets or reset recipients in CI/support logs. Treat any exposed `oobCode` as compromised.

References: https://firebase.google.com/docs/auth/admin/email-action-links ; https://nodemailer.com/smtp/ ; https://support.google.com/accounts/answer/185833
