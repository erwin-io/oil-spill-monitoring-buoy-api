# BlueGuard Buoy — Phase 2 Implementation Evidence, Second Continuation
**Recorded:** 2026-10-25 (Asia/Manila). **Boundary:** Development commits and CI only. No PR merge, production deploy, Firestore migration, credential rotation or official checklist edit.

## Baseline
Original stacked PRs retained:
- API PR #5 `feat/p2-secure-claim-foundation` on `main`, initial HEAD `eef8ea9e673a1ead8227fd43b0f1f01c225d98b6`.
- API PR #6 `feat/p2-owner-access-foundation` on API PR #5, starting HEAD `c24411102d38a670bca36d5d5495b39ed90e3944`.
- Mobile PR #3 `fix/ci-google-signin-assertion` on `main`, initial HEAD `86956b5f29a62ec87a208c264f64dbb78617a4cc`.
- Mobile PR #4 `feat/p2-add-device-overview` on Mobile PR #3, starting HEAD `82639083d0577c5679bb96a59f932d5d52136c74`.
All remained open/draft at start. The previously repaired Windows quota CI was not reopened.

## P2-03 — Ownership transfer
- `src/transfer.js` implements current-owner-initiated transfer to an existing verified-email ACTIVE user; 24-hour server expiry; one pending proposal; recipient explicitly accepts with requestId; cancellation by current Owner.
- `POST /devices/:deviceId/transfer`, `DELETE .../transfer`, `GET /transfers/incoming`, `POST .../transfer/accept`, all Firebase user-authenticated; transfer initiation protected by deviceOwnerScope and rate limit.
- Atomic Firestore transaction consumes request and changes single `devices/{id}.ownerUid`; audit subcollection records requested/accepted/cancelled events with actor, request ID, timestamp.
- No physical QR, PAIR, device credentials or admin/fleet role can take ownership; no former-owner or old Viewer ACL carryover. Legacy history, alerts, credentials, and stable device ID remain.
- `tests/integration/transfer.test.js` exercises outsider/recipient denial, duplicate, replay, conflicting acceptance, expiry, audit, history retention.
- Existing PR #4 gains a verified-recipient acceptance screen and owner transfer form requiring manual entry of buoy ID. **Unresolved:** lost-owner/account-recovery reauthorization requires independently verified proof and explicit operator policy; no unsafe admin takeover implemented. Physical transfer Android acceptance not yet observed.

## P2-06 — Clean re-provision rehearsal (READ ONLY)
- `src/migration-plan.js`: immutable inventory planner, detects duplicate IDs, marks owned devices TRANSFER_ONLY, counts preserved history and alerts, produces non-secret owner fingerprints.
- `scripts/p2-migration-inventory.mjs`: read-only Firestore count/pagination reporter; no set/update/delete; retrieves no device credentials. **Not run against live data**.
- `tests/p2-migration-plan.test.js`: pure disposable snapshot, simulated retired legacy ACL and exact rollback validation, preserved measurement/alert/notification arrays. No live migration or backup operation performed.
- Production inventory, backup, operator-approved rollback and device-by-device cutover remain open.

## P2-11 — Personal Notifications
- `POST /notifications/read-all` writes account-specific **per-currently-accessible-buoy** read-through watermarks, not alert acknowledgment. Read-open episode receipts remain preserved and per-account.
- `GET /alerts` marks items unread according to individual episode receipt OR per-device watermark, preserves latest-first list and independent open/unread counts; later shared buoys do not inherit old Mark All Read.
- `tests/integration/personal-inbox.test.js` tests account isolation, future share, reopened episode, Viewer cannot acknowledge and revocation.
- Mobile PR #4 changes Alerts to **Notifications**, removes filters, adds Mark All Read and account-sensitive clearing, updates test assertions. Owner-only incident ack remains in the claimed-device policy; transitional unclaimed legacy ACL awaits authorized cutover.

## P2-12 — FCM installation sessions
- `src/push-sessions.js`: server-minted random session ID/secret, stored secret hash, bounded 30-day expiry, per-installation current-session pointer, create/refresh/revoke endpoints; creating a new session for one installation revokes the prior session atomically.
- Notification token registration binds to live user-authenticated session proof; FCM dispatch checks ACTIVE user, currently authorized buoy, active token, unexpired session and current installation pointer. Claimed devices and strict ownership never dispatch to sessionless tokens.
- Legacy token compatibility for **unclaimed** buoys is temporary until operator-gated ownership cutover; it is not claimed private.
- `tests/integration/push-sessions.test.js`: cross-account token denial, fake secret, refresh, installation replacement, later token registration after revocation, token rebound and session expiry. Legacy ownership test fixture updated to seed sessions.
- Mobile PR #4: non-secret installation ID persists in localStorage; server session secret remains only in memory. Serializes native registration with logout, retires late token, invalidates replaced sessions on next online same-installation sign-in, and maintains existing Google Sign-In.
- **Open:** offline logout cannot guarantee immediate cloud revocation or suppression of already handed-off OS notifications; durable secure retry queue/real Android foreground/background/closed/tap evidence required. In-flight FCM cannot be recalled.

## Next dependency-ready feature selected
P2-14 — Mobile Firebase Email/Password account change-password flow, requiring fresh Firebase reauthentication, current password, new-password confirmation and explicit messaging for Google-only accounts. Existing forgot-password and native Google Sign-In were preserved. Mobile native acceptance remains pending.

## Evidence and gates
- The backend CI run at commit `09c219c7de5dcc063b790c82080b2570144b1afb` succeeded: https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40158581761 (all required API jobs, including emulator and Windows).
- Earlier integration regression at `ad195c7321ebc0f2b3d4e0a248bb1c273bd5c1ce` was caused by an undefined installation reference on session refresh; fixed in `6a57fb73ed6e72fda7759b9597c46bd9618791b0`; follow-up API CI succeeded.
- Mobile CI must be reviewed at FINAL updated head; failures on interim commits included the stale filter assertion and old push harness not mocking AuthService. Fixed in subsequent draft commits. No device push acceptance claim.
- No real Firebase tenant, Cloudinary, Android installed-device, physical PAIR, solar, or UV sensor validation performed by this continuation.
- Next gates: inspect mobile final CI, add any missing device/account switch tests, owner-review security and account-recovery policy, safe staging acceptance, migration rehearsal and explicit approvals.

## Next action and governance
Recheck live branch heads and complete final CI. Continue P2-14 validation and plan P2-13 Cloudinary and P2-15 Hosting App Links without provider/billing changes; both need external setup permission and physical Android acceptance. The 18-row checklist additions remain a proposal (original 103 rows unchanged). Merge, production migration, cutover, credential changes, and deploy require owner approval.
