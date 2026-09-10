# Release readiness work log

## Objective (unchanged)

Bring the existing game to launch quality across all eight criteria in the user's
reference: performance, security, usability, accessibility, maintainability,
observability, compatibility, and failure recovery. Passing a narrow test suite
is not proof that the full objective is complete. No deployment is authorized here.

## Acceptance matrix

| Area | Evidence required before release | Current gaps / next gates |
|---|---|---|
| Performance | Six-client gameplay/load report, frame-time and memory soak, compressed/cached asset transfer, stable server tick under abuse | Compression/ETag response tests pass; target-device frame/memory soak and six-client workload still unmeasured |
| Security | Malformed HTTP/socket regression tests; finite/index/phase/authority checks; origin/message/rate limits; no data exposure; dependency audit | HTTP/protocol guards, one-room membership, unlock checks and per-connection budgets tested; distance/speed authority and aggregate reconnect abuse remain |
| Usability | Join/start/cook/serve/results/restart journeys; clear loading/errors; no duplicate submissions; understandable controls and instructions | Two-browser join/start/recovery/P journeys verified; full cook/serve/results loop and onboarding playtest pending |
| Accessibility | Keyboard/focus audit, labels/status announcements, contrast, non-colour cues, reduced motion and configurable controls | Customizer has labels; game-wide audit, reduced motion and alternatives still pending |
| Maintainability | Reproducible clean install/build/tests; protocol and game rule boundaries; CI; accurate docs and asset generation contracts | Protocol/storage suites and real-Redis CI gate added; clean install, full docs audit and remote CI evidence pending |
| Observability | Live/readiness health, bounded privacy-safe failure counters/logs, persistence failures visible, operational troubleshooting | Runtime storage health, rejection/recovery counters and runbook added; deployment alerting and operational drills still unverified |
| Compatibility | Chrome/Edge/Firefox/WebKit desktop evidence, responsive UI, WebGL failure/recovery path; explicit touch/input support scope | Only Chrome visual checks; WebGL/context-loss and other browser checks pending |
| Failure recovery | Transient connection loss restores same room/hand/pose; failed recovery returns to usable join UI; host transfer; durable ranking retries; graceful restart/rollback drill | Browser recovery and actual-process ranking crash/replay tests pass; active-match restart, ephemeral disk replacement and deployment rollback remain open |

## Baseline inspected (2026-09-07)

- Current dirty worktree contains prior kitchen/storefront/pause and clay-character work; preserved.
- `npm test`: 265 character/game rule checks passed in the preceding character pass.
- Character visual harness: 162 clothing combinations, two-client appearance sync,
  saved looks and 375/768px overflow checks. This is NOT full game/browser coverage.
- CI currently runs `npm test` on Node 20/Ubuntu before its existing deploy job.
- Server and leaderboard inspected locally; public hosting/CI state has not been verified.
- Prior goal turn classification: progress (generated assets, integrated customization,
  ran runtime tests). This turn starts the eight-area release audit.

## Work sequence

1. Guard HTTP/socket boundaries, room lifecycle, ingredient unlocks; add actual
   HTTP and Socket.IO integration tests running on isolated temporary servers.
2. Make transient disconnects recoverable, reject stale offline commands, expose
   connection status, test host recovery/expiry and clean failure fallback.
3. Harden ranking persistence and operational health, then shutdown/restart drills.
4. Profile six-client load, asset/render memory, and full cooking/serving loops.
5. Improve onboarding, accessibility/settings and compatibility; test supported browsers.
6. Review licenses/distribution contents, documentation, CI, deployment and rollback;
   rerun the full matrix. External deployment and unavailable-device evidence remain explicit.

The goal stays active until each row has direct evidence. Record partial progress
and remaining requirements here instead of redefining release readiness.

## Verified progress (2026-09-08)

Previous goal turn classification: **progress**. It changed protocol/recovery code
and produced successful actual HTTP/Socket.IO and two-browser evidence. This turn
also advances ranking durability; there is no repeated blocking condition.

- 265 smoke checks plus 24 Node test cases passed in `npm test`: 7 protocol,
  8 actual server integration and 9 storage fault/retry tests.
- `npm run test:redis`: 5 tests passed against an owned Redis 7.2 container:
  concurrent writers, idempotency/top-200 ordering, corrupt-data preservation,
  fresh-cache reload, and hard-kill/restart of an actual child process with a
  pending outbox. Temporary test container/keys are cleaned up afterward.
- Local Chrome browser QA passed: two-client UI join/start, distinct spawns,
  host-only P pause/resume, brief interruption preserving identity/hand/pose,
  blocked offline writes, recovery expiry/host transfer and usable join fallback.
  Join screens at 375/768/1440px had no horizontal overflow and no unexpected
  HTTP or browser/CSP errors. The expanded run also passed Tab navigation, removal
  of an expired session's pause overlay and a real new-room button click afterward.
  An earlier expanded run exposed slow loss detection; 5s ping / 5s timeout was
  added and the same journey passed afterward (not treated as a silent pass).
- Added clear connection/ranking-save status, host-disconnect label, normal Tab
  navigation and clearing held keys on focus/pointer-lock loss.
- Readiness now uses live storage state; atomic file writes, serial/idempotent
  Redis merging, bounded retries, pending outbox and shutdown flush implemented.
- Deployment/operational limits are explicit in `docs/OPERATIONS.md`.
- Final rerun: `npm test` passed (265 smoke + 24 protocol/storage/server cases),
  real Redis suite passed (5 cases), and the expanded Chrome journey passed.
  `npm audit --omit=dev --json` reported zero known production dependency
  vulnerabilities; this is not proof that application security is complete.
- Local server restarted only after port 3211 and the old process were confirmed
  absent. New PID 29968 served `/health` and `/ready` successfully and loaded all
  28 existing local ranking records with no pending/error state. No push or
  external deployment was performed.

No claim of overall launch readiness: complete cooking UI journeys, server movement
and proximity authority, six-player sustained performance, accessibility/settings,
browser/device coverage, active-match crash recovery, asset distribution licenses,
supported Node runtime and remote CI/deploy/rollback evidence are still required.

## 2026-09-10 리팩토링 후 재검증

- `npm test`: smoke 265개와 Node 58개 모두 통과.
- 실제 Redis 7.2/Lua 5개, Chrome 2클라이언트 6개 여정 모두 통과.
- 캐릭터를 현재 생성 규격으로 다시 만들고 162개 조합과 인게임 동기화를 통과.
- 운영 의존성 audit 결과 알려진 취약점 0건. 원격 CI/배포 결과는 푸시 후 별도 확인 대상이다.
