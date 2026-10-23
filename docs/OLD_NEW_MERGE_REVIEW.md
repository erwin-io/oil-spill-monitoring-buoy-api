# OLD vs NEW API comparison (2026-10-24)

## Decision
Keep the NEW backend (current main) as the API foundation. The OLD export is a source of isolated behavior and documentation, **not** a replacement or a mergeable branch.

| Concern | OLD export | NEW/current main | Decision |
|---|---|---|---|
| Fleet access | Any authenticated user can list devices/alerts | Allowed-device scopes and admin fleet access | Keep NEW |
| Device authentication | HMAC key verification | HMAC key and ACTIVE device verification | Keep NEW |
| Measurement replay | ID-only duplicate | Payload digest conflict and latest timestamp wins | Keep NEW |
| Alerts / FCM | Direct Pusher and unscoped token fanout | Transactional outbox with scoped token recipients | Keep NEW |
| Health checks | FAULT sensor value and configurable battery threshold | FAILED sensor value and 20% hardcoded threshold | Merge fault aliases and config |
| Measurements | calibrationVersion, configVersion, diagnostics metadata | Missing | Merge optional fields |
| Maintenance warnings | Measurement may report required cleaning | Only health had maintenance alerts | Merge |
| Device status / key | Update credential with status in transaction | Disabled devices could not be re-enabled | Fix transaction |
| Health replay | Optional healthId, no payload conflict detection | Required healthId but no payload digest | Keep required ID, add digest |
| Swagger | Static HTML via CDN | Swagger UI | Keep NEW |
| Vercel | Simple serverless | Serverless + cron/outbox jobs | Keep NEW; scheduling needs external gate |

## Contract preservation
- Routes remain /api/v1 and existing success response keys remain supported.
- Mobile app request body for `PUT /devices/:deviceId/config` uses `configVersion` and is compatible with NEW's editConfig schema. OLD instead required `expectedVersion` and **should not** replace NEW.
- Preserve the API's raw-seawater-only measurement model. No post-filter readouts added.

## Operational release gates
1. Secrets were present in uploaded development exports; rotate the Firebase Admin key, Pusher secret, and device-key pepper/device keys if used. Never commit .env or service account JSON.
2. Firestore composite indexes must be deployed before worker due/lease queries will run.
3. This branch has unit/contract tests, NOT real Firebase emulator concurrency tests or a live credentials test.
4. Vercel Hobby daily cron is **not** a 60-minute offline sweep or promptly delivered notification dispatcher. Use an approved hourly external scheduler or a higher tier/worker before production.
5. The outbox does not yet guarantee per-recipient exactly-once FCM delivery after mid-batch failures, and notification scans are capped at 500 users / 1000 tokens.
6. Device fleet and alert list pagination/scalability, stable token revocation and real Android delivery remain separate release gates.
7. Test the mobile flows for sign-in, config update, scoped alerts, and FCM registration against a staging Firebase project before merging.

## How to validate
```bash
npm ci
npm run check
npm test
```

No Firestore production records or cloud resources are touched by these commands.
