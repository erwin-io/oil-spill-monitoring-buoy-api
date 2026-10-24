# BlueGuard Buoy — Reusable Telemetry Lab

The same script can be run repeatedly to send editable simulated buoy readings through the REAL local Express API, verify real Pusher Channels private-channel delivery, and optionally send actual FCM notifications **only when server-generated alerts call for them**. Synthetic Firestore/Auth records NEVER touch the production cloud project.

## One-time setup (Pusher credential configuration)

From Windows PowerShell, after pulling main and running npm ci:

    npm run sim:telemetry -- -Scenario normal

The first execution automatically copies a configuration template into your private home directory, then exits. Open the private file:

    notepad (Join-Path $HOME 'secure\oilspill\telemetry-lab.config.json')

Set the four Pusher Channels values once, preserving the JSON structure: pusher.appId, pusher.key, pusher.secret, pusher.cluster (usually ap1). These should come from your existing Pusher Channels dashboard. If your previously shared secret was exposed in screenshots, rotate it in Pusher and save the NEW value in this local file.

The Firebase Admin JSON path defaults to:

    $HOME\secure\oilspill\firebase-admin.json

This is where you already moved your validated service-account JSON. Leave the private config setting fcm.serviceAccountJson set to AUTO, or change it to an absolute Windows path with doubled backslashes in JSON. The Firebase project is fixed to oil-spill-monitoring-buoy.

No Pusher secret, Firebase Admin JSON or registration token is ever committed to GitHub. The private config exists OUTSIDE the project folder.

## Everyday one-command usage

    cd C:\Development\oil-spill-monitoring-buoy\oil-spill-monitoring-buoy-api
    npm run sim:telemetry

This runs the ALL scenario and prompts only for YOUR Android phone's FCM registration token in a hidden SecureString prompt. It can send **four** separate test notifications (PETROLEUM, LOW_BATTERY, SENSOR_FAULT, CELL_MAINTENANCE_REQUIRED) because the server legitimately generates four separate alerts.

To limit the FCM sends to **one** alert:

    npm run sim:telemetry -- -Scenario petroleum
    npm run sim:telemetry -- -Scenario low_battery
    npm run sim:telemetry -- -Scenario sensor_fault
    npm run sim:telemetry -- -Scenario maintenance

For no-alert situations, the script does NOT prompt for a token and does NOT send FCM:

    npm run sim:telemetry -- -Scenario normal
    npm run sim:telemetry -- -Scenario interference
    npm run sim:telemetry -- -Scenario inconclusive
    npm run sim:telemetry -- -Scenario below_threshold

To run all scenarios with Pusher but intentionally suppress FCM:

    npm run sim:telemetry -- -Scenario all -NoPush

For a completely isolated local HTTP/emulator run without any external providers:

    npm run sim:telemetry -- -Scenario all -NoPush -NoPusher

You can also run the PowerShell file directly:

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\telemetry-lab.ps1 -Scenario petroleum

## Edit payloads without writing code

All editable data fixtures are in:

    scripts\telemetry-lab.scenarios.json

Each named scenario declares an array of steps and the expected server-generated alert TYPES.

Example PETROLEUM step:

    {
      "kind": "measurement",
      "classification": "PETROLEUM",
      "confidence": 0.97,
      "totalFluorescence": 93,
      "batteryPercent": 78,
      "cellStatus": "CLEAN"
    }

Example LOW_BATTERY step:

    {
      "kind": "health",
      "batteryPercent": 11,
      "charging": false,
      "sensor": "OK",
      "cellStatus": "CLEAN",
      "pendingUploads": 0
    }

If you change values that affect alert conditions, update expectedAlerts accordingly. This is deliberate: the runner FAILS if the server makes an unexpected alert decision.

API-defined behavior:
- NORMAL, INTERFERENCE and INCONCLUSIVE → Pusher measurement.created, no FCM.
- PETROLEUM confidence 0.52 below default 0.8 threshold → Pusher only, no FCM.
- PETROLEUM confidence 0.97 → critical PETROLEUM alert, Pusher events and FCM.
- Low battery below default 20% → warning LOW_BATTERY alert and FCM.
- Sensor FAILED → high-severity SENSOR_FAULT alert and FCM.
- MAINTENANCE_REQUIRED cell → high-severity CELL_MAINTENANCE_REQUIRED alert and FCM.

Leave measurementId, healthId and measuredAt out of fixtures; the runner generates safe unique IDs/current timestamps each run and labels measurements SIMULATED_DO_NOT_USE_FOR_SCIENCE.

## Automatically verified each time

1. Start isolated Firebase Auth and Firestore emulators. The launcher automatically selects unused ports, avoiding conflicts with leftover Java processes.
2. Provision a simulated buoy and scoped test users via HTTP API.
3. Subscribe to private-device realtime using the real Pusher Channels provider and the API's bearer-auth channel signature.
4. Send each telemetry step through POST /api/v1/device/measurements or POST /api/v1/device/health using a real generated per-device key.
5. Verify authoritative latest measurement state and the expected server-generated alerts/outbox counts.
6. Call the CRON_SECRET-protected dispatch endpoint and receive actual Pusher events, then reconcile via the real REST API.
7. If the server created alert.created outbox jobs and FCM is enabled for this run, send through the existing production pushAlert implementation with a separately initialized real Firebase Messaging client targeting only your test phone.
8. Verify provider receipts in the LOCAL emulator and write a secret-free report:

    .test-output\telemetry-lab-report.json

Real Android device display, foreground presentation and notification tap navigation remain your manual observations. These simulator alert IDs do not exist in live Firebase, so tapping a received simulator notification may correctly lead to an alert-not-found screen.

## Safety reminders

- Real Pusher and FCM provider sends are opt-in via your private configuration and the test-phone token prompt; NO synthetic Firestore cloud writes occur.
- FCM can send real messages to the phone; always use a token from your OWN Android phone.
- One-time private config is outside Git, never push it. The runner restores the terminal's prior environment variables when finished.
- If you test a normal case, fcmSendCount=0 and providerFCMAccepted=false is a PASS, not a failure.
- Even if Pusher/FCM succeeds here, deployed Vercel provider settings and Android realtime UI behavior are separate acceptance gates.
