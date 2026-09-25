# P0 recon — live pipeline as it exists

**Date:** 2026-09-25. Read-only. This file records what the code does. It does not propose a runner, a scheduler, or a collapse design.

**Scope read first:** `PIVOT-STAKES-PLAN.md` §0.1 and §3 Rules, `docs/D1-DEPLOY-RUNBOOK.md` §1, `docs/STAKES-PLAN-RECON.md` §2(g).

**Claim that holds:** there is no production process whose job is live ESPN ingestion. `services/api/src/worker.ts` only syncs lineups (`POLL_INTERVAL_MS = 5 * 60 * 1000` at `worker.ts:6`, `runWorkerCycle` at `worker.ts:21`). The only path that goes from an ESPN poll to `ExpoPushNotifier.sendPush` is `experiments/live-sunday-harness.ts`. Two sibling scripts poll ESPN and write `GameState` only; they do not call `onPlayEvent` or send push (`experiments/liveIngestCore.ts:105-128`, started from `experiments/live-ingest-service.ts:72` and `experiments/dev-server-with-live-ingest.ts`).

Line numbers are from the working tree on this date.

---

## 1. Harness flow

`main` (`live-sunday-harness.ts:925-932`) parses argv and either prints the scoreboard (`runList`, `:559-568`) or calls `runHarness` (`:570`).

| Step | Function | File | Kind |
|---|---|---|---|
| 1 | `parseArgs` | `experiments/live-sunday-harness.ts:210-238` | harness |
| 2 | `fetchScoreboard` → `espnClient.getScoreboard` | harness `:417-430`; client `services/ingestion/src/espn/espnClient.ts:82-83` | harness calls production client |
| 3 | `resolveContexts` → `espnClient.getSummary` + `resolveGameContext` | harness `:434-449`; `mapEspnPlay.ts:70-82` | harness calls production |
| 4 | Seed in-memory catalogs, stakes, users, `FixedLineupCache` | harness `:603-675`, helpers `:464-548` | harness |
| 5 | `startDispatcherLoop` → `runDispatcherTick` every 500ms | `services/dispatcher/src/dispatcher.ts:107-115`, interval `:11` | production, invoked only from the harness (and tests) |
| 6 | One `EspnPlaySource` per game, `Promise.all` of `subscribe` | harness `:836-909`; class `services/ingestion/src/espn/espnPlaySource.ts:64` | production class, harness concurrency |
| 7 | `getSummary` → `flattenPlays` → `mapEspnPlay` → `await handler` | `espnPlaySource.ts:84-134`; `mapEspnPlay.ts:94-121` | production |
| 8 | Handler: log play, `gate.beginPlay`, `tracker.observe`, `onPlayEvent` | harness `:775-816` | harness order; `onPlayEvent` is production |
| 9 | `IncrementalResumptionTracker.observe` → `watchForResumption` | `experiments/incrementalResumption.ts:111-167`; `services/engine/src/resumptionWatcher.ts:73` | harness tracker, production function |
| 10 | `onPlayEvent`: `applyPlayToState`, `isInterestingStateChange`, `getActiveUsersWithStakeIn`, `computeFlagState`, `diffFlagStates`, `dispatcher.dispatch` | `services/engine/src/onPlayEvent.ts:59-87` | production |
| 11 | `ResumptionGatedDispatcher.dispatch` enqueues with `scheduledFireAt = now` | `experiments/resumptionGate.ts:119-175` | harness. It does not call `QueueingEventDispatcher` |
| 12 | `runDispatcherTick`: `queue.due`, `isStillRelevant`, `userDirectory.getUser`, `shouldRateLimit`, `deliverFlagEvent`, `queue.remove` | `dispatcher.ts:50-88` | production |
| 13 | `deliverFlagEvent`: catalogs, `decideAction`, `persistFlagEvent`, `realtimeBus.publish`, `rateLimitStore.recordNotification`, `pushNotifier.sendPush` | `services/dispatcher/src/delivery.ts:189-315` | production |
| 14 | `LoggingPushNotifier.sendPush` → `createPushNotifier` → `ExpoPushNotifier.sendPush` or `NoOpPushNotifier` | harness `:322-337`, `:631-634`; `services/dispatcher/src/pushNotifier.ts:98-118`, `:184-189` | wrapper is harness; notifier is production |

The handler runs resumption **before** `onPlayEvent` (`live-sunday-harness.ts:811-816`), so `dispatch` can see a resolution produced by the same play.

### Harness-only glue on this path

Everything under `experiments/` that this run executes:

- `experiments/live-sunday-harness.ts` — process, CLI, logging, seeding, `Promise.all`, liveness timer (`:728-734`), ESPN health timer (`:857-862`).
- Classes in that file: `JsonlLog` (`:253`), `MeasuringRateLimitStore` (`:283`), `LoggingFlagEventPersistence` (`:309`), `LoggingPushNotifier` (`:322`), `InstrumentedEspnClient` (`:352`), `PollStats` (`:371`), `FixedLineupCache` (`:398`).
- `experiments/incrementalResumption.ts` — `IncrementalResumptionTracker`, including the `setTimeout` ceiling (`:204-219`).
- `experiments/resumptionGate.ts` — `ResumptionGatedDispatcher`.
- `experiments/nflTeams.ts` — `teamInfo`, used when seeding names and colors (`live-sunday-harness.ts:123`, `:485-506`).

`QueueingEventDispatcher` / `lagSecondsFor` are not on this path. The harness says so (`live-sunday-harness.ts:515-517`).

`InMemoryRealtimeBus` constructed at `live-sunday-harness.ts:610` is a private object. The API's WebSocket subscriber is a different object (`services/api/src/routes/realtime.ts:51-56`). A push from this harness does not arrive on Home's socket.

---

## 2. `EspnPlaySource`

**Interval.** Default `5000` ms (`espnPlaySource.ts:8`, applied at `:73`). The harness passes `--poll`, default `5000` (`live-sunday-harness.ts:235`, `:841`).

**What `subscribe()` returns.** `Promise<void>` (`espnPlaySource.ts:79`). It does not return plays. It calls `handler` once per new play id (`:128-134`). The promise resolves when:

- the summary is final (`completed` or `status.type.state === 'post'`, `:28-30` and `:137`), or
- `disconnect()` has set `disconnected` (`:143-144`), observed at the top of the loop (`:83`), between plays (`:129`), or after the play loop (`:138`).

`disconnect()` does not abort an in-flight `getSummary` or the current `sleep`. The harness comment matches that (`live-sunday-harness.ts:864-866`).

**Why one `subscribe()` is serial.** The poll loop is a single `while` (`espnPlaySource.ts:83-140`). Each new play `await`s the handler (`:134`) before the next play in that response is considered. The next `getSummary` does not start until those handlers finish and `sleep` (`:147-148`) finishes. One instance is constructed with one `eventId` (`:15`, `:72`).

**Several games.** The harness builds one source per resolved context (`:836-855`) and starts every `subscribe` together:

```899:909:experiments/live-sunday-harness.ts
  // `subscribe()` runs until its game goes final, so these MUST be concurrent — awaiting them in
  // sequence would poll the first game forever and never start the rest.
  await Promise.all(
    allContexts.map((context, index) => {
      const source = sources[index];
      if (!source) return Promise.resolve();
      return source.subscribe(makeHandler(context.gameId)).catch((error: unknown) => {
        console.error(`[harness] ${context.gameId} source threw: ${String(error)}`);
      });
    }),
  );
```

Each game has its own `seenPlayIds` set (`espnPlaySource.ts:80`) and its own `IncrementalResumptionTracker` (`live-sunday-harness.ts:740`).

**ESPN failure and retry.** `espnClient.fetchAndValidate` never throws for a rejected `fetch`, a non-2xx response, or a zod failure (`espnClient.ts:39-70`). It returns `{ ok: false, kind }`. `subscribe` then:

| `kind` | What the source does |
|---|---|
| `network_error` | `console.error` and `sleep` the poll interval, then `continue` (`espnPlaySource.ts:98-102`) |
| `http_error` | same branch (`:98-102`) |
| `invalid_shape` | `reportShapeFailure` then `sleep` and `continue` (`:87-102`) |
| summary ok but both teams missing | `reportShapeFailure` (`signature: 'missing-team-context'`), `sleep`, `continue` (`:107-121`) |

There is no backoff and no retry cap. The `while` runs until final or `disconnect`. Shape reports are throttled in memory for 5 minutes per signature (`errors.ts:38`, `:57-78`). Console logging of shape failures is not throttled (`errors.ts:47-48`).

`fetch(url)` is called with no second argument (`espnClient.ts:42`). This file sets no `AbortSignal` and no timeout. What the runtime does if the socket never completes is **UNKNOWN** from this repo.

`response.json()` (`espnClient.ts:59`) is outside the `try`. A throw from `json()` rejects `getSummary`, which rejects `subscribe`. The harness `.catch` logs that and ends that game's loop (`live-sunday-harness.ts:905-907`). Other games keep running because each `subscribe` is its own promise. A throw from the play handler is the same: `subscribe` does not catch it (`espnPlaySource.ts:134`).

A failed poll does not clear `seenPlayIds`. The next successful poll emits only ids not already in the set (`:130-131`).

---

## 3. Play mapping

`mapEspnPlay` (`mapEspnPlay.ts:94-121`) sets `playType` from `espnTypeIdToPlayType` (`espnPlayTypeMap.ts:88-89`). Unrecognized ESPN `type.id` becomes `no_play` (`espnPlayTypeMap.ts:85`).

`PlayType` is the union in `services/engine/src/playEvent.ts:23-37`: `pass`, `run`, `qb_kneel`, `qb_spike`, `two_point_attempt`, `punt`, `field_goal`, `kickoff`, `extra_point`, `no_play`, `timeout`, `end_period`, `end_half`, `end_game`.

`classifyPlayType` (`resumptionWatcher.ts:31-35`):

- `SKIP_AND_WAIT` — `timeout`, `end_period`
- `ABORT` — `end_half`, `end_game`
- `REAL_ACTION` — everything else, including an unrecognized cast (`resumptionWatcher.test.ts:237-240`)

ESPN ids that land on those categories are listed in `espnPlayTypeMap.ts:38-46` (timeout `21`/`74`/`75`, end period `2`, end half `65`, end of regulation `79` mapped to `end_half`, end game `66`). `extra_point` and `two_point_attempt` are in the union and are not in the ESPN table (`espnPlayTypeMap.ts:31-33`).

**Possession.** `possessionTeamId` is set only when the play type is outside `NO_POSSESSION_PLAY_TYPES` **and** the drive has `team.abbreviation` (`mapEspnPlay.ts:35-40`, `:100-110`):

```35:40:services/ingestion/src/espn/mapEspnPlay.ts
const NO_POSSESSION_PLAY_TYPES: ReadonlySet<PlayType> = new Set<PlayType>([
  'timeout',
  'end_period',
  'end_half',
  'end_game',
]);
```

```100:110:services/ingestion/src/espn/mapEspnPlay.ts
  const playType = espnTypeIdToPlayType(play.type.id);
  const driveTeam = drive.team?.abbreviation;
  const hasPossession = !NO_POSSESSION_PLAY_TYPES.has(playType) && driveTeam !== undefined;

  return {
    ...
    possessionTeamId: hasPossession ? resolveTeamAbbreviation(driveTeam) : null,
```

A drive with no team nulls possession even for a scrimmage type (`mapEspnPlay.ts:102`, test at `mapEspnPlay.test.ts:89-99`). `no_play` is not in that set, so a penalty can carry a team (`mapEspnPlay.ts:35-40` does not list it; ESPN id `8` maps to `no_play` at `espnPlayTypeMap.ts:73`).

### Earlier finding — refuted at the current call site

The finding was: `possessionTeamId` is only set on non-procedural plays, so the `SKIP_AND_WAIT` branch of `watchForResumption` cannot be reached from the current call site.

The first clause matches `NO_POSSESSION_PLAY_TYPES`, which is exactly the `SKIP_AND_WAIT` pair plus the `ABORT` pair. It is not the whole story: a missing drive team also nulls possession.

The second clause does not hold for the only non-test caller. That caller is `IncrementalResumptionTracker.evaluate`:

```165:167:experiments/incrementalResumption.ts
  private evaluate(window: OpenWindow): ResumptionResolution | null {
    const result = watchForResumption(window.precedingPlay, window.buffer);
```

The buffer is not "the play that has the new possession." It is every null-possession play since the last known possession, then the new play (`incrementalResumption.ts:134-136`, `:228-231`). A timeout stored in `proceduralSincePossession` becomes `playsFromPossessionChange[0]`. `watchForResumption` classifies that first play and, on `SKIP_AND_WAIT`, enters the loop at `resumptionWatcher.ts:92-106`. The file header states this on purpose: a touchdown, then a timeout, then a kickoff is `watchForResumption(td, [timeout, kickoff])` (`incrementalResumption.ts:20-26`).

What the call site does prevent is **waiting for a later poll**. A window opens only when the current play has a non-null possession different from the last known one (`incrementalResumption.ts:123-127`). That play is appended to the buffer in the same `observe` (`:136`). `timeout` and `end_period` cannot be that play, because `mapEspnPlay` nulls their possession. So the opening call's buffer already ends in a play `classifyPlayType` treats as `REAL_ACTION`. If the revealing play was a timeout, the `SKIP_AND_WAIT` loop sees that later `REAL_ACTION` immediately and returns (`resumptionWatcher.ts:97-98`). `evaluate` then closes the window (`incrementalResumption.ts:151-152`). The `SKIP_AND_WAIT` branch runs; it does not stay open across polls on a sequence `mapEspnPlay` can produce.

`experiments/resumptionGate.ts:14-19` says the revealing play is always itself `REAL_ACTION`. That is true only when `proceduralSincePossession` is empty. When it is not, `buffer[0]` can be `SKIP_AND_WAIT` (`incrementalResumption.ts:137`).

There is no caller in `services/` (see §4). Tests call `watchForResumption` directly with a timeout as the revealing play (`resumptionWatcher.test.ts:53-65`, `:175-187`), so the branch is also reached there.

---

## 4. `watchForResumption`

**Export.** `services/engine/src/resumptionWatcher.ts:73`. Re-exported from `services/engine/src/index.ts:16-23` with `classifyPlayType`, `RESUMPTION_CEILING_MS`, `PlayCategory`, `ObservedPlay`, `ResumptionResult`.

**Inputs.** `precedingPlay: ObservedPlay` and `playsFromPossessionChange: readonly ObservedPlay[]` (`resumptionWatcher.ts:73-76`). `ObservedPlay` is `{ play: PlayEvent, observedAt: number }` (`:43-46`).

**Outputs.** `ResumptionResult` (`:48-52`):

| `outcome` | When |
|---|---|
| `REAL_ACTION` | revealing play, or a later play, classifies as real action (`:85-86`, `:97-98`). `elapsedMs` is from `precedingPlay` if the revealing play is already real action (`:83-86`); from the revealing play if the loop continues (`:94`) |
| `ABORTED` | revealing play or a later play is `end_half` or `end_game` (`:88-89`, `:100-101`) |
| `CEILING_FALLBACK` | a later play is still `SKIP_AND_WAIT` and `observedAt - revealingPlay.observedAt >= RESUMPTION_CEILING_MS` (`:103-105`). Constant is `4 * 60 * 1000` (`:55`) |
| `NO_MORE_PLAYS` | the array is empty (`:78-79`), or the array ends on unresolved `SKIP_AND_WAIT` plays that have not crossed the ceiling (`:108-112`) |

**Ceiling.** The `>= RESUMPTION_CEILING_MS` check is inside the `for` over `subsequentPlays` (`:93-105`). It runs when a play object is already in the array. If the array ends before that, the function returns `NO_MORE_PLAYS` (`:108-112`). There is no `setTimeout` in this file. The unit test that expects `CEILING_FALLBACK` passes a synthetic play at `15:04:10` (`resumptionWatcher.test.ts:175-187`).

The harness tracker adds a separate timer. `armCeilingTimer` (`incrementalResumption.ts:204-219`) schedules `CEILING_FALLBACK` with `resolvedBy: 'wall_clock_timer'` at `revealingPlay.observedAt + RESUMPTION_CEILING_MS`. That timer is not `watchForResumption`. `evaluate` returns `null` on `NO_MORE_PLAYS` and leaves the window open (`:193-196`), which is what would let the timer fire. On the open path described in §3, `evaluate` gets a terminal result on the same play and `closeWindow` clears the timer (`:222-223`).

**Call sites of the exported function.**

1. `experiments/incrementalResumption.ts:167` — the harness, via `tracker.observe` from `live-sunday-harness.ts:814`.
2. `services/engine/src/resumptionWatcher.test.ts` — the `expect(watchForResumption(...))` lines at `:65`, `:86`, `:115`, `:143`, `:157`, `:168`, `:179`, `:194`, `:201`.

`experiments/backtest-resumption.ts:84` defines its own function with the same name. It does not import `@pivot/engine`'s `watchForResumption`. `services/` does not call it. Dispatcher imports from `@pivot/engine` do not include it (`scheduleFlagEvent.ts:1` imports `defaultClock`, `Clock`, `EventDispatcher`). `applyPlayToState.ts:3` imports `classifyPlayType` only.

---

## 5. Timing today

**Placeholder.** `diffFlagStates` sets `scheduledFireAt: newState.computedAt` (`services/engine/src/diffFlagStates.ts:28-30`). `computedAt` comes from the clock inside `computeFlagState` (`computeFlagState.ts:67`, `:110`).

**Production overwrite.** `QueueingEventDispatcher.dispatch` (`scheduleFlagEvent.ts:30-40`):

1. `resolveLikelyBroadcastSource(gameId, userId, catalog)` (`:32-36`) loads `getGameBroadcasts` and `getUserSubscribedServices` (`broadcastLag.ts:68-77`).
2. `pickBroadcastSource` keeps services the user subscribes to, sorts by `lagSecondsFor` ascending, then by service name (`broadcastLag.ts:43-56`).
3. `lagSecondsFor` (`broadcastLag.ts:23-26`): `null` or a missing key returns `DEFAULT_LAG_SECONDS` (`60`, `:21`). Otherwise the table at `:3-18`:

| service | seconds |
|---|---|
| `sunday_ticket` | 75 |
| `espn_plus` | 60 |
| `paramount_plus` | 50 |
| `peacock` | 45 |
| `amazon_prime` | 40 |
| `hulu` | 45 |
| `fubo` | 50 |
| `directv` | 40 |
| `nfl_plus` | 60 |
| `nfl_network` | 20 |
| `fox`, `cbs`, `nbc`, `abc` | 8 |

4. `scheduledFireAt = clock() + lagSec * 1000` (`scheduleFlagEvent.ts:39`). The engine placeholder is replaced.

**Harness overwrite.** `ResumptionGatedDispatcher.enqueueNow` sets `scheduledFireAt` to `Date.now` (or the injected clock) with no lag (`resumptionGate.ts:168-174`).

**Who reads the values.**

| Symbol | Readers |
|---|---|
| `scheduledFireAt` | `InMemoryFlagEventQueue.due` keeps events with `scheduledFireAt <= now` (`inMemoryQueue.ts:14-15`). `RedisFlagEventQueue.enqueue` uses it as the sorted-set score (`redisQueue.ts:11-15`); `due` ranges `0..now` (`:18-23`). `deliverFlagEvent` stores it as `firedAt` (`delivery.ts:272`). `GET` is not involved. `POST /flags/:event_id/action` does not read it. `toSyntheticFlagEvent` sets `0` because `decideAction` does not read it (`flags.ts:47-61`). The harness logs the field (`live-sunday-harness.ts:705`). |
| `lagSecondsFor` | `scheduleFlagEvent.ts:37`. `pickBroadcastSource` (`broadcastLag.ts:53`). `rankBroadcasts` sets `typicalLagSeconds` (`broadcastResolver.ts:56`). |
| `BROADCAST_LAG_SECONDS` | Read only inside `lagSecondsFor` (`broadcastLag.ts:25`). Tests assert the table (`broadcastLag.test.ts:11`). |

No production process constructs `QueueingEventDispatcher`. Call sites are `scheduleFlagEvent.test.ts` and `dispatcher.integration.test.ts:103`. The API `env.ts` schema has no `PUSH_DRIVER` and no dispatcher boot (`services/api/src/env.ts:6-19`). `docs/D1-DEPLOY-RUNBOOK.md:103-107` says the same.

`runDispatcherTick` fires when `scheduledFireAt <= now` (`dispatcher.ts:52-53` plus the queue filter). It does not add more delay. The harness loop polls every 500ms (`dispatcher.ts:11`), so an event scheduled for "now" waits until the next tick.

---

## 6. Flags and fan-out

**Play to flag (production functions, used by the harness).**

1. `applyPlayToState` copies score, quarter, clock, and sets `status` to `final` when `isFinalPlay` or `playType === 'end_game'`, otherwise `in_progress` (`applyPlayToState.ts:129-147`). Possession fields carry forward for `SKIP_AND_WAIT` and for a same-team `no_play` (`:69-74`, `:85-95`).
2. `isInterestingStateChange` is false when possession, unit, red zone, score, quarter, and status are unchanged (`isInterestingStateChange.ts:8-18`). Clock-only changes do not continue.
3. `getActiveUsersWithStakeIn` intersects `getUsersWithStakeIn(home)`, `getUsersWithStakeIn(away)`, and `getActiveUsers()` (`onPlayEvent.ts:29-40`).
4. A candidate with no lineup cache for `play.week` is skipped (`onPlayEvent.ts:76-77`).
5. `computeFlagState` returns unflagged unless `status === 'in_progress'` and `possessionTeamId !== null` (`computeFlagState.ts:61-68`). Offense on the possessing team adds `offense_active` (`:75-78`). Defense on the other team adds `defense_active` when that team is on offense (`:82-85`). Bonuses: red zone `+3`, close/late `+2` (Q4 margin ≤ 7, or any Q5), star `+5` each (`:89-102`).
6. `diffFlagStates` emits `flag_added`, `flag_removed`, `priority_increased` (delta ≥ 3), or `priority_decreased` (delta ≤ −3) (`diffFlagStates.ts:38-54`).

**Who cares about a game — production lineup path, not the harness.**

`rebuildUserLineupCache` (`services/api/src/lib/lineup-sync.ts:263-369`) loads the user's leagues, keeps `resolveWatchedLeagueIds` (`:284-288`), and for each watched league reads `lineup_slots` where `slot_type` is `starter` or `flex` (`:327-332`), or `fallback_roster` for `roster_fallback` (`:306-324`). It writes:

- `user_lineup_cache:{userId}:{week}` (`services/api/src/cache/redis.ts:12-13`, `:24-25`)
- `users_with_stake:{teamId}` via `addUserStake` / `removeUserStake` (`lineup-sync.ts:348-368`, `redis.ts:16-40`)

The engine does not read `watchedLeagueIds`. It reads the stake set and the cache those functions filled. `RedisGameStateProvider.getUsersWithStakeIn` is `SMEMBERS users_with_stake:{teamId}` (`redisGameStateProvider.ts:21-22`, `:68-69`). The lineup cache is the writer; this class only reads (`redisGameStateProvider.ts:26-28`).

The harness does not do that. `gameStateStore.addStake(abbreviation, userId)` (`live-sunday-harness.ts:659-663`) and `FixedLineupCache` ignore week (`:398-403`). Stakes are ESPN abbreviations (`:22-26` in the file header). `watchedLeagueIds` on the synthetic user is `[]` (`:545`).

**Where flag state is stored.**

- Hot flag state: `user_flag_state:{userId}:{gameId}` hash (`redisGameStateProvider.ts:17-18`, `:52-53`), written by `onPlayEvent` only when a diff emits (`onPlayEvent.ts:85`).
- Hot game state: `game_state:{gameId}` (`redisGameStateProvider.ts:13-14`, `:43-44`).
- The harness uses `InMemoryGameStateStore` (`live-sunday-harness.ts:604`), same method names, private to the process.
- `flag_events` rows: the table exists (`supabase/migrations/20260712160000_flag_events.sql:20-31`). `deliverFlagEvent` calls `FlagEventPersistence.persistFlagEvent` (`delivery.ts:264-274`). The only implementations in `services/` are `InMemoryFlagEventPersistence` (`catalogs.ts:145-150`). No `.insert` into `flag_events` appears in `services/` or `experiments/`. `POST /flags/:event_id/action` updates `user_action` (`flags.ts:259-265`). The harness `LoggingFlagEventPersistence` appends a JSONL line (`live-sunday-harness.ts:317-328`).

**Active users.** WebSocket connect and ping call `markUserActive(userId, ACTIVE_USER_TTL_MS)` (`realtime.ts:102-114`). Close calls `removeActiveUser` (`:133-137`). TTL is 5 minutes (`constants.ts:8`). `POST /session/heartbeat` also marks active (`services/api/src/routes/session.ts:172`). The harness re-marks two synthetic ids every 60s on its own store (`live-sunday-harness.ts:171-172`, `:728-734`) so the phone's socket cannot clear them (file header `:28-32`).

**Home.** `useHomeRealtime` (`app/lib/useHomeRealtime.ts:35-103`) opens `RealtimeClient` when Home is ready, the user has leagues, and the display phase is live. The client handles `type: 'flag_event'` (`app/lib/realtimeClient.ts:219-220`). Home's `onFlagEvent` calls `applyFlagEventToHome` (`app/app/(app)/(tabs)/index.tsx:164-172`). The API relays `realtime:user:*` publishes to that user's sockets (`realtime.ts:51-56`). `deliverFlagEvent` publishes `realtime:user:{userId}` (`delivery.ts:276`, channel helper `realtimeBus.ts:4-5`).

That chain reaches the phone only if the publisher and the API share a bus. The harness publishes on its own `InMemoryRealtimeBus` (`live-sunday-harness.ts:610`, `:684`). The API process is separate.

**Reconcile.** On a socket open after the first connect, `RealtimeClient` calls `onReconnected` (`app/lib/realtimeClient.ts:170-179`; the option is declared at `:41-46`). `useHomeRealtime` passes Home's callback (`useHomeRealtime.ts:70-72`). Home's callback is `onReconcileHome`, which calls `loadHome` (`index.tsx:299-307`). `loadHome` requests `GET /flags/current` during a live phase (`index.tsx:229`). `GET /flags/current` does not read `user_flag_state`. It recomputes `computeFlagState` from the lineup cache and `gameStateStore.getGameState` for this week's games that include a stake team (`flags.ts:67-78`, `:150-155`). `reconcileHomeWithFlagsCurrent` (`homeFlagUpdates.ts:212`) is only referenced from `homeFlagUpdates.test.ts`. The screen does not call it.

A 30s interval also calls `loadHome` during a live display phase (`index.tsx:92-94`, `:319-325`).

---

## 7. Dispatcher and delivery

**Rate limiter.** `shouldRateLimit` (`rateLimiter.ts:65-79`) counts `user_notifications:{userId}` over `[now - 60_000, now]` (`:4-5`, `:71`). The fourth notification in that window returns true (`MAX_PER_WINDOW = 3`). It also returns true during quiet hours (`:74`) and when `notificationMode` is `off` or `high_leverage_only` without a red-zone, star, or close-game reason (`:12-16`, `:76-77`).

Checked in `runDispatcherTick` before deliver (`dispatcher.ts:79-82`). A limited event is removed and not recorded.

Redis key: `user_notifications:${userId}` (`redisRateLimitStore.ts:4-8`). `ZCOUNT` for the read (`:17`). `ZADD` score `deliveredAtMs`, member `eventId`, then `EXPIRE` 3600s (`:20-25`, TTL `rateLimiter.ts:10`). `InMemoryRateLimitStore` keys a `Map` by `userId` only (`rateLimiter.ts:84-98`).

Recorded only after `persistFlagEvent` and `publish` (`delivery.ts:278-280`).

The harness store's `countRecentNotifications` returns `0` always (`live-sunday-harness.ts:291-298`). `shouldRateLimit` still runs, but the count gate cannot trip. Quiet hours and mode still can; the synthetic user disables quiet hours and sets `notificationMode: 'all'` (`:539-545`). The store logs when the real count would have been ≥ 3 (`:295-297`).

**Push.** `createPushNotifier` (`pushNotifier.ts:184-189`): `pushDriver: 'expo'` builds `ExpoPushNotifier`; anything else (the argument type is `'expo' | 'none'`) returns `NoOpPushNotifier`. Nothing in `services/api` calls `createPushNotifier`. The harness passes `'none'` when `--no-push` or `PIVOT_EXPO_PUSH_TOKEN` is missing, otherwise `'expo'` (`live-sunday-harness.ts:236`, `:631-634`). `NoOpPushNotifier.sendPush` logs and returns `{ success: true }` without a network call (`pushNotifier.ts:45-47`).

`ExpoPushNotifier.sendPush` rejects a token `Expo.isExpoPushToken` does not accept (`:106-107`). Otherwise it `queueMicrotask`s a flush (`:121-127`) that calls `chunkPushNotifications` and `sendPushNotificationsAsync` (`:142-147`). Ticket `status === 'error'` becomes `{ success: false }` (`:160-164`). The class does not call a receipt API (`:91-96`). `deliverFlagEvent` catches push failures and does not rethrow (`delivery.ts:302-314`). Push is skipped when `expoPushToken` is null or `action.type === 'in_app_indicator'` (`:286`). The harness data-only user has `expoPushToken: null` (`:668`), so that user's events persist and publish on the harness bus and do not call `sendPush`.

**Dedupe that exists.**

- Play ids: `seenPlayIds` inside one `subscribe` (`espnPlaySource.ts:80`, `:130-131`). Not shared across processes.
- Flag event id: SHA-1 of `userId:gameId:type:computedAt` (`diffFlagStates.ts:11-12`).
- Queue member: `JSON.stringify(event)` (`inMemoryQueue.ts:9`, `redisQueue.ts:14`). A second enqueue of the same string replaces that member.
- `isStillRelevant` drops an event whose stored flag state no longer matches `computedAt`, `flagged`, and `priorityScore`, or whose user is inactive (`isStillRelevant.ts:19-33`).

**Per-game collapse.** No function merges several flag events for one `(userId, gameId)` into one notification. `ResumptionGatedDispatcher.parked` is a per-game list that flushes each event separately (`resumptionGate.ts:147-160`). `shouldRateLimit` does not take `gameId` (`rateLimiter.ts:65-71`).

---

## 8. Game discovery

**Harness.** `--list` prints `espnClient.getScoreboard()` (`live-sunday-harness.ts:559-567`). The URL is `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` with no `dates`, `seasontype`, or `week` (`espnClient.ts:9-10`). Each event contributes `id`, home/away abbreviation, and `status.type.state` (`live-sunday-harness.ts:422-429`, schema `espnTypes.ts:93-107`). The schema has no week and no start time.

`--watch` ids are whatever the CLI passed (`:232`). They are not filtered by scoreboard state. `--data auto` keeps scoreboard events whose id is not watched and whose `state !== 'post'` (`:581-585`). `pre` is included. Each id is then `getSummary`'d; a bad summary or missing teams is skipped (`:436-446`).

**What a runner can already read, without inventing a client.**

`public.games` (`supabase/migrations/20260510120100_nfl_reference_entities.sql:28-38`): `id`, `sportradar_id`, `season_year`, `week`, `scheduled_start`, `home_team_id`, `away_team_id`, `status`, `venue`. Seed writes `sportradar_id = seed:espn:{espnEventId}` and `status: 'scheduled'` (`scripts/fetch-nfl-schedule.ts:83-91`). The only updater of `status` to `in_progress` or `final` in this repo is `experiments/liveIngestCore.ts:75-81`, keyed by `sportradar_id = seed:espn:{espnId}` (`liveIngestCore.ts:30-33`). The harness never writes `games`.

`GET /games/live` selects `games.status = 'in_progress'`, then drops rows with no `game_state` in the API's store (`services/api/src/routes/games.ts:153-201`).

`espnClient.getScoreboard` is called from the harness and from `espnClient.test.ts`. `scripts/fetch-nfl-schedule.ts:95-107` uses its own `fetch` with `dates`, `seasontype`, and `week`. It is a seed script, not a long-running poll.

Whether any hosted database currently has `status` other than `scheduled` is **UNKNOWN**. That would require reading that database.

---

## 9. State

Along the harness path that actually sends push:

| What | Where it lives |
|---|---|
| ESPN poll cursor (`seenPlayIds`, resolved `EspnGameContext`) | Memory inside one `EspnPlaySource` (`espnPlaySource.ts:80-81`) |
| Resumption window, procedural buffer, ceiling `Timeout` | Memory inside one `IncrementalResumptionTracker` (`incrementalResumption.ts:91-95`, `:204`) |
| Gate: open windows, parked events, carry-over resolution | Memory inside `ResumptionGatedDispatcher` (`resumptionGate.ts:56-77`) |
| `GameState`, `FlagState`, stake sets, active users | `InMemoryGameStateStore` (`live-sunday-harness.ts:604`) |
| Flag queue | `InMemoryFlagEventQueue` (`:605`, `inMemoryQueue.ts:6`) |
| Rate-limit timestamps | `MeasuringRateLimitStore`'s `Map` (`live-sunday-harness.ts:284`) |
| Users, players, games, broadcasts, viewing session | In-memory catalogs (`:606-609`) |
| Delivered-flag log the harness writes | Append-only files `experiments/logs/events-*.jsonl` and `plays-*.jsonl` (`:598-601`). Not Supabase |
| Realtime publish | `InMemoryRealtimeBus` (`:610`). Not Redis, not the API |
| Push token | Process env `PIVOT_EXPO_PUSH_TOKEN` or the dry-run placeholder (`:236`, `:170`, `:666`) |
| Supabase | Not used by `live-sunday-harness.ts` |
| Redis | Not used by `live-sunday-harness.ts` |

Production types that exist and are **not** on the harness path:

| Key / table | Writer in repo |
|---|---|
| `game_state:{gameId}`, `user_flag_state:{userId}:{gameId}`, `active_users` | `RedisGameStateProvider` (`redisGameStateProvider.ts:11-88`), selected when `CACHE_DRIVER=redis` (`providers/index.ts:19-30`) |
| `user_lineup_cache:{userId}:{week}`, `users_with_stake:{teamId}`, `current_nfl_state` | `RedisLineupCache` (`services/api/src/cache/redis.ts:10-52`), filled by the lineup worker |
| `flag_event_queue` | `RedisFlagEventQueue` (`redisQueue.ts:6-28`). No production caller enqueues |
| `user_notifications:{userId}` | `RedisRateLimitStore` (`redisRateLimitStore.ts:4-25`). No production caller records |
| `realtime:user:{id}` publish | `RedisRealtimeBus.publish` (`realtimeBus.ts:98-102`). API subscribes with a separate TCP client (`realtime.ts:46-56`) |
| `public.games`, `public.lineup_slots`, `public.flag_events` | Supabase. Flag rows are not inserted by this pipeline (§6) |

`CACHE_DRIVER` defaults to `memory` (`env.ts:10`). Two API processes on `memory` do not share game state. `docs/D1-DEPLOY-RUNBOOK.md:29` says the same.

**Restart the harness mid-game.** Process memory is gone: seen ids, game state, flag state, queue, resumption windows, rate-limit log, liveness marks. JSONL already appended stays (`JsonlLog` uses `appendFileSync`, `live-sunday-harness.ts:256-259`). A new `subscribe` starts with an empty `seenPlayIds` (`espnPlaySource.ts:80`). `flattenPlays` returns every play in `drives.previous` plus `drives.current` (`:41-54`). Those ids are all new to the new process, so the handler runs for the whole retained history before it waits for the next poll. `user_flag_state` starts empty, so the first interesting play can emit again. In-flight queue entries from the old process are gone. The ceiling timer is gone. `games.status` is unchanged because the harness never wrote it.

**Two harness processes at once.** Each has its own memory and its own `seenPlayIds`. Both poll ESPN. Both call `sendPush` if both have a token. Nothing in the harness coordinates them.

**Two processes using the Redis implementations (not started anywhere today).** `RedisFlagEventQueue.due` is `ZRANGE` and `remove` is a later `ZREM` (`redisQueue.ts:18-28`). There is no claim or lock in that file. Two loops can both read the same member and both call `deliverFlagEvent` before either removes it. `seenPlayIds` would still be per process, so two pollers would both emit. `game_state` `HSET` is last write wins (`redisGameStateProvider.ts:43-44`). The rate-limit `ZCOUNT` then `ZADD` is also not one Redis transaction (`redisRateLimitStore.ts:17-25`, check at `dispatcher.ts:79`, record at `delivery.ts:280`).

---

## 10. Fixtures

`experiments/logs/` is gitignored (`.gitignore:11-12`). The files below were on disk in this working tree. Sizes and line counts come from `experiments/fixture-shape-probe.ts` (read each file, count non-empty lines, `stat` size). Game ids are the set of `gameId` strings on parsed lines. The example is the first line of the file. Event files mix `kind`s; keys below are the union, not the shape of every line.

### `events-*.jsonl` (11 files)

These are harness decision logs (`kind` plus fields). They are not `PlayEvent`s and not ESPN summary documents.

| File | Bytes | Lines | `gameId`s |
|---|---:|---:|---|
| `events-2026-09-13T16-47-50-738Z.jsonl` | 15827 | 141 | 401872658, 401872659, 401872660, 401872661, 401872922, 401872923, 401872924, 401872925, 401872926, 401872927, 401872928, 401872929, 401872930, 401872931 |
| `events-2026-09-13T16-58-08-437Z.jsonl` | 122841 | 752 | same 14 ids |
| `events-2026-09-13T17-35-51-343Z.jsonl` | 58249 | 225 | same 14 ids |
| `events-2026-09-13T17-41-45-031Z.jsonl` | 11645 | 38 | 401872660, 401872661 |
| `events-2026-09-13T17-43-44-427Z.jsonl` | 11419 | 36 | 401872660, 401872661 |
| `events-2026-09-13T17-44-37-297Z.jsonl` | 29146 | 116 | 401872660, 401872661 |
| `events-2026-09-13T17-59-02-157Z.jsonl` | 63806 | 269 | 401872660, 401872661 |
| `events-2026-09-13T18-43-37-051Z.jsonl` | 44309 | 151 | 401872660, 401872661 |
| `events-2026-09-13T18-56-05-002Z.jsonl` | 85246 | 356 | 401872660, 401872661 |
| `events-2026-09-15T03-09-50-346Z.jsonl` | 26264 | 82 | 401872931 |
| `events-2026-09-15T03-14-00-843Z.jsonl` | 26985 | 82 | 401872931 |

`kind` values seen across the series: `observed_week`, `espn_health`, `espn_poll_failure`, `resumption_window_opened`, `resumption_resolved`, `gated`, `tick`, `delivered`, `push`, `rate_limit_would_drop`, `shutdown`. The `16-47-50` file has only `espn_health` and `shutdown`.

First line of `events-2026-09-13T16-47-50-738Z.jsonl`:

```json
{"wall":1789318130743,"kind":"espn_health","gameId":"401872660","polls":12,"failures":0,"p50Ms":120,"maxMs":222}
```

First line of `events-2026-09-13T16-58-08-437Z.jsonl`:

```json
{"wall":1789318748448,"kind":"espn_health","gameId":"401872660","polls":12,"failures":0,"p50Ms":118,"maxMs":237}
```

First line of each later `events-*.jsonl` through `events-2026-09-15T03-14-00-843Z.jsonl` is `{"wall":<ms>,"kind":"observed_week","week":1}` (walls `1789320951398`, `1789321305075`, `1789321424476`, `1789321477339`, `1789322342224`, `1789325017101`, `1789325765096`, `1789441790405`, `1789442040892`).

A `push` line from `events-2026-09-13T18-56-05-002Z.jsonl` (same probe, not the first line):

```json
{"wall":1789325765691,"kind":"push","eventId":"5fbbeb62c0af8a4e19c6ab85bbe60bb746bf0790","gameId":"401872660","title":"Texans RB1 no longer active","body":"Possession changed — Bills has the ball now.","deepLinkUrl":"https://tv.youtube.com/watch/skeSQ9ZXBXc","success":true,"error":null}
```

### `markers-*.jsonl` (3 files)

Written by `experiments/mark-visible.ts:54` as `{ wall, index, note }`. No `gameId` field. Which ESPN game a marker belongs to is **UNKNOWN** from the file, except where a human note mentions a team.

| File | Bytes | Lines | Structured game ids |
|---|---:|---:|---|
| `markers-2026-09-13T16-53-12-193Z.jsonl` | 10091 | 217 | none (`note` is null on the first line; the probe found no `gameId`) |
| `markers-2026-09-13T17-18-34-187Z.jsonl` | 246 | 5 | none |
| `markers-2026-09-13T18-02-22-807Z.jsonl` | 2381 | 30 | none |

First line of `markers-2026-09-13T16-53-12-193Z.jsonl`:

```json
{"wall":1789319868768,"index":1,"note":null}
```

First line of `markers-2026-09-13T17-18-34-187Z.jsonl`:

```json
{"wall":1789321540413,"index":1,"note":"Starting at line 119"}
```

First line of `markers-2026-09-13T18-02-22-807Z.jsonl`:

```json
{"wall":1789322618750,"index":1,"note":null}
```

Later notes in that third file are free text (`CAR poss`, `HOU poss kick return`, `Bills ball live`, and similar). They do not contain `401872…` ids.

### Can these be replayed through production code with no network?

No reader in `services/` opens `experiments/logs`. `EspnPlaySource` obtains plays only from `client.getSummary` (`espnPlaySource.ts:84`). `ReplayPlaySource` / `mapNflverseRow` expect nflverse columns such as `posteam` and `play_id` (`services/engine/src/replayPlaySource.ts:109-120`). An `events-*.jsonl` line has no `playType`, `possessionTeamId`, `quarter`, or `down`. A marker line has `wall`, `index`, and `note`.

`PIVOT-STAKES-PLAN.md:23` says older `plays-<date>.jsonl` names mean the `events-*.jsonl` files. Both series exist. The harness writes them separately (`live-sunday-harness.ts:600-601`). `plays-*.jsonl` lines are the object at `:783-802` (`kind: 'play'`, `playId`, `playType`, `possession`, `home`, `away`, quarter, clock, down, distance, yardline, scores, `isFinalPlay`, `week`) plus `wall` from `JsonlLog` (`:257`). Field names are not `PlayEvent` (`possession` vs `possessionTeamId`, `home` vs `homeTeamId`). No production function accepts that object. Ten `plays-*.jsonl` files were on disk beside the events files; this section does not inventory them one by one because the question names `events-` and `markers-`.

---

## 11. Tests covering §2–§7

Counts are vitest cases: each `it(...)` plus each row of `it.each`. `experiments/` is outside `vitest.config.ts` `include` (`vitest.config.ts:14-19`), so the tracker and the gate have no tests here. `pnpm test` was not re-run for this doc; these files were not edited.

**§2 `EspnPlaySource` and the client it retries on**

| File | Cases |
|---|---:|
| `services/ingestion/src/espn/espnPlaySource.test.ts` | 7 |
| `services/ingestion/src/espn/espnClient.test.ts` | 7 |
| `services/ingestion/src/espn/errors.test.ts` | 10 |

**§3 mapping and taxonomy**

| File | Cases |
|---|---:|
| `services/ingestion/src/espn/mapEspnPlay.test.ts` | 30 (14 `it` + 16 `it.each` rows) |
| `services/ingestion/src/espn/espnPlayTypeMap.test.ts` | 41 (3 `it` + 26 + 5 + 4 + 3 `it.each` rows) |

`classifyPlayType`'s cases are in the resumption file below.

**§4 `watchForResumption`**

| File | Cases |
|---|---:|
| `services/engine/src/resumptionWatcher.test.ts` | 25 (11 `it` + 2 + 2 + 10 `it.each` rows) |

Nine of the plain `it` calls are `watchForResumption` outcomes (`resumptionWatcher.test.ts:52-201`). The `it.each` block plus two `it` calls are `classifyPlayType` (`:205-241`).

**§5 fire time**

| File | Cases |
|---|---:|
| `services/dispatcher/src/scheduleFlagEvent.test.ts` | 3 |
| `services/dispatcher/src/broadcastLag.test.ts` | 11 |
| `services/engine/src/diffFlagStates.test.ts` | 11 |
| `services/dispatcher/src/dispatcher.integration.test.ts` | 4 |

The integration file is the one that runs `QueueingEventDispatcher` through `runDispatcherTick` (`dispatcher.integration.test.ts:103`).

**§6 flags, stakes, Home**

| File | Cases |
|---|---:|
| `services/engine/src/onPlayEvent.test.ts` | 7 |
| `services/engine/src/computeFlagState.test.ts` | 20 |
| `services/engine/src/isInterestingStateChange.test.ts` | 10 |
| `services/engine/src/applyPlayToState.test.ts` | 37 (23 `it` + 5 + 4 + 5 `it.each` rows) |
| `services/api/src/lib/lineup-sync.test.ts` | 10 |
| `services/api/src/lib/watched-leagues.test.ts` | 4 |
| `services/api/src/routes/flags.test.ts` | 24 (20 `it` + 4 `it.each` rows) |
| `services/dispatcher/src/providers/inMemoryGameStateStore.test.ts` | 5 |
| `services/dispatcher/src/providers/redisGameStateProvider.integration.test.ts` | 4 |
| `services/api/src/routes/realtime.test.ts` | 10 |
| `app/lib/realtimeClient.test.ts` | 15 |
| `app/lib/homeFlagUpdates.test.ts` | 18 |

No `*.test.ts` imports `app/app/(app)/(tabs)/index.tsx`. The screen's `useHomeRealtime` binding is untested. `reconcileHomeWithFlagsCurrent` is tested; the screen calls `loadHome` instead (§6).

**§7 dispatcher, rate limit, push**

| File | Cases |
|---|---:|
| `services/dispatcher/src/dispatcher.test.ts` | 8 |
| `services/dispatcher/src/rateLimiter.test.ts` | 17 |
| `services/dispatcher/src/isStillRelevant.test.ts` | 9 |
| `services/dispatcher/src/delivery.test.ts` | 25 |
| `services/dispatcher/src/pushNotifier.test.ts` | 13 |
| `services/dispatcher/src/decideAction.test.ts` | 8 |
| `services/dispatcher/src/notificationContent.test.ts` | 25 |
| `services/dispatcher/src/broadcastResolver.test.ts` | 10 |

`dispatcher.integration.test.ts` (4) is listed under §5 and also drives `deliverFlagEvent`.

---

## UNKNOWN

1. **How long `fetch` waits if ESPN never completes.** `espnClient.ts:42` passes no timeout and no `AbortSignal`. The repo does not say what Node does. An answer would be a runtime measurement, or an explicit timeout added later (out of scope here).
2. **Hosted `games.status`.** The only writer of `in_progress` / `final` is `experiments/liveIngestCore.ts:80`. Whether any database has been updated that way is not in the repo.
3. **Whether `flag_events` contains rows.** No insert exists in this repo. `POST /flags/:event_id/action` only updates (`flags.ts:259-265`). Row contents would require querying the database.
4. **Which game a marker refers to.** `markers-*.jsonl` has no game id. Notes are optional free text (`mark-visible.ts:53-54`).
5. **`process.env.PUSH_DRIVER`.** `createPushNotifier` takes `config.pushDriver` (`pushNotifier.ts:184`). No file reads `process.env.PUSH_DRIVER`. The API env schema does not include it (`env.ts:6-19`). The harness chooses `'expo'` or `'none'` in code (`live-sunday-harness.ts:631-634`).
