# BlueGuard Buoy — P2-13 Avatar Provider Contract and Release Gate

**Scope:** Backend authenticated avatar binary relay and Ionic profile photo interface, added to existing Phase 2 draft API PR #6 and Mobile PR #4. Does not amend P2-DEC-001–009 or authorize deployment.

## API
- `PUT /api/v1/auth/avatar` requires verified Firebase ID token, ACTIVE account, and a raw binary request with Content-Type `image/jpeg`, `image/png`, or `image/webp`.
- Maximum upload body: **2 MiB**. MIME and magic bytes must match; SVG, base64 JSON, unknown types, empty and oversized payloads are rejected.
- Uses server-side signed Cloudinary Upload API over HTTPS; API key/secret remain server-side, **no unsigned browser preset or signing endpoint**. Server computes the controlled asset public ID `blueguard-avatars/<SHA256(user uid)>`, never trusting a path from the client.
- `DELETE /api/v1/auth/avatar` removes the current user's asset by that same server-derived ID using a signed Cloudinary destroy call with CDN invalidation requested. No caller-supplied public ID.
- Cloudinary asset uploads overwrite the same public ID on replacement; response public ID, image type, allowed format and integer version are verified before saving profile. The display URL is a versioned Cloudinary delivery URL constrained to a 256 × 256 thumbnail transformation.
- State is isolated under `users/{uid}` with one **transaction-backed** operation lock for 120 seconds, **five attempted uploads per UTC day per account**, distributed request admission (**12 upload and 6 delete per minute**, independently configurable). A failed Cloudinary operation unlocks for retry but still counts against attempted upload quota.
- If the provider is not configured, endpoints **fail closed with 503** without initiating upload. No cloud account secrets or configuration changes were made.
- Account profile GET/bootstrap/name updates now return `avatarUrl` or null. Photo upload/removal responses are account-bound and mobile updates cannot install stale account response data after a user switch.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` must be provisioned as backend-only environment secrets only after separately approved staging setup.

## Privacy and operational limitations
- Profile photos delivered by Cloudinary via the versioned URL are **publicly retrievable** if the URL is known; do not treat photo links as private storage.
- Binary header and size validation is not a substitute for a full trusted image decoding/moderation pipeline. Cloudinary validates its API upload on real service execution. Real provider and real Android image picker acceptance are **NOT demonstrated** by mocks.
- Deletion requests CDN invalidation; cached image delivery may persist for a short period after deletion.
- Full live-provider replacement, removal, quota, provider-credential permissions/rotation and Free plan usage costs must be checked in a dedicated staging account before merge/deploy.

## Evidence
- API functional code and emulator run: [40168436543](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40168436543), **all four jobs passed** (unit/check, Firestore emulator, simulator E2E, Windows wrapper).
- API unit `tests/avatar.test.js`: accepted/rejected bytes, exact signed SHA-1 fields, pinned path, no API secret in request form, provider fail-closed behavior.
- API emulator `tests/integration/avatar.test.js`: user-bound upload/delete, mismatch rejections, quota, provider failure unlock, versioned URL. All provider interactions in this test are **mocked**, no live Cloudinary access.
- Mobile `tests/auth-session.test.mjs`: avatar response and profile preservation, stale-account rejection; Ionic `profile.page` chooses/removes photos and falls back to initials.
- Mobile final-head CI is separately required. Installed Android and live-provider acceptance are unverified.

## Related P2-12 risk reduction
- Explicit Profile logout now calls `PushService.stop(true)` and **requires server acknowledgement of push-session revocation before Firebase sign-out**. An offline error retains the current Firebase account and in-memory session secret, with a retry message; no insecure persistent secret queue is created.
- App shutdown, forced data removal, Android OS queued FCM, and real offline/background receipt remain separate acceptance gates. Already dispatched push notifications cannot be recalled.
