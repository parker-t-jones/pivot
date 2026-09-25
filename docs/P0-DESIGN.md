# P0 design — production live pipeline

**Date:** 2026-09-25. Design only. Facts are from `docs/P0-RECON.md`. This file does not change the plan, the runbook, or any code.

**Decisions this design locks**

- One Fly app (`pivot-api`). Third process group named `runner`. Not a fourth app. The lineup worker stays where it is.
- The runner is the only production writer of `games.status` and of Redis `game_state`.
- Fire time comes from resumption (release at "now", or the silence ceiling). `lagSecondsFor` is no longer added to `scheduledFireAt`.
- Fan-out is the Redis pub/sub path the API already subscribes to. Not Supabase Realtime.
- `PUSH_DRIVER` defaults to `none`.

---

## Decisions

Parker, 2026-09-25. These override the recommendations that were in §12.

1. **Push while backgrounded.** Keep the freshness check. Push must not require `active_users`. The replay test asserts a push is still sent when the user has no active socket (§9).
2. **Possession and red-zone notifications wait for resumption.** "X has the ball" can give away a turnover, so it is a REVEAL. `POSSESSION_START` and `RED_ZONE` are gated. "NUDGE = immediate" applies only to future triggers whose copy cannot reveal an outcome. Plan-edit wording is in §9.
3. **Local Redis.** Local dev never shares a Redis with production. A local runner that did would take `pivot:runner:leader`. Use Docker: `docker run -d -p 6379:6379 redis`. The runner refuses to start if the Redis host matches the production host while `NODE_ENV` is not `production`.
4. **ESPN states.** `pre` → `scheduled`. `post` or `completed` → `final`. `in` → live. Postponed, canceled, and delayed games (`status.type.name`) are never live; log them. Any other state: log it and do not start a loop.
5. **Mid-drive REVEALs.** Not in P0. `PROP_NEAR` and `SPREAD_SWING` stay in stakes Phase 3/4.
6. **P0.1 reuses R1.** R1 is `experiments/espn-live-recorder.ts` and `experiments/replay-recording.ts` (committed). P0.1 does not add a recorder. It reuses R1's recording format as the replay fixture format, plus the prefix helper. If those two files were not on the branch, P0.1 would wait.

---

## 1. Runner process

### Shape

Same image as the API and the worker (`docs/D1-DEPLOY-RUNBOOK.md` §1). New entry `services/api/src/runner.ts`, prod command `node dist/runner.js`.

```toml
[processes]
  api    = "node dist/index.js"
  worker = "node dist/worker.js"
  runner = "node dist/runner.js"
```

`[http_service]` stays `processes = ['api']`. The runner has no public port. `[[restart]] policy = 'always'` includes `runner`. After the first weekday deploy: `fly scale count runner=1`. Do not scale the runner to zero. A rolling deploy can still start the new machine before the old one exits, so scale count is not the singleton. The lock is.

Boot requires `CACHE_DRIVER=redis`. If it is `memory`, the process exits. The API and the runner are different processes; a memory store in the runner is invisible to `GET /games/live` and to the WebSocket (recon §9, runbook §1). Replay tests inject fakes and do not use this entrypoint.

**Local Redis is Docker, never the production instance.** Production Redis is the Upstash host in the Fly secrets. The repo has no variable named `REDIS_URL`. The guard reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_TCP_URL`. Before any ESPN call or `SET NX`, parse each set URL's hostname. If `NODE_ENV` is not `production` and either hostname equals `PRODUCTION_REDIS_HOST`, exit. That variable is the Upstash hostname only (no token) and is not committed. Local Redis is `docker run -d -p 6379:6379 redis`. Local API and runner both use it: `UPSTASH_REDIS_TCP_URL=redis://127.0.0.1:6379`. The leader lock, the queue, game state, and pub/sub use that TCP URL. `127.0.0.1` does not equal `PRODUCTION_REDIS_HOST`, so the process starts. A copied Fly secret does, so the process exits instead of taking `pivot:runner:leader`. Do not point `@upstash/redis` at the Docker port, and do not put the production host in local env to satisfy the REST schema.

The process owns, in one instance:

- scoreboard discovery and `games.status` writes
- one `EspnPlaySource` loop per live game
- the resumption tracker, the silence-ceiling timers, and the gated dispatcher
- `startDispatcherLoop` (500ms, existing)
- the broadcast sibling cycle (§10)

It does not sync lineups. That stays in `worker.ts`.

### Lock

Redis key `pivot:runner:leader`. Value is `{FLY_MACHINE_ID or hostname:pid}:{epoch}`.

Acquire: `INCR pivot:runner:leader:epoch`, then `SET pivot:runner:leader <value> NX EX 15`.

Renew every 5s: set the same value with `XX` and `EX 15` only if the current value is still ours. If the renew does not match, this process has lost the lock.

A process that does not hold the lock:

- does not call ESPN
- does not write `games` or Redis game/flag/queue keys
- does not run `runDispatcherTick`
- does not publish realtime messages
- sleeps 5s and tries to acquire again
- logs one standby line per attempt

When a standby acquires the lock, it runs the restart procedure below before it opens any poll loop. The previous leader, on its next renew or its next pre-tick check, sees the value is no longer its own, calls `disconnect()` on every source, aborts the dispatcher loop, and becomes a standby. Check the lock before every discovery tick and before every dispatcher tick so a stale leader stops within one tick.

TTL is 15s and the renew interval is 5s, so one missed renew does not drop the lock. Three missed renews do. That is the split-brain window (§12).

### Restart mid-game

| State | Survives in | What the new leader does |
|---|---|---|
| `game_state:{gameId}`, `user_flag_state:{userId}:{gameId}` | Redis | Keep. Do not delete. |
| `users_with_stake:*`, `user_lineup_cache:*`, `active_users` | Redis (lineup worker and the API write these) | Read only. |
| `flag_event_queue` | Redis | Drain it. Those events were already accepted. |
| `user_notifications:{userId}` | Redis | Keep, so a restart cannot burst the 3-per-60s cap. |
| `flag_events` rows | Supabase | Keep. The unique dedupe key (§5) makes a second insert a no-op. |
| `games.status` | Supabase | Trust ESPN on the next discovery tick, not the stored value. Recon UNKNOWN 2: this design does not read hosted rows to decide what is live. |
| Seen ESPN play ids | Redis set `espn_seen_plays:{espnEventId}` | Union with the ids in the first summary after acquire (below). |
| Open silence ceiling | Redis key `resumption_open:{gameId}` = `{openedAt, revealingPlayId}` | If `now - openedAt` is still under `RESUMPTION_CEILING_MS` (4 min), arm the timer for the remainder. If the deadline has passed, fire the ceiling once. |
| In-memory tracker buffer, parked events, `seenPlayIds` inside `EspnPlaySource` | Nowhere (recon §9) | Gone. Do not rebuild them by replaying plays. |

**Do not re-send pushes.**

1. On acquire, for each game ESPN currently marks live, `GET` the summary once. Add every play id in that body to `espn_seen_plays:{espnEventId}`. Do not call `onPlayEvent` for those ids. `EspnPlaySource` today emits every id not in its empty memory set (recon §2, §9). The runner passes a client that still polls, but the handler returns immediately when the id is already in the Redis set, and the source's own set is seeded from that Redis set before `subscribe`.
2. A play id is written to the Redis set **before** `onPlayEvent`. A crash after the add and before the push drops that play. A crash after the push does not send it again. Missing one play is the chosen failure. Sending it twice is not.
3. `flag_events` has a unique dedupe key (§5). `deliverFlagEvent` inserts first. A conflict removes the queue item and does not publish, push, or record a rate-limit hit.
4. The leader does not clear `flag_event_queue` on startup. An event already queued is one send, not a replay.

Plays that appear in a later poll are new and are processed. Joining a game that is already underway does not notify about drives that already happened.

---

## 2. Game discovery and status

### How games are found

Every 30s the leader calls `espnClient.getScoreboard()` (no `dates` / `week` query; that is the client that exists, recon §8). For each event, look up `games.sportradar_id = seed:espn:{event.id}` the way `liveIngestCore.resolveGame` does. No row: log and skip. Do not insert a game. The schedule seed remains the only creator of `games` rows.

The repo only special-cases `post` and `completed` today. Discovery uses this table anyway. It does not treat an unknown state as live.

| Scoreboard `status.type` | `games.status` | Play loop |
|---|---|---|
| `name` is postponed, canceled, or delayed (case-insensitive substring) | leave unchanged | do not start. Log the raw `name` and `state`. This wins over `state === 'in'`. |
| `state === 'pre'` | leave `scheduled` | do not start |
| `completed` or `state === 'post'` | `final` | `disconnect()` that game, then write `final` |
| `state === 'in'` | `in_progress` | start a loop if one is not running |
| anything else | leave unchanged | do not start. Log the raw `state` and `name`. |

Discovery is not `GET /games/live`. That route only returns rows already marked `in_progress` that also have Redis state. Using it as the runner's input would mean nothing ever goes live.

### The only production writer

The runner is the only production writer of:

- `games.status`, and only along `scheduled → in_progress → final`
- Redis `game_state:{games.id}` (the live score fields)

`scripts/fetch-nfl-schedule.ts` may still insert rows as `scheduled`. `experiments/liveIngestCore.ts` must not be run against the same Redis and database as the runner. It is not a production process.

There are no score columns on `public.games` (recon §8: `id`, `sportradar_id`, `season_year`, `week`, `scheduled_start`, team ids, `status`, `venue`). Home's score, quarter, clock, possession, down, distance, and red zone are `GameState` fields in Redis, rendered by `buildGameSummary`. Do not add score columns.

Write order when a game goes live: `HSET game_state` first, then `status = in_progress`. `GET /games/live` drops an `in_progress` row with no Redis hash, so status-first would hide the game; Redis-first while status is still `scheduled` also hides it. The game appears on the live route only when both exist. On final: write the final `GameState`, then `status = final`.

Team ids on the `PlayEvent` passed to `onPlayEvent` are `teams.id` UUIDs, not ESPN abbreviations. `gameId` is `games.id`, not the ESPN event id. The ESPN id is only the poll key and the `seed:espn:` lookup. This is the translation `liveIngestCore.translatePlay` already does. The harness skipped it by seeding stakes as abbreviations (recon §1, shim 1). Production stakes in `users_with_stake:{teamId}` are UUIDs from the lineup worker. Skipping the translation matches nobody.

Lineup-cache week is `games.week` on that row, not `play.week`. ESPN's `header.week` is phase-relative (recon, `mapEspnPlay.ts`).

### Every Home read that depends on these

**`games.status`** (via `GET /games?week=`, field `ScheduleGame.status`):

| Reader | What it does with `status` |
|---|---|
| `app/lib/homeState.ts` `nextStakeKickoff` | Skips `final` and `in_progress` when picking the countdown |
| `app/lib/homeState.ts` `findNextStakeGames` | Skips `final`. Keeps `in_progress` inside the kickoff window |
| `app/lib/homeState.ts` `upcomingStakeGameGroups` | Drops `final`. A row left at `scheduled` after kickoff still looks upcoming until the kickoff clock passes |
| `app/lib/board.ts` | Copies `status` onto the board row |
| `app/components/BoardRow.tsx` `timeColumnLabel` | `final` renders `FINAL` (no score). `in_progress` still renders the kickoff time |
| `app/components/HomePregameView.tsx` | `final` renders `FINAL` |
| `GET /games/live` (`services/api/src/routes/games.ts`) | Selects `status = in_progress'` before it will read Redis. This is the gate for every live-score read below |

**Live score fields** (Redis `game_state`, not `games` columns), through `GET /games/live` and through `buildGameSummary` on `/flags/current` and the `flag_event` payload:

| Field | Home use |
|---|---|
| `score`, `quarter`, `time_remaining_sec` | `LiveGame` on the live route; `GameSummary` on the flag (`NowActiveCard` reads `flag.game`) |
| `possession_team` | `HomeLiveIdleCard`, `NowActiveCard` / `fieldAlignedMatchup`, flag `new_state.possession_team` |
| `yards_to_endzone`, `down`, `distance`, `in_red_zone` | `LiveGame` and `GameSummary` (field gauge on `NowActiveCard`) |
| Presence of a `LiveGame` whose teams are on the user's stake list | `filterLiveStakeGames` → `resolveHomeBranch` `hasLiveStakeGames` (State 2 vs pregame) |

`loadHome` (`app/app/(app)/(tabs)/index.tsx`) fetches `/flags/current`, `/games/live`, and `/games?week=` together, and repeats that every 30s while the display phase is live. That poll is how Home sees status and scores today. §6 is what removes the wait.

---

## 3. Per-game loops

One `EspnPlaySource` per ESPN event id that discovery has marked live. Start them with `Promise.all` of per-game tasks, same reason as the harness: `subscribe()` does not return until the game is final or `disconnect()` is observed.

**Poll interval:** 5000ms. That is the class default and the harness default. Do not change it in P0.

**Fetch timeout (recon UNKNOWN 1).** `fetch` is called with no `AbortSignal` and no timeout, and the repo does not say what Node does if ESPN never completes. Do not probe the runtime default. Pass an `AbortSignal` that aborts at **8s**. An abort is a `network_error`: the existing retry branch already sleeps and continues. 8s is long enough for the harness's observed summaries (p50 around 120ms) and short enough that one hung game cannot sit for minutes inside its own loop.

**Backoff.** Per game, not global. After a failed poll (`network_error`, `http_error`, `invalid_shape`, missing teams, or the new abort): wait `min(60s, 5s * 2^failures)` before the next poll. A success resets that game's failure count. Shape reports stay on the existing 5-minute Sentry throttle.

**Isolation.** Each game's task has its own `catch`. A throw restarts that game's loop after its backoff. It does not reject the supervisor, and it does not call `disconnect()` on any other source. The handler `await` stays inside that game's `subscribe`, so a slow game delays only its own next poll. The supervisor does not take a lock around games.

`disconnect()` still cannot cancel an in-flight `fetch` until the timeout or the response (recon §2). The 8s abort is what bounds that.

---

## 4. Resumption timing

Promote these two types out of `experiments/` into `services/`, with the tests that do not exist today (recon §11: `experiments/` is outside Vitest):

| From | To |
|---|---|
| `IncrementalResumptionTracker` | `services/engine` (it calls `watchForResumption` and only adds the buffer plus the timer hook) |
| `ResumptionGatedDispatcher` | `services/dispatcher` (it implements the existing `EventDispatcher` interface) |

`QueueingEventDispatcher.dispatch` stops computing `clock() + lagSecondsFor(...) * 1000`. The gated dispatcher is what `onPlayEvent` is given. On release it sets `scheduledFireAt` to the runner clock's `now`, which is what the harness does. The 500ms dispatcher tick is unchanged.

**Silence ceiling.** `watchForResumption` stays a pure function. Its `CEILING_FALLBACK` still runs only when a later play is already in the array (recon §4). The runner owns the wall clock:

- When the tracker opens a window, the runner writes `resumption_open:{gameId}` and starts a timer for `RESUMPTION_CEILING_MS` (4 minutes) measured from `revealingPlay.observedAt`, matching the harness timer.
- If a play resolves the window first, clear the timer and the Redis key.
- If the timer fires first, resolve `CEILING_FALLBACK` with `resolvedBy: 'wall_clock_timer'`, release parked events, enqueue with `scheduledFireAt = now`, delete the Redis key.
- Restart re-arms from that key (§1).

**What the lag table is for after this.** `BROADCAST_LAG_SECONDS` / `lagSecondsFor` stay as the sort key inside `pickBroadcastSource` and `rankBroadcasts` (lowest lag, then service name). That is the ranking tiebreak in `docs/B1-BROADCAST-DESIGN.md` §3.7. It is not a fire-time input. The deep link still comes from the broadcast catalog (`resolveActionRecommendation`). It is no longer required to be "the source we waited for," because we no longer wait a per-service number of seconds.

`POSSESSION_START` and `RED_ZONE` wait for resumption. "X has the ball" can give away a turnover, so both are REVEALs, not immediate nudges. Today's `flag_added` / `flag_removed` / `priority_increased` / `priority_decreased` events all go through this gate. "NUDGE = immediate" applies only to a future trigger whose copy cannot reveal an outcome. P0 does not add those triggers, and it does not add mid-drive REVEALs (`PROP_NEAR`, `SPREAD_SWING`).

---

## 5. Flags

### Insert

Nothing inserts `flag_events` today (recon §6). `deliverFlagEvent` already calls `FlagEventPersistence.persistFlagEvent` and then publishes. Add a Supabase implementation used only by the runner, with the service role.

The table's `id` is a `uuid`. The engine's `FlagEvent.id` is a SHA-1 hex of `userId:gameId:type:computedAt`. That hex is not a uuid, and `computedAt` changes on every compute, so it is not a stable dedupe key. Do not write it into `id`.

| Column | Value |
|---|---|
| `id` | `gen_random_uuid()` |
| `user_id` | the user |
| `game_id` | `games.id` |
| `event_type` | `flag_added` / `flag_removed` / `priority_increased` / `priority_decreased` |
| `triggering_play_id` | ESPN play id of the play that produced the event. `FlagEvent` does not carry it today; the handler passes it into dispatch. It is nullable in the table and must be set for live events. |
| `priority_score` | `newState.priorityScore` |
| `reasons` | `newState.reasons` as jsonb |
| `fired_at` | `scheduledFireAt` (already what `deliverFlagEvent` passes as `firedAt`) |
| `delivered_at` | clock at insert |
| `user_action` | null until `POST /flags/:event_id/action` |

Unique index on `(user_id, game_id, event_type, triggering_play_id)`. Insert conflict: treat as already delivered (§1).

The WebSocket and push `event_id` must be the row's uuid. `POST /flags/:event_id/action` validates a uuid and updates that row. Persist first, put the returned uuid on the envelope, then publish and push.

### Clear

A live flag clears when `diffFlagStates` emits `flag_removed` (possession leaves the staked team, or `computeFlagState` returns unflagged because status is not `in_progress` or possession is null). Home already applies that with `applyFlagEventToHome`. `GET /flags/current` recomputes and omits unflagged games; it does not read the table.

Rows are not deleted. `user_action` is set only by the existing POST. There is no "clear the row" step.

---

## 6. Realtime to the app

**Mechanism: Redis pub/sub.** The API already `PSUBSCRIBE`s `realtime:user:*` and `realtime:game:*` and relays to local sockets (`services/api/src/routes/realtime.ts`). `RedisRealtimeBus.publish` is `PUBLISH` on the REST client. The runner uses that bus. It does not construct `InMemoryRealtimeBus` (that object is why the harness never reaches Home, recon §1).

Supabase Realtime is the wrong bus. Scores are not Postgres columns, the phone already speaks `GET /v1/realtime`, and a second client connection would not see Redis.

**Flags.** Unchanged envelope from `deliverFlagEvent`, published to `realtime:user:{userId}`. Home already handles `type: 'flag_event'` and patches the hero without `loadHome`. Once the runner and the API share Redis, that path works. No new flag message type.

**Live game state.** Nothing publishes on `realtime:game:{id}` today, and Home does not send `subscribe_game`. After each applied play the runner publishes one message on `realtime:game:{games.id}`:

- `type: 'game_state'`
- `payload`: the same object `GET /games/live` returns for one game (`LiveGame`)

Home, after `loadHome`, sends `subscribe_game` for each stake game on the week slate (the client message type already exists). On `game_state`, replace that game in `liveStakeGames` and recompute the branch. On `flag_event`, keep the current `applyFlagEventToHome` path.

The 30s `loadHome` stays as the reconcile for a missed message. It is no longer the only way the hero and the live list move.

---

## 7. Per-game collapse

Placed **before** `shouldRateLimit`. The limiter stays `user_notifications:{userId}`, 3 per 60s, user only. Do not add `gameId` to that key.

**Window.** One reveal window per game:

- Events for that game dispatched while the resumption window is open (the parked list), and
- Events dispatched during the single `onPlayEvent` that resolves the window (the common ESPN case, where the window opens and closes on the same play)

Group by `userId`. Emit one event per user.

**Copy.** The winner is the highest `newState.priorityScore`. Tie: prefer `newState.flagged === true`. Tie again: the later `computedAt`. `notificationTitle` / `notificationBody` run on the winner only. That is the stand-in for the plan's "highest-leverage trigger" until stake triggers exist. Do not invent `Trigger.leverage` in P0.

Losers are not inserted, not published, not pushed, and not recorded against the rate limit. Today's engine emits at most one event per user per play, so the winner is that event. The step exists so a later stake that emits two triggers in one window cannot send two notifications.

The collapsed event is what `runDispatcherTick` rate-limits, unchanged.

---

## 8. Push

Add to `services/api/src/env.ts` (recon UNKNOWN 5: nothing reads `process.env.PUSH_DRIVER` today):

| Variable | Schema | Default |
|---|---|---|
| `PUSH_DRIVER` | `'expo' \| 'none'` | `'none'` |
| `EXPO_ACCESS_TOKEN` | optional string | unset |

The runner calls `createPushNotifier({ pushDriver, expoAccessToken })`. `expo` is `ExpoPushNotifier`. `none` is `NoOpPushNotifier` (log, no network, `{ success: true }`). First deploy stays on `none` until Parker sets the Fly secret. State and WebSocket updates do not wait on that secret.

**Dedupe keys**, in order:

1. `espn_seen_plays:{espnEventId}` — the play is processed once (§1).
2. Collapse — one event per `(userId, gameId)` per reveal window (§7).
3. `flag_events` unique `(user_id, game_id, event_type, triggering_play_id)` — a second deliver does not push (§5).
4. `user_notifications:{userId}` — the existing 3-per-60s cap, after collapse.

Push is skipped when the token is null, same as today. Push does **not** require `active_users`. A user with no socket still receives the push. The freshness half of `isStillRelevant` still applies: a queued event whose stored flag state no longer matches is dropped. The replay test in §9 covers the no-socket case.

---

## 9. Replay testing

`events-*.jsonl` lines are harness decisions (`kind: "push"` and similar), not ESPN bodies (recon §10). They cannot feed `EspnPlaySource`. Do not treat them as fixtures. Do not add a second recorder.

### Recording format (R1)

R1 is already committed: `experiments/espn-live-recorder.ts` writes the bytes, `experiments/replay-recording.ts` reads them offline. Layout, under gitignored `experiments/logs/`:

- `recordings/<YYYY-MM-DD>/<eventId>/<receivedAtISO>.json.gz` — one raw ESPN body per poll
- `recordings/<YYYY-MM-DD>/index.jsonl`
- `recordings/status.json`

`replay-recording.ts` sorts the `.json.gz` names in one game directory, gunzips each, and points global `fetch` at those bytes so `espnClient.getSummary` parses them. P0 reuses that layout. It does not invent a JSON-array fixture.

### Fixture format

A committed fixture is one game directory of `<receivedAtISO>.json.gz` files, same bytes R1 writes: raw summary bodies in poll order, not `PlayEvent`s and not harness `kind` lines. A fake `fetch` gunzips them in filename order, returns each body once, then repeats the last body. The real zod parse and the real `EspnPlaySource` / `onPlayEvent` / gated dispatcher run. No network in the test.

The prefix helper is pure and is the only new piece. Given one summary body, it returns N bodies whose play lists are prefixes (first play, first two plays, …) and writes them as timestamp-ordered `.json.gz` files in the R1 shape. That is how one captured summary becomes an ordered poll without a live slate. A full R1 directory can be trimmed to the same shape. The helper does not run in production.

### Where trimmed fixtures live

`services/ingestion/fixtures/replays/<eventId>/`. Vitest includes `services/*/src/**/*.test.ts`, and this path is not gitignored. Commit one trimmed directory: a single game, on the order of a short drive (timeout plus the next snap, and one possession change). Not a full Sunday. Full recordings stay in `experiments/logs/recordings/`.

### End-to-end test

`services/api/src/runner.replay.test.ts` (or the dispatcher package if the runner entry would pull Fastify into the unit test — the test imports the pipeline functions, not `runner.ts`'s Redis lock). Fake fetch, in-memory stores, `PUSH_DRIVER` forced to a capturing notifier.

Expect:

- Plays come out in order, one new id per prefix step.
- A second pass over the same bodies emits nothing new.
- `scheduledFireAt` equals the clock at resumption release, not `clock + 75_000` (`sunday_ticket`) and not `clock + 60_000`.
- The capturing notifier sees one push per user per window, not one per prefix.
- The user is absent from `active_users` (no socket). The notifier still receives that push. A second run where the stored flag state no longer matches the event sends nothing (freshness still drops it).
- A `flag_events` fake records `triggering_play_id` and a uuid `id`.

### Plan wording that assumes `events-*.jsonl` is replayable

Do not edit `PIVOT-STAKES-PLAN.md` in this pass. Replace these five places when that plan is next touched.

**1. Repo facts, line 23.** Today: captured fixtures are `experiments/logs/events-<ISO>.jsonl` (and `markers-*.jsonl`); older `plays-<date>.jsonl` names mean those files; replayability is unverified.

Proposed: Captured ESPN fixtures are R1 recordings: gzipped raw summary bodies in `experiments/logs/recordings/<date>/<eventId>/`, written by `experiments/espn-live-recorder.ts` and read by `experiments/replay-recording.ts`. Trimmed copies of that layout live in `services/ingestion/fixtures/replays/`. `experiments/logs/events-*.jsonl` and `markers-*.jsonl` are harness decision logs and human keypresses. They are not replay input. `plays-*.jsonl` is a third log, also not replay input.

**2. Phase 1 verify, lines 245–246.** Today: replay `experiments/logs/events-<ISO>.jsonl` through the old path to `baseline-notifications.json`, then through the stakes path, and expect zero diff.

Proposed: Replay `services/ingestion/fixtures/replays/<eventId>/` (R1 layout, fake fetch, capturing notifier) through the P0 pipeline and save the notifier output as `baseline-notifications.json`. After the stakes change, replay the same directory. Diff. Expect zero differences.

**3. U4 verify, §11.5 step 4, line 532.** Today: replay `events-<ISO>.jsonl` through the local pipeline so a flag fires, and Home should switch to LIVE without a manual refresh.

Proposed: Run the local runner against `services/ingestion/fixtures/replays/<eventId>/` (R1 layout, fake fetch, `PUSH_DRIVER=none`, local Docker Redis shared with the local API). Home, already open on the live display phase, should switch to LIVE on the `flag_event` socket message with no pull-to-refresh. The hero is `NowActiveCard`. When the fixture emits `flag_removed`, the hero returns to the featured card.

**4. U6 demo, §12.2, line 569.** Today: take one drive from `events-<ISO>.jsonl`, confirm it contains plays, compress to ~90s, bundle `app/assets/demo/demo-game.json`.

Proposed: Take one trimmed R1 directory from `services/ingestion/fixtures/replays/`, strip it to a short drive sequence, and bundle that as `app/assets/demo/demo-game.json`. The demo player walks those summary prefixes on a timer inside the app. It does not read `events-*.jsonl`. The rest of the demo rules (local notification, `DEMO` banner, no writes to `stakes` or `lineup_slots`) stay.

`§12.2`'s heading "Tutorial (replayable from Settings)" does not refer to these files. Leave it.

**5. Rules, §3 (nudge vs reveal), lines 43 and 148–149.** Today: `POSSESSION_START` and `RED_ZONE` are `NUDGE` ("Existing behavior", "Existing `FieldGauge` red-zone detection"), and "NUDGEs can fire immediately."

Proposed: §3 reclassifies `POSSESSION_START` and `RED_ZONE` as gated REVEALs. "NUDGE = immediate" applies only to future triggers whose copy cannot reveal an outcome. "X has the ball" can give away a turnover, so it waits for resumption. Do not edit the plan in this pass.

---

## 10. Broadcast cycle slot

B1.6 is the ingest function (scoreboard → map → upsert `game_airings`). It is not in the repo yet. B1.7 is "call that function from the P0 runner." This design is the slot, not the ingest.

On the leader only, a sibling `setInterval` next to the play loops. It does not run inside `EspnPlaySource.subscribe()`.

| When | Interval |
|---|---|
| NFL display phase `off` or `pre`, and Tue–Wed in season | 24h |
| Thu–Mon in season | 15 min |
| First acquire of the lock each process life | run once immediately |

The function is `runBroadcastIngest({ source: 'espn_scoreboard' })`, owned by B1.6. Until that function exists, the interval is not registered. P0 play loops do not wait for it. Cadence is an argument, not a Fly cron, and not a fourth process.

No production deploy on Thu/Sun/Mon. The cycle may **run** on those days after a Tue–Wed deploy. The first hosted `game_airings` write is still a Tuesday or Wednesday, per B1 §3.6.

---

## 11. Phasing

Each slice is one or two commits, sized for Auto. Baseline is always `pnpm test` at the repo root (record the pass count). Do not use `pnpm --filter app test`. No production deploy on Thu/Sun/Mon. `fly deploy` is Parker's, on a Tue–Wed, and only for slices marked hosted.

| Slice | Change | Verify | Parker | Before hosted deploy | Live game |
|---|---|---|---|---|---|
| **P0.1** | Reuse R1 (`experiments/espn-live-recorder.ts`, `experiments/replay-recording.ts`). No second recorder. Add the prefix helper that writes R1's `<receivedAtISO>.json.gz` layout. R1 is committed, so this slice does not wait. If those files were absent, stop. | Helper test: one summary becomes 3 gzipped bodies, play counts 1, 2, 3, filenames sort in poll order. `pnpm test` grows only by that helper test under `services/ingestion`. Do not re-run the recorder. | None | Yes | No |
| **P0.2** | AbortSignal 8s on ESPN `fetch`. Per-game backoff. Tests on the fake client. | Existing `espnPlaySource` tests still pass. New test: a fetch that never resolves is aborted and the next poll runs. New test: one game's failures do not increment the other game's backoff. | None | Yes | No |
| **P0.3** | Move the tracker and the gated dispatcher into `services/`. Tests for same-play resolve, parked release, and abort. | `pnpm test` green. A test feeds timeout-then-snap and expects one `REAL_ACTION` on that call. A test that never sends another play does not see `CEILING_FALLBACK` from the pure function. | None | Yes | No |
| **P0.4** | Runner-owned ceiling timer. `scheduleFlagEvent` stops adding lag. Lag tests for ranking stay. | Test with fake timers: no play for 4 min → one enqueue with `scheduledFireAt === now`. Test: `sunday_ticket` user does not get `+75s`. `broadcastLag` tests still expect 75/60/8. | None | Yes | No |
| **P0.5** | Redis seen-set seed + leader lock, fakes only. | Test: second `SET NX` fails; standby does not call the poll stub. Test: first summary's ids are skipped; a later id is handled once. Test: lost lock stops the loop. | None | Yes | No |
| **P0.6** | `flag_events` insert + unique index + uuid on the envelope. | Migration applies on local Supabase. Replay one fixture play: one row, `id` is a uuid, `triggering_play_id` set. Second deliver of the same key inserts nothing and does not call the notifier. | In local Studio, the row's `id` matches what the test printed. | Yes | No |
| **P0.7** | Collapse before `shouldRateLimit`. | Test: two events, same user and game, one window → one enqueue. The higher `priorityScore` is the one enqueued. A third event for another game is not merged. Rate-limit test "4th in 60s drops" still passes and still keys only `userId`. | None | Yes | No |
| **P0.8** | `PUSH_DRIVER` and `EXPO_ACCESS_TOKEN` on the env schema. Default `none`. | Boot with the variable unset → `none`. `expo` without a token still constructs `ExpoPushNotifier`. `pnpm test`. | None | Yes | No |
| **P0.9** | Runner entry: discovery, status writes, UUID translation, concurrent sources, Redis `game_state`, dispatcher, Redis pub/sub. Commit the trimmed R1-layout fixture. End-to-end test from §9, including the no-socket push. | `pnpm test` includes the replay test and it passes offline. The no-socket case still records one push. Local: API + runner, `CACHE_DRIVER=redis`, Docker Redis on `127.0.0.1:6379`, `PUSH_DRIVER=none`, fixture feed. A Redis URL whose host equals `PRODUCTION_REDIS_HOST` with `NODE_ENV` unset exits before `SET NX`. `GET /games/live` shows the fixture game only after status flips. A socket on `/v1/realtime` receives `flag_event`. | Local API + runner against Docker Redis, not Upstash. Home on the simulator, live display phase, no pull-to-refresh: hero moves when the fixture emits a flag. | Yes | No |
| **P0.10** | Home `subscribe_game` + `game_state` patch. | Client test: a `game_state` message updates `liveStakeGames`. Simulator against P0.9: the live list's score changes without the 30s reload. | Same simulator session. Background the app, foreground, hero matches `/flags/current` after reconcile. | Yes | No |
| **P0.11** | `fly.toml` process group `runner`, restart always, no HTTP. No `fly deploy` in this slice. | `fly config validate` if the CLI is present. Diff is `runner` only plus the restart list. `pnpm test` unchanged. | Deploy Tue or Wed only. `fly scale count runner=1`. `fly logs -a pivot-api --process runner` shows standby or leader, not a crash loop. Leave `PUSH_DRIVER` unset. | The toml lands anytime. The deploy does not. | No |
| **P0.12** | Weekday live check. No code if P0.9–P0.11 held. | Against a real slate, runner leader, `PUSH_DRIVER=none`. `games.status` moves. Redis `game_state` updates. Home live list moves. No duplicate push in logs because push is off. Postponed, canceled, delayed, and unknown states are logged and do not start a loop. | Watch one game with the app backgrounded. After the no-push check, set `PUSH_DRIVER=expo`. Confirm one notification with no socket, not a burst, and not a spoiler during a timeout. | Deploy already done | **Yes.** Thu/Sun/Mon are for watching, not for deploying. |
| **P0.13** | B1.7 hook. Only after B1.6's function exists. | Leader logs one broadcast cycle. Local DB: `game_airings.source = 'espn_scoreboard'` matches a fresh scoreboard file. | Tue or Wed hosted cycle, same check on the hosted DB. | Hook code yes. Hosted write no, until Tue–Wed. | No |

P0.12 is the device gate the stakes plan means by "verified on device." Stakes Phases 1–5 and U4/U6 stay blocked until that slice is done.

---

## 12. Risks and open questions

### Risks

| Risk | Why | Mitigation in this design |
|---|---|---|
| Two leaders | A renew gap longer than 15s, or a Fly overlap, can let the old process poll until its next lock check | Lock check before discovery and before every dispatcher tick. Seen-set plus the unique `flag_events` key if both do process one play. |
| Missed play at startup | Ids in the first summary are marked seen and not notified | Chosen. A replay would re-send the backlog (recon §9). |
| ESPN rate or shape change | Undocumented API. A bad game used to be able to spin at 5s forever | Per-game backoff, 8s abort, shape reports throttled. Other games keep polling. |
| Ceiling fires during a long dead ball | 4 minutes of silence sends the notification even if the broadcast has not shown the next snap | Same constant the engine already has. It is the bound on "never notify," not a claim that 4 minutes matches every broadcast. |
| `PUSH_DRIVER=expo` on the first deploy | Would push to real tokens on a day the pipeline is unproven | Default `none`. Parker turns it on after P0.12's no-push check. |
| Experiments ingest left running | `liveIngestCore` writes the same `game_state` key | Production runner is the only writer. Do not start that script against the hosted Redis. |
| Board still has no live score | `BoardRow` renders kickoff time for `in_progress` on purpose ("LIVE BRANCH (U4)") | P0 does not change that. U4 does. |

### Open questions

None. The five questions from the first draft, plus the recorder slice, are the Decisions section at the top.
