# Oil Spill Monitoring Buoy API — Phase 1 release gates (updated 2026-10-24)

This status supersedes the October 23 packaging-only report. Review the
**current GitHub Actions results on the exact candidate commit**, not historical
test counts.

## Implemented development controls
- Reproducible `package-lock.json` and `npm ci` in CI.
- Node syntax checking and unit tests for domain, validation and OpenAPI catalogue.
- Isolated `demo-oil-spill-monitoring-buoy-ci` Firebase Authentication and Firestore emulator
  HTTP/integration tests. No live credentials are needed or used.
- Immutable raw-seawater measurements, payload conflict detection and stale
  latest-record protection.
- Allowed-device scopes, verified email and role-gated account requests.
- Atomic buoy status / device-credential updates, key rotation and optimistic
  config changes.
- Historical firmware telemetry compatibility: calibration/config metadata,
  diagnostics, queue depth, sensor FAULT/FAILED, and configured battery thresholds.
- Per-episode petroleum / health / maintenance / offline alarms.
- Recipient-scoped paginated FCM outbox delivery with acknowledged token receipts
  for ordinary retries; transient errors still retry.
- Opt-in **development** scheduler workflow for free-tier hosting that cannot
  run frequent native cron jobs.

## Tests that STILL require external resources or authorized operator action

| Gate | State / evidence |
|---|---|
| Unit / syntax CI | Required. Check HEAD Actions runs; not equal to live smoke |
| Firebase Auth/Firestore emulator | Required. Check emulator CI job; indexes are not validated by emulator |
| Firestore composite indexes on cloud | **PENDING OPERATOR**: deploy `firestore.indexes.json` and confirm Ready |
| Public/staging HTTPS API | **PENDING OPERATOR**: Vercel project deploy and /health plus bearer smoke |
| Firebase Admin key + Pusher + device pepper | **ROTATION REQUIRED**: exposed in uploaded export files |
| Android FCM and actual Pusher event | **PENDING OPERATOR**: secrets, registered Android installation, device smoke |
| Reliable production offline/delivery scheduler | **DECISION REQUIRED**: Vercel Hobby cron daily; GitHub Actions is best effort |
| Rate limiting and high-volume fleet paging | **NOT ACCEPTED**: local-only rate limiter and API listing caps |
| Exactly-once push delivery | **NOT GUARANTEED**: FCM may duplicate after crash between send and receipt |
| Concurrent load / cloud-index verification | **PENDING STAGING**: emulator does not enforce production index & limits |

## Security / scientific invariants
- NEVER commit `.env`, service-account JSON, or any secret from exported code.
- User roles cannot be self-elevated through `/auth/bootstrap`; first ADMIN is
  operator-provisioned through a secure trusted procedure.
- Classifications are advisory oil-sensitive fluorescence signatures.
- Raw seawater sampling only: no post-filter readings, map/GPS, ppm or fabricated
  filter removal effectiveness.

**Interpretation:** Merging a passing candidate into `main` is a development
milestone, NOT approval for unsupervised production operation.

See `docs/PHASE1_VALIDATION_AND_DEPLOYMENT.md` for commands and secret names.
