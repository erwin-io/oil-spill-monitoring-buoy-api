# BlueGuard Buoy — one-command test-account reset

**Purpose:** Make an existing **dedicated test VIEWER** email available for a fresh Register → Verify Email → Gmail invitation → installed Android App Link acceptance test.

## Run on Windows PowerShell

From your existing API clone, after the reviewed GitHub merge:

```powershell
cd C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api
git switch main
git pull --ff-only
npm ci
npm run user:reset
```

The single command prompts for the **exact Firebase Authentication email**. It looks up the UID using Firebase Admin \`getUserByEmail\`, not a Firestore email query. The script prints your **Firebase project ID**, UID and per-type deletion counts. It then requires the literal confirmation:

```text
DELETE test-viewer@example.com FROM oil-spill-monitoring-buoy
```

Replace both values with **the actual printed email and Firebase project**. Nothing is deleted until this second confirmation matches exactly. Ctrl+C or an incorrect confirmation aborts the operation.

**Use only with Firebase Admin credentials configured locally in ignored \`.env\`:** \`FIREBASE_PROJECT_ID\` and \`FIREBASE_CLIENT_EMAIL\`/\`FIREBASE_PRIVATE_KEY\` or \`GOOGLE_APPLICATION_CREDENTIALS\`. This is a **real-cloud destructive script**, not an emulator test or HTTP endpoint. Never commit or share \`.env\`, service-account JSON, report or FCM registration tokens.

## What is deleted

- Firebase Auth identity by exact UID (LAST), after disabling the account and revoking refresh tokens
- \`users/{uid}\` document and **all nested Firestore subcollections**, including \`readAlerts\`, \`notificationReadThrough\`, \`sharedDevices\`, \`invitations\`, profile/avatar metadata
- \`notificationTokens\` where \`uid\` matches (including raw FCM registration-token value)
- \`pushSessions\` and \`pushInstallations\` where \`uid\` matches
- existing \`notificationOutbox/{job}/fcmReceipts/{tokenId}\` for the user's matched token IDs, and personal \`alert.acknowledged\` outbox jobs addressed to that UID
- every known \`devices/{id}/viewers/{uid}\` and \`devices/{id}/invitations/{uid}\` record (never another person's records)
- outstanding \`devicePairings\` whose candidate is the UID, if the buoy remains unowned
- \`deviceTransfers\` whose \`fromUid\` or \`toUid\` is this account, **only while PENDING**
- A previously uploaded profile image from Cloudinary, if present and Cloudinary provider secrets are configured (delete fails closed otherwise)

The script inventories up to 10,000 device and 10,000 outbox records, and refuses unexpectedly large accounts, rather than incompletely cleaning beyond the safety limits. Deletion itself is **not atomic** across Firebase Auth, Firestore, and Cloudinary. If interrupted, the account remains disabled; the report gives partial-progress counts. Fix the error and rerun with the same email. A partial failure is **not** a successful reset.

A local report is written under \`.test-output/user-reset/reset-*.json\`. This directory is Git-ignored; the report contains email and UID but does not intentionally serialize secret token contents.

## Deliberately NOT deleted / protected

**If account is ADMIN/OPERATOR or owns ANY buoy, operation stops before the first write.** To reset an Owner, separately transfer ownership to a verified recipient using the approved Owner transfer workflow and confirm no owned buoys remain. No physical PAIR bypass or legacy admin backdoor is introduced. **Do not use this utility for the separate clean re-provisioning cutover.**

Global buoy documents, upload credentials, physical pairing history, immutable measurements and health telemetry, alerts/acknowledgements, accepted/cancelled ownership-transfer audit, per-buoy ownershipAudit records and shared outbox incident events remain intact. Some *historical incident/audit entries may still contain the old UID*. This is **active test-account teardown**, not a GDPR or legal erasure workflow, and not proof that all historical personal references were scrubbed. Short-lived, one-way hashed \`_rateLimitWindows\` entries naturally expire; they cannot be selectively resolved by email.

Any push notification **already delivered onto a physical Android device cannot be recalled**. Reset removes the eligible server FCM records so future dispatch cannot target this account. A new registration creates a NEW Firebase UID. Old device ownership, Viewer invitations, email receipts and saved browser sessions **do not transfer** to the new UID.

## After successful reset

1. Close/sign out of the old BlueGuard app session on the phone. For a truly clean installed-phone test, clear BlueGuard Buoy's Android app storage, then relaunch.
2. In the mobile app select Register and use that same email. Complete Firebase email verification. Verify User account appears with a NEW UID.
3. Use a separate **currently verified device Owner** to send an invitation to the new UID/email. \`P2_INVITE_EMAIL_ENABLED=true\` and a verified Resend From domain are required to email arbitrary recipients; your \`onboarding@resend.dev\` test-sender arrangement is restricted.
4. On Android Gmail, tap the real invitation HTTPS link. It should open BlueGuard and navigate to My Buoys; verify acceptance and access. \`TEST_BUOY\` tests only navigation and is not a real invite.

The **registration verification** and **forgot-password reset** Firebase email actions currently still require their own App Link implementation; this account reset does not implement or validate those distinct Firebase Auth action links.
