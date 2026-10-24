# Phase 2 — single-batch API & Firebase software acceptance (2026-10-24)

Owner: thesis operator. **One real Firebase project only** (oil-spill-monitoring-buoy); no staging project. All synthetic petroleum and destructive tests run exclusively in local Auth/Firestore emulators.

## API scope
- A-10: GET /api/v1/alerts?status=OPEN&limit=30&cursor=<last id>; scoped per-device pagination, stable createdAt/id tie handling, global OPEN count, buoy names and per-user unread state. POST /api/v1/alerts/{id}/read records a user-specific receipt, never a global alert status change. Acknowledgement and resolution remain separate server-authoritative states.
- A-12: Structured safe error logs (requestId/method/route-pattern/status/code only). Firestore minute-window throttles across API instances for bootstrap (30/min), buoy telemetry (240/min), config updates (60/min), FCM token registration (30/min), Pusher auth (120/min). Global unauthenticated GET still uses per-instance express-rate-limit and is NOT distributed.
- B-23: tests cover FCM scope/receipts, invalid token deactivation, transient failure + retry and recurrent alert episodes. FCM cannot promise exactly-once delivery across a crash between provider sending and receipt persistence.

## Required operational steps BEFORE existing Firebase deployment
1. Review Firebase project ID and service credentials. Keep service JSON/private keys OUT of git.
2. Run `npm run verify:local -- --skip-install` (uses disposable demo- emulators).
3. Ensure `firestore.indexes.json` includes status/createdAt and deviceId/status/createdAt combinations. **Owner must approve index deployment** to the existing cloud project.
4. In Firebase Console configure Firestore TTL policy on `_rateLimitWindows.expiresAt` (timestamp) so temporary rate-window records expire.
5. Run existing cloud read-only smoke only after a verified, nonprivileged Firebase account is configured; never create synthetic incident/alert data in existing cloud.
6. Configure optional Pusher server-side secret and public mobile key from the SAME app/cluster; keep Pusher secret only on API. Configure FCM Admin permissions and matching native google-services.json locally. Provider delivery evidence remains OPEN until tests against the real providers, not mocked events.
7. For 60-minute OFFLINE behavior, a daily Hobby Vercel cron is inadequate. The existing 15-minute GitHub Actions scheduler is opt-in (repository variable + secrets) and best effort, not an SLA.

## Non-goals / owner gates
- No separate Firebase project, no synthetic live petroleum records, no GPS, no calibrated ppm claims.
- B-13: existing cloud configuration/TTL/index rollout; B-21: real Pusher connection; B-22: real FCM delivery and valid native token remain environment/operator gates.
- Android screen/device bug testing is owner-managed and does not block code-only approval; it must not be recorded as a passed native test if not executed.
