# BlueGuard warm-instance read cache and Pusher refresh

## Scope
This is a lightweight per-Node-process JSON response cache. It is **not** a CDN cache or distributed Redis cache. It reduces repeated Firestore **screen query** work on warm Vercel instances; it does **not** bypass `verifyIdToken(..., true)`, current Firestore user-status checks, or device ownership permissions.

| Route | TTL | Reads protected by |
| --- | --- | --- |
| `GET /auth/me` | 10s | Firebase user + revalidated device membership |
| `GET /devices` | 20s | Firebase user + revalidated device membership |
| `GET /devices/:id` | 20s | Firebase user + device scope |
| `GET /alerts` | 10s | Firebase user + revalidated device membership |
| `GET /alerts/:id` | 10s | Firebase user + fresh device-scope check on hit |
| `GET /invitations`, `GET /transfers/incoming` | 20s | Firebase user (UID-keyed) |
| `GET /devices/:id/measurements`, `latest`, `health` | 15s | Firebase user + device scope |
| `GET /devices/:id/config` | 20s | Firebase user + device scope |

Only successful 200 JSON responses are cached. Cache key includes Firebase UID, role, route, and canonical query. Entries are additionally tagged with user and affected device IDs. Max **400 entries / 8 MiB total / 256 KiB per entry** with LRU and TTL. Requests crossing a local invalidation epoch never insert a stale result.

## Invalidation and delivery
- API-owned changes invalidate local user/device cache entries on successful response; alert read/read-all affects only that user's alerts.
- Device uploads invalidate device-tagged lists/details/history and preserve existing `measurement.created` / `health.updated` Pusher events.
- Profile, device, configuration, ownership, invitation, transfer, alert acknowledgment, and read-receipt changes write a minimal `data.changed` outbox message in the same Firestore transaction/batch (where applicable). Existing cron dispatcher sends to an authorized `private-device-{id}` or `private-user-{uid}` Pusher channel. No raw email, token, key, or notification content in signal.
- The Android app handles `data.changed` while Overview, Buoys, or Notifications is active. On a Pusher signal or an explicit user pull-to-refresh, it sends `X-BlueGuard-Cache-Refresh: true`. Server bypasses that instance's old entry, executes the current Firestore read, and replaces its entry.
- If Pusher is unavailable, the existing 60-second REST fallback reconciliation is preserved.
- Cache is disabled by default when `FIRESTORE_EMULATOR_HOST` is set, as integration fixtures mutate Firestore directly. Opt in by setting `BLUEGUARD_NODE_CACHE_ENABLED=true` for dedicated emulator cache tests.
- Set `BLUEGUARD_NODE_CACHE_ENABLED=false` on API to disable warm-cache behavior without a code rollback.

## Hard limitations
- **No global instantaneous invalidation**: Vercel has multiple independent warm instances; a non-signaled request can see authorized, outdated results for up to 10–20 seconds. Other instances cannot be synchronously cleared without shared state. A Pusher-triggered refresh bypasses the responding instance's entry, but it does not evict other instances.
- **Firestore console/admin edits and independent writers** do not queue BlueGuard's invalidation event, and remain stale until TTL. Use the official authenticated API for managed writes.
- New requests still authenticate and revalidate membership. Cache does not improve time spent verifying tokens, cold-starting functions, or waiting for network round trips.
- Never cache HTTP auth tokens, device secrets, Firebase one-time codes, failed responses, mutation responses, or unrestricted endpoints.
- Any requirement for zero stale reads across all instances must use a shared Redis/cache/version source or disable the response cache.

## Verification
```sh
npm ci
npm run check
npm test
npm run verify:local -- --skip-install
```
In a running authorized API, repeat an identical protected GET and inspect `X-BlueGuard-Cache: MISS` then `HIT` on the same warm instance. Set `X-BlueGuard-Cache-Refresh: true` to force a fresh read (expect MISS). Verify one user's alert-read operation does not evict unrelated users' cached pages. Measure Vercel request logs (safe structured durationMs) on both warm hits and first misses before asserting any numeric speedup.
