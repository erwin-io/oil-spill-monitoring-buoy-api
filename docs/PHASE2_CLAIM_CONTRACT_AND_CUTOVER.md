# BlueGuard Phase 2 claim contract (feature branch, not a release gate)

Decision basis: approved P2-DEC-001, P2-DEC-007 and P2-DEC-008. This branch adds a secure claim foundation for P2-01/P2-02; it does not switch existing API reads, Pusher, FCM or configuration to ownership authorization. It must not be deployed as proof of private access until the route-by-route cutover and migration rehearsal pass.

## Provisioning and protected QR

- Trusted ADMIN `POST /api/v1/devices` returns `deviceKey` and a distinct one-time-display `claimCode`. The upload key belongs only in firmware/provisioning, never in QR, mobile app, logs or a user-visible page. The protected internal QR contains `deviceId` plus `claimCode`; it should be inaccessible without physical access to the product.
- Neither secret is stored in plaintext. The claim code uses a domain-separated HMAC and a version counter in `deviceCredentials/{deviceId}`. `POST /api/v1/devices/{deviceId}/claim-code` lets a trusted ADMIN reissue a code **only while unowned**. It invalidates the old QR and active challenge, preserves the device upload key and history. Legacy credentials require this reissue because existing devices never had a claim code.
- Device credentials must still be protected against extraction. A stolen upload key plus claim code can defeat a software-only pairing imitation; firmware must only call the challenge route on physical PAIR input, separate from reset, and confirm only within that physical pairing window. API cannot attest a physical button by itself.

## Five-minute handshake

1. Physical PAIR input causes firmware (already authenticated by `X-Device-ID` and `X-Device-Key`) to call `POST /api/v1/device/pairing-challenges`. It receives `challengeId`, secret `nonce`, and `expiresAt`. The nonce stays with the device, never in QR or the phone. Starting another challenge invalidates the previous one.
2. A verified, ACTIVE Firebase user scans the static protected QR and calls `POST /api/v1/devices/{deviceId}/claims` with `{claimCode}`. The server selects the current five-minute challenge for that device and reserves this claimant in a Firestore transaction; success is `202 PENDING` with the selected `challengeId`. A caller that already knows a challenge ID may include it and the server will reject a mismatch. Invalid, expired, owned and competing claims fail. The claimant can poll `GET /api/v1/devices/{deviceId}/claims/{challengeId}` and receives `PENDING`, `EXPIRED` or `CONFIRMED` without any secret.
3. The paired device confirms the candidate by calling `POST /api/v1/device/pairing-confirmations` with `{challengeId,nonce}` before expiry. The Firestore transaction sets `devices/{deviceId}.ownerUid`, consumes the claim-code hash and marks the challenge confirmed. Replay and new pairing attempts on an owned device fail. Device authentication and PAIR-button enforcement are firmware responsibilities.

All challenge IDs and nonce/code values are 256-bit random strings. Error responses and structured request logs exclude raw secrets. Both start and claim routes use distributed limits, in addition to the app-wide limiter. A user selected as pending still needs a device confirmation. A factory reset is not an ownership transfer, and owner lock is not derived from `allowedDeviceIds`.

## Cutover and migration impact

Existing reads still use `role`/`allowedDeviceIds`, and ADMIN can still read all devices. Those bypasses will be removed from consumer routes in the subsequent owner/Viewer permission slice. Do not expose an owner-claimed buoy in production under this intermediate branch.

Clean re-provisioning inventory must preserve `devices/{id}` identity, measurements, health, alerts and notification references. Before a live cutover: take a verifiable backup, map every device, rehearse unclaimed legacy-code reissue on disposable data, re-provision the protected QR and firmware PAIR path, then replace all old ACL/Pusher/FCM gates atomically at the authorized cutover. Never infer owner from an ADMIN/OPERATOR/VIEWER role or `allowedDeviceIds`. Keep rollback artifacts and do not rotate upload credentials or mutate live records without a separately approved plan.

Emulator tests exercise expiry, incorrect credentials, competing claimants, device nonce, replay, owner lock, legacy reissue and historical measurement retention. They do **not** prove button behavior, device firmware, live cloud indexes, Android pairing UI or staging delivery.
