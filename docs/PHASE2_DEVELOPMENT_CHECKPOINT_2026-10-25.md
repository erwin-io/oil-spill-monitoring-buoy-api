# BlueGuard Buoy — Phase 2 Development Continuation Checkpoint and Checklist Proposal
**Recorded:** 2026-10-25, Asia/Manila. **Scope:** draft-branch development only; no merge, production changes or official checklist mutation.

## Authoritative sources
- Owner register: https://docs.google.com/document/d/1RNFILLgaWYWBLTiZkgYLDAyR_ArydtBlWeqyU7vTdrM/edit
- Official 103-row checklist: https://docs.google.com/spreadsheets/d/1u7q7yetXcge09qaLFywK7s6wSRKjLJcKP-R6pi8t1pQ/edit
- System documentation: https://docs.google.com/document/d/1-yEWfGoWpRc_EmNREoHWi7Hqt7ByTaSJ/edit
- Library handover files: 01_BLUEGUARD_PHASE2_TECH_LEAD_TAKEOVER.md, 02_BLUEGUARD_PROJECT_KNOWLEDGE_AND_SOURCES.md, 03_BLUEGUARD_PHASE2_ARCHITECTURE_DECISIONS.md, 04_BLUEGUARD_REQUIREMENTS_PRIORITIES_CHECKLIST_PROPOSAL.md, 05_BLUEGUARD_EMERGENCY_CONTINUATION_PROMPT.md
- Earlier Phase 1 handoff: docs/TECH_LEAD_AGENT_HANDOFF_2026-10-24.md on API main

## Live recovery checkpoint
| Repo | PR | Branch | Last verified code HEAD | Base | CI |
| --- | --- | --- | --- | --- | --- |
| API | #5 | feat/p2-secure-claim-foundation | eef8ea9e673a1ead8227fd43b0f1f01c225d98b6 | main | GitHub API validation passed |
| API | #6 | feat/p2-owner-access-foundation | 94db97a6c5699c4ff59b5ef7b83a03bbc2a39ce1 (before this doc) | feat/p2-secure-claim-foundation | Full API validation passed at 94db97a6 |
| Mobile | #3 | fix/ci-google-signin-assertion | 86956b5f29a62ec87a208c264f64dbb78617a4cc | main | Mobile GitHub CI passed |
| Mobile | #4 | feat/p2-add-device-overview | 82639083d0577c5679bb96a59f932d5d52136c74 | fix/ci-google-signin-assertion | Mobile GitHub CI passed |

PRs remain draft and unmerged; stacked bases were rechecked. API main was d783e6cfe802e61c4941536bbbb6daf62c25930d; Mobile main was 2bee4f5a933ec6b2f15bfa3dcdb70072159d5b92.

### CI defect repaired
Previous API #6 Windows workflow https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40144595460 failed at tests/integration/firestore.test.js:338: null error returned on the third attempt of the per-minute distributed quota test. The test could cross a wall-clock minute boundary; the failing log recorded 20/21 integration subtests passed. No Windows job was disabled. Commit 75264c6906e4f845c45431e47b9b8a52665e4775 injects an optional internal clock into distributedRateLimit while keeping production Date.now behavior. Commit 94db97a6c5699c4ff59b5ef7b83a03bbc2a39ce1 pins the test clock and checks that the rejection exists. Follow-up GitHub workflow https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40156906295 passed **test, firestore-emulator, isolated-simulator-e2e, windows-powershell-wrapper**. GitGuardian and Vercel preview check also passed. This is CI evidence, not physical device acceptance.

## Approved architecture
P2-DEC-001 protected internal QR, separate claim/upload secret, physical PAIR, five-minute device-auth challenge and atomic owner.
P2-DEC-002 one Owner plus verified-email, explicitly accepted read-only Viewer; immediate future access revocation.
P2-DEC-003 per-user no-filter newest-first inbox/read state; only Owner acknowledges incidents.
P2-DEC-004 server-authoritative per-installation Firebase-authenticated sessions and FCM recipient eligibility.
P2-DEC-005 Cloudinary Free own-profile image flow with server-controlled short-lived signatures, validated uploads and quota/privacy handling.
P2-DEC-006 Firebase Hosting action links, verified Android App Links, app-first verify/reset, web fallback, no auto-login.
P2-DEC-007 **clean re-provisioning (owner selected option C)**; no automatic legacy owner mapping, preserve history.
P2-DEC-008 **software-first plus parallel hardware groundwork (option A)**, physical acceptance separate.
P2-DEC-009 approves consolidated package, but preserves owner-controlled production/merge/cloud gates.
Preserve working existing Google Sign-In; do not initiate additional provider expansion. Keep native app identity com.oilspillmonitoringbuoy.app.

## Full P2-01–P2-18 requirements: proposed rows only
Original checklist ends at row 104. The following are **proposed additions in rows 105–122** under Module `H. Phase 2 / BlueGuard Product`. Proposed statuses distinguish draft work from final acceptance. They have **not** been written to the official sheet.

| Proposed sheet row | ID | Checklist item | Priority | Surface | Initial status | Dependency / implementation evidence | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 105 | P2-01 | Claim credentials / protected QR | P0 | API, Device | In Progress | PR #5 | P2-DEC-001 |
| 106 | P2-02 | Five-minute owner claim | P0 | API, Firestore, Device | In Progress | P2-01; API #5; firmware PAIR | P2-DEC-001 |
| 107 | P2-03 | Ownership transfer and recovery | P0 | API | Not Started | P2-01/02/04 | P2-DEC-001 |
| 108 | P2-04 | Per-buoy Owner/Viewer authorization | P0 | API, Firestore | In Progress | API #5/#6 | P2-DEC-002 |
| 109 | P2-05 | Verified Viewer share/revoke | P0 | API, Mobile | In Progress | P2-04; API #6; Mobile #4 | P2-DEC-002 |
| 110 | P2-06 | Clean re-provision dry-run and rollback | P0 | Migration | Not Started | P2-01–05; owner approval for actual cutover | P2-DEC-007 |
| 111 | P2-07 | Scoped telemetry / realtime / push | P0 | API, Mobile | In Progress | P2-04/05; P2-12 for full FCM | P2-DEC-002/004 |
| 112 | P2-08 | Mobile Add Device pairing UX | P1 | Mobile, Device | In Progress | Mobile #4; P2-01/02/03 | P2-DEC-001 |
| 113 | P2-09 | No-access Overview | P1 | Mobile | In Progress | P2-04/05; Mobile #4 | P2-DEC-002 |
| 114 | P2-10 | My Buoys Owned / Shared | P1 | Mobile | In Progress | P2-04/05; Mobile #4 | P2-DEC-002 |
| 115 | P2-11 | Personal Notifications inbox | P1 | API, Mobile | In Progress | Existing alert read route; missing Mark All Read / redesign | P2-DEC-003 |
| 116 | P2-12 | FCM installation/session lifecycle | P1 | API, Mobile | Not Started | P2-04/07; staging FCM | P2-DEC-004 |
| 117 | P2-13 | Own-profile display name and image | P1 | API, Mobile | Not Started | Cloudinary test account/provider setup separately gated | P2-DEC-005 |
| 118 | P2-14 | Password and recovery workflows | P1 | Mobile, Auth | In Progress | Existing reset baseline; full change-password evidence missing | P2-DEC-005/006 |
| 119 | P2-15 | Android verification / reset App Links | P1 | Firebase, Android | Not Started | Signing fingerprints / Hosting domain; operator-gated config | P2-DEC-006 |
| 120 | P2-16 | Staging integration acceptance | P0/P1 | API, Mobile | In Progress | P2-02/04/07/11/12; isolated staging | P2-DEC-008 |
| 121 | P2-17 | Real installed Android acceptance | P1 | Android | Not Started | P2-08–15; physical Android | P2-DEC-008 |
| 122 | P2-18 | Governance, contracts and release gates | P0 | Tech Lead | In Progress | P2-01–17; operator approvals | P2-DEC-009 |

### Exact proposed columns for A105:J122
For each row above, set A=`H. Phase 2 / BlueGuard Product`, B=P2 ID, C=checklist item title, D=acceptance criterion below, E/F/G/H=API/Firebase/Mobile/Device flags (✓ or —), I=proposed initial status above, J=High for P0 (and mixed P0/P1), Medium for P1. Existing sheet's statuses/validation/notes must be rechecked immediately before applying.

| ID | D: precise acceptance text | E API | F Firebase | G Mobile | H Device |
| --- | --- | --- | --- | --- | --- |
| P2-01 | Provision distinct claim and upload secrets; QR excludes upload key; physical PAIR policy. | ✓ | ✓ | — | ✓ |
| P2-02 | Device-auth challenge, atomic sole-owner lock, expiration/replay/competition tests. | ✓ | ✓ | ✓ | ✓ |
| P2-03 | Authorized owner transfer/recovery; physical reset/PAIR cannot steal an owned device; security tests. | ✓ | ✓ | ✓ | ✓ |
| P2-04 | Per-device read/write middleware across history, config, health, alerts and profiles; outsider isolation. | ✓ | ✓ | ✓ | — |
| P2-05 | Verified-email invitation, explicit acceptance, current-rights revocation and read-only tests. | ✓ | ✓ | ✓ | — |
| P2-06 | Read-only inventory, backup, dry run, old ACL retirement, ID/history preservation and rollback rehearsal. | ✓ | ✓ | — | ✓ |
| P2-07 | Current Owner/Viewer access on reads, Pusher auth/reconnect and future FCM; retain ingest/idempotency. | ✓ | ✓ | ✓ | ✓ |
| P2-08 | Protected QR and manual code, pending/expired/retry, simulated and physical PAIR evidence. | ✓ | — | ✓ | ✓ |
| P2-09 | Empty account explains setup or invitation; shows no outsider history/alerts; shared account shows authorized data. | ✓ | — | ✓ | — |
| P2-10 | Owned/Shared navigation, detail/history, remove fleet/assigned wording, profile settings entry. | ✓ | — | ✓ | — |
| P2-11 | Newest first, per-user read/open/mark-all, no filters; owner-only incident ack and incident lifecycle. | ✓ | ✓ | ✓ | — |
| P2-12 | Authenticated install sessions, token binding, logout/expiry/invalid cleanup and revocation races; background eligibility. | ✓ | ✓ | ✓ | — |
| P2-13 | Signed Cloudinary Free avatar upload, validation, constrained transform, replace/remove and fallback. | ✓ | ✓ | ✓ | — |
| P2-14 | Change password with Firebase reauth and clear errors; preserve forgot password recovery. | — | ✓ | ✓ | — |
| P2-15 | HTTPS Hosting action links, verified App Links, web fallback and malformed/expired/reused tests. | — | ✓ | ✓ | — |
| P2-16 | Scoped simulator across four classifications, health, incidents, inbox, Pusher/FCM/REST fallback. | ✓ | ✓ | ✓ | ✓ |
| P2-17 | Onboarding, account switch, sharing, revocation, push lifecycle, App Links and profile. | — | ✓ | ✓ | ✓ |
| P2-18 | Contract diff, migration runbook, evidence matrix, owner-reviewed PRs and deployment approvals. | ✓ | ✓ | ✓ | ✓ |

**Review required before applying:** original rows 2–104 remain unchanged, formulas updated, Phase 2 module counted, no duplicate generic telemetry. On 2026-10-25 original live baseline was 103 items, 34 Completed, 4 In Progress (#13/21/29/33), 65 Not Started. No source row was reclassified.

### Summary formula change proposal (only after owner approval)
- M3: `=COUNTA(C2:C122)`
- M4: `=COUNTIF(I2:I122,"Not Started")`
- M5: `=COUNTIF(I2:I122,"In Progress")`
- M6: `=COUNTIF(I2:I122,"Blocked")`
- M7: `=COUNTIF(I2:I122,"Completed")`
- M8 remains `=IF(M3=0,0,M7/M3)`
- M9: `=COUNTIF(J2:J122,"High")`
- M10/M11/M12/M13: `=COUNTIF(E2:E122,"✓")`, `=COUNTIF(F2:F122,"✓")`, `=COUNTIF(G2:G122,"✓")`, `=COUNTIF(H2:H122,"✓")`
- M16:M22: adjust original module-count ranges from A2:A104 to A2:A122, preserve each L16:L22 category reference.
- L23=`H. Phase 2 / BlueGuard Product`, M23=`=COUNTIF(A2:A122,L23)`; row 23 was blank when last checked.
- Proposed initial statuses: **12 In Progress, 6 Not Started, 0 Completed** for P2-only additions; original statuses unaffected. Do not mark draft code Completed.

## Review findings and unresolved contracts
- API #5 implements claim-code and five-minute challenge foundation; API #6 implements Viewer/owner access and incoming invitation checks. Claimed buoy overrides old ACL; `P2_STRICT_OWNERSHIP` remains an operator-gated future cutover.
- API `GET /devices` currently truncates to the first 100 accessible device IDs and returns null cursor; this remains a pagination/scale acceptance gap.
- API `/alerts/:id/read` stores per-user read state but there is no evidenced dedicated Notifications Mark All Read workflow. The mobile Alerts screen still has status filters (`filter='ALL'` plus select), inconsistent with P2-DEC-003; redesign is pending.
- API `notificationTokens` registration is token/user-bound but not linked to a revocable authenticated per-installation session; P2-12 remains unimplemented. Device access filter in push dispatcher is helpful but insufficient for session-aware push.
- Future Pusher authorization/reconnection rejects revoked Viewer, but already active subscriptions and already submitted FCM messages cannot be recalled.
- Backend and mobile agree on claim request, status and Viewer invitation route paths in reviewed code, but staging/physical Android contracts remain unaccepted.
- Claim firmware must require separate physical PAIR input. Server cannot infer a physical press from upload credentials alone.
- Draft PRs do not prove Android camera installation, physical PAIR, push receipt, Cloudinary integration, Hosting App Links or calibrated fluorescence.
- Phase 1 dependencies: environment separation (#13), deployed Pusher (#21), real mobile live monitoring (#29) and real push (#33); hardware/optics/field rows #39–103 remain Not Started.

## Next task (same existing stack)
1. Recheck API #6 HEAD and GitHub validation after documentation commit; keep draft. No force push or retargeting.
2. Implement/test P2-03 transfer security contract **only after reviewing legacy owner semantics**; a transfer must require current Owner authorization and cannot be triggered by mere PAIR/reset.
3. Build P2-06 read-only migration inventory, disposable-data dry run and rollback without live data changes.
4. Complete P2-11 personal inbox/Mark All Read/no-filters and P2-12 session-aware push with emulator and account-switch/race tests. Keep mobile #4 based on #3 and API #6 based on #5.
5. Collect staging integration and installed Android hardware evidence; do not claim field/scientific acceptance.
6. Prepare a separate owner approval for exact A105:J122 sheet mutation; do not automatically apply.

## Operator gates
Require explicit Project Owner approval before merging draft PRs, production deployment, Firestore migration/data writes/deletes, changing production credentials, actual clean re-provision cutover, Cloudinary/Firebase Hosting account or billing configuration, app identity migration or official checklist mutation. No recovered Work-mode uncommitted filesystem has been observed; only pushed GitHub state is recoverable.


## Second development continuation (2026-10-25) — IMPLEMENTATION EVIDENCE
This is a continuation of the original checkpoint, **not** a replacement for the owner-approved P2-DEC-001–009 or P2-01–18 proposal.

- Detailed implementation/evidence report: [PHASE2_IMPLEMENTATION_REPORT_2026-10-25.md](./PHASE2_IMPLEMENTATION_REPORT_2026-10-25.md).
- **P2-03 API:** owner-authorized verified-recipient transfer, one pending proposal, atomic consent-based ownership reassignment, replay/expiry/concurrency tests, Firestore audit events; recovered previous owner remains locked out. New mobile request/recipient acceptance UI added. Lost-account independent-proof recovery remains an explicit *unresolved approval/identity-proof gate*, not a backdoor.
- **P2-06 API:** read-only inventory and dry-run/rollback simulator with no production writes, no automatic legacy owner mapping, preserved identity/history counts. Live inventory/backup/cutover remain separately gated.
- **P2-11 API+mobile:** account/per-device Mark All Read, newest-first personal Notifications without status filters, independent OPEN/ACKNOWLEDGED/RESOLVED incident state; emulator/structural tests.
- **P2-12 API+mobile:** per-installation session issuance, secret hash, session-bound FCM token, authenticated refresh/logout, expiry, account-switch invalidation, current access filter, invalid-token retirement logic and concurrency tests. Legacy tokens on unclaimed devices remain a transitional compatibility boundary. Offline logout secure durable retry and real Android push acceptance remain open.
- **P2-14 dependency-ready follow-on:** Firebase password change with current-password reauthentication, confirm-new-password UI, Google-only account safeguard; existing working Google Sign-In preserved. User-level test evidence pending final mobile CI.
- Verified backend integration CI at commit `09c219c7de5dcc063b790c82080b2570144b1afb`: https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40158581761 (SUCCESS). Subsequent documentation-only commits still need final-head status recheck.
- Mobile PR #4 had intermediate CI failures because test fixtures still demanded unapproved status filters and did not mock the new AuthService/FormsModule dependencies. The tests and code were updated on the *same* draft branch. Recheck final mobile CI before claiming green.
- **No** PR merge, deployment, production migration, Cloudinary/Firebase Hosting configuration, hardware flash, field test or official Google Sheet edit has occurred.
- Checklist statuses remain an **unapplied proposal**; do not mark items Completed on simulated evidence alone.
- Next acceptance: final-head CI, Android installed-device scanner/PAIR/share/transfer/push tests, staging cross-account/session-revocation tests, signed App Links and Cloudinary provider setup under approval, live migration inventory/rollback review.


### Final validated code checkpoints — October 25, 2026
- **API PR #6 code commit** `126066c67cd6158be359a039e40d22a068881fbf`: [GitHub API validation run 40159201060](https://github.com/erwin-io/oil-spill-monitoring-buoy-api/actions/runs/40159201060) **SUCCESS**: `test`, `firestore-emulator`, `isolated-simulator-e2e`, `windows-powershell-wrapper`. A simulated concurrent ownership acceptance exposed an occasional Firestore ABORTED retry exhaustion; the API now returns a definite 409 conflict rather than allowing uncontrolled error propagation. Firestore integration job reports **24/24** passing subtests.
- **Mobile PR #4 code commit** `55a3bb0e40772f39a8a1f2bfb69696493f193ef3`: [mobile checks run 40159303407](https://github.com/erwin-io/oil-spill-monitoring-buoy-app/actions/runs/40159303407) **SUCCESS**: `install-test-build` (**58/58** tests and production build) and `android-apk-compile` (Gradle APK build). This verifies build and emulator/structural test execution, **not** physical QR scanning, Android notification delivery or buoy hardware behavior.
- Both remain **DRAFT** stacked PRs and **unmerged**. These code-checkpoint SHAs precede any later documentation-only commit on the same branch.
- P2-03 lost-owner independent-proof recovery remains **operator-gated and not implemented as an automatic takeover**. P2-06 actual cloud inventory/backup, P2-12 durable secure offline-logout revocation retry, staging FCM/Pusher, and installed-device tests remain **OPEN**.
- P2-14 password-change implementation passed mobile CI but is not yet accepted on a real Android device or cross-provider account matrix.
- The original 103 official checklist rows remain unchanged, and all 18 proposed Phase 2 additions remain a separate reviewable proposal.


## Owner-authorized conditional merge review and further Phase 2 development — 2026-10-25
- Project Owner explicitly permitted **review/merge/close only if no remaining concern**; this does NOT waive separately held production deployment, re-provisioning or device cutover gates.
- **Mobile PR #3 merged and closed** after successful CI review, GitHub merge SHA `dbd54fd9b7b0f44e30089cdf515369fcc37f0b15`. The change only updates a Google Sign-In structural test assertion; existing native behavior remains.
- **API PRs #5/#6 held open/draft**: PR #5 alone would expose a claimed device to legacy ADMIN/ACL reads pending PR #6; GitHub-to-Vercel main auto-deploy impact not independently controlled. Physical PAIR, owner-loss recovery identity proof, clean re-provision/backup/rollback, and push session/offline acceptance remain unproven. Code CI is not a deployment approval.
- **Mobile PR #4 held open/draft**: retargeted to `main` after PR #3 merged; backend API PR #5/#6 remains unmerged. QR scanner/PAIR/background FCM and cross-account staging gates require real Android/backend evidence.
- Gate findings were recorded as non-blocking-to-development GitHub **COMMENT** reviews on API #5/#6 and Mobile #4. Details: [merge review and continuation](./PHASE2_MERGE_REVIEW_AND_CONTINUATION_2026-10-25.md).
- **P2-07:** paginated `GET /api/v1/devices` (stable ID ordering, nextCursor and outsider isolation), mobile all-pages aggregation with repeated-cursor protection, API/Auth emulator and mobile tests. No device beyond first 100 is silently dropped.
- **P2-11:** personal inbox unreadCount includes OPEN, ACKNOWLEDGED, RESOLVED separately from OPEN-only incident count; own per-device read watermarks and individual episode reads. Old open-only test expectations were updated, new resolved-incident test added.
- **P2-13:** own display-name update supported by strict authenticated `PATCH /auth/me`, no role/status/email mutation, mobile editor and session-switch guards, emulator/unit tests. Cloudinary photo and provider setup still incomplete/operator-gated.
- API development CI `40167102835` at code commit `9785961a3007abbc2a70d975b6a17c924965e2db`: **success in all four** jobs, incl. Firestore emulator and Windows.
- Mobile development CI `40167125792` at code commit `61a836201c63ebcbceb5c93971effc2795ae7a14`: **success** on install-test-build and Android APK compilation. This does not establish installed device acceptance.
- Documentation changes after validated code SHA may generate additional CI runs; verify final branch HEAD before later merge.
- No live data migration, deployment, cloud config change, checklist edit, production credential rotation, physical hardware acceptance or ownership cutover occurred.
