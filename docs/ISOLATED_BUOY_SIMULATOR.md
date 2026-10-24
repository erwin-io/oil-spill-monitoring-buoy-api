# Isolated Buoy Simulator — Pusher + FCM provider acceptance

Purpose: exercise the full HTTP simulator upload, alert, Firestore outbox, real Pusher Channels and optional real FCM sender WITHOUT adding synthetic measurements to the one live Firebase/Firestore project.

## What runs

One command starts disposable local Firebase Auth and Firestore emulators, provisions a simulated buoy through the existing API, sends NORMAL and synthetic PETROLEUM measurements plus sensor diagnostic health with real device-key HTTP authorization, checks latest data/alert records and runs the real outbox-dispatch code. Simulated records carry the flag SIMULATED_DO_NOT_USE_FOR_SCIENCE.

Default mode never contacts Pusher or FCM. Optional provider mode uses a real Pusher private channel and checks receipt of measurement.created, health.updated and alert.created, followed by an authoritative API read. Optional real FCM sends to exactly one explicit owner-supplied Android token using the production pushAlert sender. Firebase Messaging is initialized separately using the existing real project's Admin service account while all Firestore data and receipts stay on the local emulator. FCM provider acceptance is NOT proof of Android screen receipt or notification tapping.

## Commands — Windows PowerShell

Change to API repository and fetch latest main:

    cd C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api
    git switch main
    git pull --ff-only
    npm ci

No provider accounts required for isolated HTTP/Firestore acceptance:

    npm run sim:pipeline

Real Pusher transport (use Pusher Channels, not Pusher Beams):

    $env:PUSHER_APP_ID = "<Channels APP_ID>"
    $env:PUSHER_KEY = "<Channels public KEY>"
    $env:PUSHER_SECRET = "<Channels secret>"
    $env:PUSHER_CLUSTER = "ap1"
    $env:THESIS_PROVIDER_CONFIRM = "SEND_TEST_PROVIDER_EVENTS"
    npm run sim:pipeline -- --with-pusher

Expected report: providerPusher true with three distinct verified event names. Subscriber signs the same private-channel authorization request as the mobile app. The test does not prove a deployed mobile app is connected.

Real FCM (your existing one Firebase project; no simulated cloud writes):

    $env:THESIS_FCM_PROJECT_ID = "oil-spill-monitoring-buoy"
    $env:THESIS_FCM_CREDENTIALS_FILE = "C:\secure\oilspill-service-account.json"
    $env:THESIS_FCM_TEST_TOKEN = "<your-own-phone-FCM-registration-token>"
    $env:THESIS_PROVIDER_CONFIRM = "SEND_TEST_PROVIDER_EVENTS"
    npm run sim:pipeline -- --with-fcm

To do both at once (keep the Pusher environment variables set):

    npm run sim:pipeline -- --with-pusher --with-fcm

Obtain the token from your own authenticated phone's record in the existing Firebase Firestore notificationTokens collection, after granting Android notification permission. Do not put the token, credentials or Pusher secret in GitHub or public messages. Store the service account JSON outside Git. Each provider send is opt-in and its recipient must be your phone. The test notification title is SIMULATION ONLY.

Clear temporary sensitive settings:

    Remove-Item Env:\THESIS_FCM_TEST_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:\THESIS_PROVIDER_CONFIRM -ErrorAction SilentlyContinue
    Remove-Item Env:\PUSHER_SECRET -ErrorAction SilentlyContinue

The simulator writes a JSON report to .test-output/simulator-pipeline-report.json, which is gitignored. It never persists auth secrets or FCM tokens. It **requires both emulator endpoints on loopback and a demo- project ID** or aborts.

## Actual deployment configuration still needed

To use real hosted Pusher events, add server-side Pusher variables APP_ID/KEY/SECRET/CLUSTER plus PUSHER_ENABLED=true in Vercel. Set only public KEY and CLUSTER in the mobile environment and rebuild. The simulator does not write Vercel settings.

To enable real hosted Firebase notifications, verify correct FCM Admin permissions, set FCM_ENABLED=true in Vercel and ensure job dispatch is scheduled. No fake PETROLEUM measurements should be uploaded to the cloud.

## B-13: Cloud Firebase indexes, Admin environment and free rate-limit cleanup

Review API firestore.indexes.json then, after owner approval, deploy just Firestore indexes:

    npx firebase-tools@15.9.0 deploy --only firestore:indexes --project oil-spill-monitoring-buoy

This does not overwrite Firestore Security Rules. Firestore TTL deletes require billing, so this thesis build does NOT require a paid TTL policy. Instead, the existing authenticated /api/v1/jobs/dispatch endpoint now prunes up to 100 expired _rateLimitWindows records on each run (bounded ordinary Firestore deletes within normal project quota). Ensure this scheduler is running; inspect the prunedRateWindows field. Paid TTL is optional, not a completion blocker.

Then run the existing live-cloud read-only API smoke, configured with a verified existing user:

    npm run verify:existing-firebase

Index deployment is a real cloud change and is NOT performed by this script. No paid TTL setup is needed.

## Completion criteria

B-21: Real Pusher channel subscriber must receive private events. C-29: private event + authoritative API refetch must pass; mobile UI refresh remains separate. B-22: real FCM provider must accept the send; device must also actually receive it. C-33: Android foreground/background receipt, tap routing, and logout token cleanup must be seen by owner. B-13: live cloud indexes, TTL, Admin config and read-only smoke must be verified.

Never represent simulator emissions as actual seawater observations, calibrated oil concentrations, or real buoy detections.
