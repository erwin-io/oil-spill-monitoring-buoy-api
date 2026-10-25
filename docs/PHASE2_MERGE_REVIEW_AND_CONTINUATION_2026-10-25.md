# BlueGuard Buoy — Owner-Authorized Merge Review and Follow-on Development
**Recorded:** 2026-10-25, Asia/Manila.
**Authority:** Project Owner explicitly authorized merge and close **where no concerns remain**, plus continued development of pending Phase 2 requirements. Permission to merge is distinct from authorization to deploy, migrate live Firestore, re-provision owned buoys, rotate credentials, or change cloud account settings.

## Pull request dispositions
| PR | Result | Evidence / reason |
| --- | --- | --- |
| Mobile #3, `fix/ci-google-signin-assertion` | **MERGED/CLOSED** | Single structural test assertion updated for the existing Google Sign-In behavior. GitHub CI successful at HEAD `86956b5f29a62ec87a208c264f64dbb78617a4cc`; GitHub confirmed merge commit `dbd54fd9b7b0f44e30089cdf515369fcc37f0b15`. No Google Sign-In implementation changed. |
| API #5, `feat/p2-secure-claim-foundation` | **HOLD: Draft/open** | Does not enforce all owner-private read/write routes by itself; ADMIN/legacy ACL remains if merged without API #6. Claimed device could be exposed during staged production rollout. Automated GitHub-to-Vercel deployment must be assessed/controlled before publishing changes to `main`. Firmware physical-PAIR proof still missing. |
| API #6, `feat/p2-owner-access-foundation` | **HOLD: Draft/open** | Must be coordinated with API #5 and owner-controlled cutover. Hardware PAIR validation, full clean re-provision inventory/backup/rollback, independent owner-loss recovery, real FCM/Pusher and secure offline logout remain release/acceptance gates. Code CI green on latest reviewed functional changes; do not claim production readiness. |
| Mobile #4, `feat/p2-add-device-overview` | **HOLD: Draft/open** | API #5/#6 endpoints are not merged/released. Merging onboarding UI first could expose user paths that cannot complete against production backend. Retargeted to `main` after mobile PR #3 merged; preserve pending review and confirm all latest CI. Real scanner, notification/background and pairing evidence pending. |

**Review policy:** Do not force-merge a blocked PR simply because GitHub reports `mergeable=true`. No blocked PR has been closed as abandoned; they still contain needed code.

## Follow-on development executed under current approval
1. **P2-07** API `GET /api/v1/devices?limit=&cursor=` now returns deterministic sorted, device-scoped, cursor-paginated results without silently truncating at 100. The default first page remains 100 for compatibility; a foreign cursor returns `400 INVALID_CURSOR`. Mobile `ApiService.devices()` now gathers all paged results and guards cursor loops. Emulator tests `tests/integration/device-paging.test.js`; mobile `tests/device-pagination.test.mjs`.
2. **P2-11** Unread count now includes **OPEN, ACKNOWLEDGED and RESOLVED** personal notifications. Independent `openCount` remains OPEN-only. Per-user/device read-through watermark and episode receipts preserve future/unread semantics. Legacy integration expectations were adjusted to the approved contract and fresh RESOLVED incident was covered by emulator tests.
3. **P2-13** **Display-name subfeature**: `PATCH /api/v1/auth/me` authenticates Firebase user, validates a strict 2–80-character display name, only mutates the requester's Firestore profile; no role/status/email fields accepted. Mobile Profile has a name editor and session-generation race guards. Emulator and mobile auth test cases added. **Profile photo Cloudinary integration is not complete** and requires operator-provided settings and provider acceptance. Do not send unsigned public uploads: Cloudinary's unsigned presets cannot enforce all parameters including per-preset file-size limits.
4. **P2-18** PR/CI governance and this durable release-gate report.

## Reviewed CI and environment gates
- API main claim PR #5 previously passed run `40144533200`.
- API #6 earlier code passed run `40159201060`. Follow-on API code at `9785961a3007abbc2a70d975b6a17c924965e2db` passed all jobs (`test`, `firestore-emulator`, `windows-powershell-wrapper`, `isolated-simulator-e2e`) per GitHub job state in run `40167102835`.
- Mobile original code at `55a3bb0e40772f39a8a1f2bfb69696493f193ef3` passed `40159303407` including APK. New pagination/profile edits must pass final HEAD CI; do not infer final success from an older run.
- No source migration, Cloudinary billing/configuration, Firebase Hosting/App Links configuration, installed-phone check, hardware calibration, or production deployment was attempted.

## Pending owner/gate decisions and next development
- Before releasing API #5 + #6: validate any Vercel `main` auto-deployment and agree on an isolated feature-flagged rollout, secure backup and clean re-provisioning rollback. Set `P2_STRICT_OWNERSHIP` only on separately approved cutover.
- Complete backend/mobile test matrix for cross-account and token race; secure per-installation logout in loss-of-network conditions with bounded retention and durable revocation recovery.
- P2-13 avatar requires Cloudinary signed server uploads, verified MIME/magic bytes and size, quota, old asset cleanup and managed credentials; do not invent provider configuration.
- P2-15 requires **actual** approved Firebase Hosting domain and Android SHA-256 signing certificate for verified App Links. Preserve existing package ID and Google Sign-In.
- P2-17 installed Android, physical PAIR and real background FCM acceptance remain open.
- Official Google Sheet's 18 Phase 2 additions remain **unapplied review proposal**; no status, formula, or production data changed.

**State:** software code-review work continues; no deployment/ownership cutover authorized by this merge instruction.
