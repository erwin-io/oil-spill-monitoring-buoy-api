# BlueGuard Phase 2 owner and Viewer access (stacked draft)

This branch implements the P2-04/P2-05/P2-07 authorization foundation on top of the secure claim branch. It is a review candidate, not approval for a production cutover.

## Data and routes

- The confirmed claim stores exactly one `devices/{id}.ownerUid`. Existing `allowedDeviceIds` is never used to authorize a **claimed** buoy, even for the old ADMIN role.
- An Owner uses `POST /devices/{id}/invitations` with a verified Firebase email. A currently ACTIVE application account must already exist. `GET /invitations` exposes the invited user's pending buoy IDs. Only the target account may `POST /devices/{id}/invitations/accept`; acceptance writes a per-buoy Viewer record and a user-owned list index in one transaction. An Owner may `DELETE /devices/{id}/viewers/{uid}`. The Viewer record is always checked on each read and send, so stale list-index entries cannot grant access.
- Claimed buoy measurements, latest, health, detail, config reads, alerts and Pusher private-device authorization accept only the Owner and accepted Viewer. The Viewer cannot change config or acknowledge an incident. An Owner may do both. The FCM outbox checks current access before selecting a recipient, including revocation. The personal `readAlerts` receipt remains distinct from the shared incident state.
- The old ADMIN provisioning endpoints cannot update status or rotate the upload key of an already-owned buoy. A separate owner-authorized maintenance/transfer workflow remains to be built; no implicit administrator ownership transfer exists.
- `GET /devices`, `/auth/bootstrap` and `/auth/me` derive accessible buoy IDs from ownership and accepted Viewer records. The response includes `accessibleDeviceIds` while retaining `allowedDeviceIds` as an API compatibility alias for the current mobile app. Do not use either client field as a backend authorization grant.

## Explicit cutover switch

`P2_STRICT_OWNERSHIP=true` denies consumer reads of **all unclaimed** legacy buoys and removes the ADMIN fleet authorization. Before a separately approved clean re-provisioning cutover, the default temporarily retains Phase 1 ACL reads **only for unclaimed** buoys; claimed buoys are always private. This transitional switch exists to permit a rehearsed, coordinated cutover, not an indefinite legacy ACL plan. The production deployment of this branch and the actual flag change are separate owner gates.

Clean re-provisioning must inventory each old buoy and its immutable measurements/health, alerts and notification references; back up and rehearse recovery before all devices enter strict mode. This branch contains no migration script, no cloud writes and no automatic owner assignment from the old ACL. Strict mode is exercised on disposable Firebase Auth/Firestore emulator accounts in `tests/integration/ownership.test.js`.

## Known gaps before release

- Owner-authorized transfer and lost-claim recovery (P2-03), complete migration inventory/rollback tooling (P2-06), and staged app flows (P2-08–10) remain open.
- P2-12 server-authoritative per-installation FCM sessions and send-time race handling remain open. This branch's FCM change covers current **buoy access** only; existing token registration remains Phase 1 behavior.
- The old fleet channel remains available to a trusted ADMIN only during the unclaimed legacy period. It is denied when strict ownership is enabled. No new consumer UI should subscribe to it.
- The API query for `devices.ownerUid` requires verification in an actual staging Firestore environment; local emulators do not validate cloud index deployment. Existing Firestore rules deny all direct client document access.
