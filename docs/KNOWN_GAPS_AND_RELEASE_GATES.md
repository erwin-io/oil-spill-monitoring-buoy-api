# October 23, 2026 — phase 1 release gate report

## Actual local evidence

- API syntax check via `npm run check`: PASS (Node `--check` for app, handlers, jobs)
- Backend pure/helper and Swagger tests: **9 passed / 0 failed** at the last recorded execution
- Mobile package architecture tests: **4 passed / 0 failed**
- Zip archive integrity: PASS, as recorded at packaging
- Dependencies fetched/installed in authoring environment: **NOT RUN** (network DNS unavailable)
- Express runtime tests: **NOT RUN**
- Firestore emulator and Firebase Admin integration: **NOT RUN**
- Angular production build, TypeScript compiler against dependencies, Ionic CLI serve: **NOT RUN**
- Vercel deployment, Pusher, FCM, native Android and live HTTPS smoke: **NOT RUN**
- GitHub changes committed: **NO**. GitHub was read-only audited; both target repositories contained README, `.gitignore`, LICENSE only at reviewed HEADs.

## Release blockers

1. Generate reproducible `package-lock.json` files using npm registry access, commit them, switch Actions to `npm ci`, and run complete CI on exact new commits.
2. Expand backend request/error/response OpenAPI schemas and contract tests beyond route catalogue.
3. Add Firestore emulator integration tests for concurrent ingest, immutable idempotency/conflicts, stale latest-state protection and atomic outbox writes.
4. Add user-provider tests including Google and password signup/verified-email/disabled/revoked sessions; add multi-user role/scope boundary tests.
5. Prove notification outbox worker retry, transient token delivery, unique per-recipient delivery and crash/restart semantics; current best-effort worker may repeat delivery after partial send failures.
6. Test Firestore recipient scoping at scale. Current outbox worker bounds users to 500 and active tokens to 1000; this is not yet scalable fleet-wide notification delivery.
7. Improve serverless rate-limiting to shared persistent limiter rather than per-instance in-memory counters.
8. Run Vercel staging deployment and choose a scheduler capable of meeting the configured 60-minute offline detection requirement; Hobby daily Cron cannot meet it.
9. Finish UI features: comprehensive chart time-range selection, separate recent alert counts, complete pagination/filters, polished offline UX and comprehensive component tests.
10. Generate and compile Capacitor Android source, configure FCM and Google native OAuth, test actual notification taps with owner.
11. Configure Firebase development project and staging API/FCM/Pusher credentials supplied by owner through secret stores.
12. Push source to both repositories using a trusted local Git client or approved repository-authoring environment, review via PRs and verify GitHub Actions on exact commits.

## Security policies

- Do not upload `FIREBASE_PRIVATE_KEY`, service account files, Pusher secret, cron secret or device key into public repository or mobile source.
- The first administrator must be explicitly provisioned by an authorized operator, never through self-supplied role during bootstrap.
- The device's PETROLEUM class and Random Forest confidence are advisory; no compliance or concentration claims.
- No GPS, map, remote OTA, post-filter measurements or filter performance percentage.

**Status: Development source prepared; Phase 1 not accepted for production.**
