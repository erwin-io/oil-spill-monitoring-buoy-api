# BlueGuard Buoy — QR v2 / Smart LTE pairing contract
**Authoritative shared API + Ionic contract.** Verified implementation: `src/app.js`, `src/pair-intents.js`, `src/schemas.js`, `src/security.js`. Coordinated with [mobile issue #17](https://github.com/erwin-io/oil-spill-monitoring-buoy-app/issues/17) and [API issue #14](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/issues/14).

## Customer journey
**My Buoys → Add Device → Scan QR v2 → Press physical PAIR → authenticated LTE challenge and confirmation → Device Connected Successfully.** No claim code, administrator key, AP, Wi-Fi, BLE or direct phone-to-buoy transport.

QR plaintext (ordinary QR generators may encode exactly this JSON):
```json
{"v":2,"deviceId":"BG-000124"}
```
Both properties are required; extra properties and old `v:1` claim-code QR are rejected by the **new mobile** parser. Device ID uses `^[A-Za-z0-9_-]{1,80}$`. The ID is a public reference only. It must already exist and be ACTIVE in Firestore. Its identity remains stable over ownership transfers.

## Credentials and authentication
- **User calls**: Firebase ID-token bearer authorization, verified email, ACTIVE BlueGuard user account, specific Device ID. `Authorization: Bearer <Firebase-ID-token>`. New users bootstrap through the existing login path before pairing.
- **Device calls**: `X-Device-ID: BG-000124` and `X-Device-Key: <long-term-device-key>` over certificate-verified HTTPS. The backend compares an HMAC digest and checks active device status and credential enablement.
- QR contains **no secret**. The phone never receives the modem, device key, challenge nonce or credential hash. A PAIR GPIO press must be enforced in trustworthy ESP32-S3 firmware before sending the device-authenticated challenge; the backend cannot remotely prove a genuine GPIO press.

## Strict protocol v2: exact endpoints and JSON

### 1. Phone: create pairing intent
`POST /api/v1/devices/{deviceId}/pair-intents` with `Authorization: Bearer ...` and JSON `{}` (no code, no optional fields).

**201 Created**, or **200** when the same account repeats its still-active intent:
```json
{"deviceId":"BG-000124","intentId":"<opaque-server-generated-id>","state":"WAITING_FOR_PAIR","expiresAt":"2026-10-29T03:01:00.000Z"}
```
The authoritative expiry is five minutes after the first intent; retrying the same intent does not extend it. A fresh attempt is permitted only after expiry or cancellation (and provided the buoy remains unowned). If a different Firebase account tries the same device during an active intent, the backend marks that intent `CONFLICT`, clears any pending nonce, and rejects the second account with **409 PAIRING_CONFLICT**. No first/last claimant wins.

### 2. Phone: scoped status polling
`GET /api/v1/devices/{deviceId}/pair-intents/{intentId}` with Firebase user bearer. Only the original intent's account receives a status. HTTP **200**:
```json
{"deviceId":"BG-000124","intentId":"<same-id>","state":"PENDING","expiresAt":"2026-10-29T03:01:00.000Z"}
```
Exact state union: `WAITING_FOR_PAIR` (no device PAIR yet), `PENDING` (device created challenge; final device confirmation pending), `CONFIRMED` (single owner assigned), `EXPIRED`, `CONFLICT`, `CANCELLED`, `ALREADY_OWNED` (old confirmed status after ownership transfer). Failed or unauthorized poll returns an error, **not** confirmation. Response includes `Cache-Control: no-store`. UI polls approximately every 2–5 seconds while active and stops on terminal status, logout, account change, modal close and TTL.

### 3. Phone: explicit cancellation
`DELETE /api/v1/devices/{deviceId}/pair-intents/{intentId}` authenticated as the intent's original account; no request body. Returns **200** with the same status shape, `state:"CANCELLED"`. Erases nonce and challenge pointer. Already confirmed ownership cannot be undone through cancellation (**409 ALREADY_CONFIRMED**). Revoke pending intents on modal close when online; otherwise expiry is authoritative.

### 4. ESP32-S3: physical PAIR event
`POST /api/v1/device/pairing-challenges` using **device credentials**, with exact body:
```json
{"protocol":2}
```
Only call **after physical PAIR input**. The device must be ACTIVE, unowned, and have exactly one valid `WAITING_FOR_PAIR` or `PENDING` intent. Returns **201**:
```json
{"protocol":2,"deviceId":"BG-000124","intentId":"<same-id>","challengeId":"<opaque-id>","nonce":"<secret-device-only-nonce>","expiresAt":"2026-10-29T03:01:00.000Z"}
```
The nonce exists in cleartext **only in the device response**, never in Firestore or phone. A repeated authenticated PAIR call creates a new challenge and invalidates the previous nonce; expired/ambiguous/unowned-intent-less sessions are refused.

### 5. ESP32-S3: confirm
`POST /api/v1/device/pairing-confirmations` with device credentials and exact body:
```json
{"protocol":2,"intentId":"<same-id>","challengeId":"<opaque-id>","nonce":"<nonce-from-step-4>"}
```
Returns **200**:
```json
{"protocol":2,"deviceId":"BG-000124","intentId":"<same-id>","challengeId":"<opaque-id>","state":"CONFIRMED"}
```
The Firestore transaction checks unowned/ACTIVE device, the exact pending `intentId` and `challengeId`, the nonce hash, deadline, active claimant account, and atomically sets `devices/{deviceId}.ownerUid`. It clears the nonce hash, marks `CONFIRMED`, and schedules ownership cache/realtime invalidation. An old nonce, replay, concurrent conflict, wrong device, and expired session cannot grant ownership. Firmware must not auto-generate this body from phone traffic.

## HTTP failures
All errors use the existing `{"error":{"code":"CODE","message":"...","requestId":"..."}}` envelope.
- **401** `AUTH_REQUIRED` / `DEVICE_AUTH_FAILED`: no/invalid user bearer or device credentials.
- **403** `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED`, `DEVICE_DISABLED`, `INVALID_PAIRING_NONCE`: ineligible user/device or wrong nonce.
- **404** `DEVICE_NOT_FOUND`, `NOT_FOUND`: unknown buoy or intent not scoped to this account.
- **409** `ALREADY_OWNED`, `PAIRING_CONFLICT`, `PAIRING_PROTOCOL_CONFLICT`, `PAIR_INTENT_REQUIRED`, `PAIRING_NOT_PENDING`, `CHALLENGE_EXPIRED`, `ALREADY_CONFIRMED`: owner lock, ambiguity, missing active pair event, stale or invalid state.
- **422** `VALIDATION_ERROR`, `INVALID_PAIRING_PROTOCOL`: body not strict v2 schema.
- **429** `RATE_LIMITED`: distributed user/device-minute counters and `Retry-After`.
- **5xx**: unknown backend/transport; retry idempotent status with backoff; NEVER assume pairing succeeded without authenticated `CONFIRMED` status.

Limits from `src/app.js`: pair intent 6/min per signed-in user; pair start 6/min per device; confirmation 12/min per device; cancellation 12/min per user; separate global 120/min middleware. The real request rate may also be affected by environment-configured `RATE_LIMIT_...` values. Do not spin in a tight loop.

## Firestore / concurrency
`devicePairIntents/{deviceId}` is a **per-device mutable ephemeral state record**, separate from `deviceCredentials/{deviceId}` (permanent identity secret), legacy `devicePairings/{deviceId}`, and `devices/{deviceId}.ownerUid`. It stores `intentId, candidateUid, state, expiresAt` and optionally a hashed nonce while pending. It does not retain the plaintext nonce. Confirmed/cancelled records can remain **inactive** for diagnostics; the deadline/terminal status guarantees no reusable active credential. Optional retention cleanup may be considered independently; do not delete records during a live migration without explicit approval.

Two different accounts for the *same buoy* produce `CONFLICT` and abort the first attempt, even if a device challenge was already created. Repeated requests from the same user return the same intent. Different buoys use separate Firestore documents and cannot be crossed. Transactions serialize competing owner updates and re-check `ownerUid`.

## Security limitation — important
**A public Device ID plus a physical button does not cryptographically prove that the initiating mobile user is beside the device.** A malicious signed-in user who knows the public ID could create the only intent before a legitimate user's physical PAIR press; if the legitimate user has no simultaneous intent, server-side uniqueness cannot detect that impersonation. This protocol mitigates conflicts by failing closed, requires genuine authenticated device action, verified signed-in accounts, short TTLs and throttling, but **does not fully eliminate remote pre-intent/race risks**. Treat device enrollment as limited assurance until the Project Owner separately approves a proximity-binding control (for example a physical locally displayed one-time confirmation code). Do not claim cryptographic proof of possession.

## Migration and rollback — no destructive cloud writes
1. New API accepts v2 alongside existing **v1** `POST /device/pairing-challenges` with `{}`, `POST /devices/{id}/claims` with legacy claim code, `GET /devices/{id}/claims/{challengeId}`, and legacy device pairing confirmation `{challengeId,nonce}`. Legacy registration/reissue still returns `claimCode` to administrators **only** for historical clients; new v2 mobile never requests, displays, stores or transmits it.
2. V1 and v2 sessions are mutually exclusive while active. Legacy device pairing when a v2 intent is waiting is refused `PAIRING_PROTOCOL_CONFLICT`. V2 request while a live v1 challenge is active is refused likewise.
3. Retain `deviceCredentials.claimCodeHash`, `claimCodeVersion`, existing upload secrets, owner records, measurements, alerts, viewer access, FCM/Pusher and transfer logic until a separately authorized cutover; do not run a production migration script merely to release this API.
4. Rollback API/mobile to the last compatible deployment if an approved staged roll-out fails; existing v1 firmware cannot complete v2 pairing and must be upgraded by the Device Agent. No key rotation, owner clearing or deletion of history is implied.
5. Simulator/emulator tests validate HTTP transactions, not GPIO wiring, Smart LTE/TLS, field proximity or physical pairing. Physical integration remains Device Agent scope.

## Acceptance references
- Backend integration: `tests/integration/pair-intents.test.js`; legacy regression: `tests/integration/pairing.test.js`.
- Mobile `src/app/core/api.service.ts`, `src/app/pages/add-device.page.ts`, `src/app/core/pairing-code.ts`; tests `tests/add-device-pairing.test.mjs`, `tests/pairing-code.test.mjs`, `tests/api-contract.test.mjs`.
- Related frozen upstream approvals: P2-DEC-001 ownership lock, P2-DEC-002 Viewer scope, P2-DEC-007 clean re-provisioning. This newer QR v2 direction replaces **only** the v1 claim credential in the customer onboarding path.
