# Local verification and recovery

This is an implementation runbook, not confirmation that the public deployment
has passed release verification. Do not deploy or change production data merely
to run these tests.

## Reproducible checks

```text
npm ci
npm test
npm run test:redis
node tools/release-browser-qa.cjs
```

- `npm test`: game/asset smoke checks plus isolated HTTP, Socket.IO and storage tests.
- `test:redis`: actual Redis 7.2 Lua/REST tests. Uses a dedicated local Docker container,
  or an explicitly supplied `REDIS_TEST_PORT` on loopback. Only UUID-scoped test keys
  are removed. The CI service is separate from the deployment Redis instance.
- Browser QA requires Chrome and Playwright. Set `PLAYWRIGHT_PATH` to the installed
  package if the development workstation's bundled runtime path is unavailable.
  It owns an ephemeral game server and temporary leaderboard. Screenshots/report go
  to `artifacts/release-qa`. No committed visual baseline exists yet.
- Tests do not read `UPSTASH_REDIS_REST_*` from the live environment. Never point a
  test fixture at production.

## Health and storage

- `GET /health`: HTTP 200 liveness/diagnostics. The JSON `ok` and `storage.ready`
  reflect **current**, not just startup, storage health. `storage.error` is a bounded
  code with no credentials or remote response body. `failures`, `pending`,
  `lastReadAt`, `lastWriteAt`, room/player counts and event-loop lag aid diagnosis.
- `GET /ready`: 200 when storage has loaded without a current error; 503 otherwise
  or during shutdown. Check this separately before accepting a release.
- Render's existing `/health` probe is deliberately unchanged in this batch.
  A storage outage should be investigated, not blindly treated as evidence that
  restarting all active games will repair the database.
- File mode stores a bounded top 200 in `data/leaderboard.json` by default. It is a
  **single-process local store**. Writes use a scratch file, fsync, then rename.
- Redis mode requires both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
  Existing string-key format is retained; an atomic Lua merge prevents concurrent
  writers replacing each other's runs. `GIMBAP_LEADERBOARD_KEY` is unchanged.
- Historical rankings intentionally have no TTL: these are durable records, not
  expiring cache entries. One key capped at 200 records bounds growth.
- Failed writes retry with backoff (up to 30 seconds between attempts); each REST
  request has a three-second abort timeout. Stable UUIDs prevent duplicate runs
  if a server committed a write but the reply was lost.
- Redis-mode pending runs are written to `<leaderboard-file>.pending.json` before
  transmission. A restart on the **same durable disk** replays them idempotently.
  A result screen distinguishes provisional rankings from completed storage.
  Each server instance needs its own outbox file/directory; do not share one local
  file among multiple Node workers. Atomic Redis merging does not make local
  journal files or in-memory game rooms a clustered game-server implementation.
- Never replace an unreadable/corrupt file or Redis value with an empty list.
  Preserve a backup, inspect/repair the exact value offline, then let retries reload.
  The implementation leaves the unreadable original untouched.

## Connection and shutdown behavior

- One socket belongs to at most one room; max six players per room.
- Brief transport loss reserves the same identity, hand and pose for 30 seconds.
  Heartbeats run every five seconds with a five-second timeout. Reservation time
  starts after server-side loss detection, not at the moment Wi-Fi drops.
  `GIMBAP_RECOVERY_MS` can configure 1–60 seconds. Offline gameplay commands are
  rejected, not queued to replay later.
- If the host disconnects while running, the room pauses. A timely recovered host
  resumes an automatic pause; a manually paused game remains paused.
- At expiry the reservation is removed. An available connected player becomes
  host and can press P to resume. A client that cannot recover returns to join UI.
- SIGINT/SIGTERM stops tick loops, notifies clients, closes sockets and waits for
  the ranking flush, bounded by five seconds. An incomplete flush exits nonzero.
  Verify platform process-manager signal behavior before deployment.

## Explicit limits / release gates still open

- Socket recovery covers a temporary connection loss in the same live page; a full
  browser refresh or game-server replacement does **not** restore an active room.
- Active rooms, simulation timers and hands are still in memory. Process-restart
  recovery of an ongoing match remains to be implemented and exercised.
- A pending outbox on ephemeral hosting cannot survive disk replacement/redeploy.
  Durable storage/hosting policy and a deployment outage drill are still required.
- File fsync/rename tests and the crash/restart test are not a physical power-loss
  test; disk/controller guarantees and backup restoration remain operational work.
- The Redis tests use real local Redis behind an isolated REST adapter, not the
  live Upstash service. Validate provider permissions, limits, persistence and a
  non-production deployment with the actual configuration before launch.
- CI configuration now gates deployment on both test jobs; no remote CI/deploy
  run has been triggered or verified by this work.

Protocol references consulted: [Socket.IO recovery](https://socket.io/docs/v4/connection-state-recovery/),
[Upstash REST](https://upstash.com/docs/redis/features/restapi),
[Redis atomic Lua execution](https://redis.io/docs/latest/develop/programmability/eval-intro/).
