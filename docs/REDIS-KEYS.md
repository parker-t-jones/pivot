# Redis key inventory

Source of truth for PLAN §7; audited across `services/` for #84. TTLs below are
seconds unless marked otherwise. TCP adapters live in `api/src/runner/tcpRedis.ts`;
Upstash implementations live in `api/src/cache/` and `dispatcher/src/`. Engine
access goes through injected providers; ingestion has no Redis key writer.

| Key pattern                          | Redis type                                          | Writers                                                                   | Readers                                                       | Expiry and other bounds                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_lineup_cache:{user}:{week}`    | JSON string                                         | Worker/runner `rebuildUserLineupCache`, TCP/Upstash lineup caches         | Engine lineup reader, rebuild, API flags                      | 1209600 (14d), refreshed on write; current week routing. In-memory lineup cache currently has no expiry (unchanged).                                                                                                                            |
| `users_with_stake:{team}`            | set of user IDs                                     | Lineup rebuild, TCP/Upstash/in-memory lineup caches; SREM on team removal | Engine/dispatcher game-state providers, runner discovery      | No TTL by Parker's decision. Team key count is bounded; rebuild explicitly reconciles memberships against all existing team sets; account deletion removes the user. No snapshot/reverse-index dependency.                                      |
| `users_with_bet:{game}`              | set of user IDs                                     | `syncUserBetGames`, lineup caches                                         | Runner bet pass                                               | 1209600 on every add, SREM on removal; in-memory lazy expiry.                                                                                                                                                                                   |
| `user_bet_games:{user}:{week}`       | set of game IDs                                     | `syncUserBetGames`, lineup caches                                         | Same resync's stale-game comparison                           | 1209600 on every add, SREM on removal; in-memory lazy expiry.                                                                                                                                                                                   |
| `current_nfl_state`                  | JSON string                                         | `getCurrentNflState`, lineup caches                                       | API, worker and runner NFL state lookups                      | 300 on write; one fixed key.                                                                                                                                                                                                                    |
| `game_state:{game}`                  | hash                                                | Engine via TCP/Upstash game-state provider                                | Engine, API current flags                                     | 21600 (6h), refreshed on write. In-memory providers have no expiry (unchanged).                                                                                                                                                                 |
| `user_flag_state:{user}:{game}`      | hash                                                | Engine `onPlayEvent` via TCP/Upstash providers                            | Engine state comparison; dispatcher relevance at delayed fire | Existing 21600 refreshed on write, unchanged. Parker accepts 6h versus 90s user delay and 4min resumption ceiling. In-memory dispatcher store intentionally untouched.                                                                          |
| `espn_seen_plays:{espnEventId}`      | set of play IDs                                     | `followGame` seed and successful play delivery via `tcpSeenPlays`         | `followGame` deduplication/retry seed                         | **Previously none; now 172800 (48h), refreshed on every add including duplicates**, per Parker's restart deduplication policy. In-memory provider mirrors lazy expiry; no Upstash provider exists.                                              |
| `resumption_open:{game}`             | JSON string                                         | `ResumptionCeiling.onWindowOpened` via TCP store                          | `ResumptionCeiling.rearm` on restart                          | **Previously none; now 3600 (1h) on every put**, per Parker: an older abandoned ceiling must expire rather than fire on restart. Explicit deletion on resolution/fire remains. In-memory store mirrors lazy expiry; no Upstash provider exists. |
| `flag_event_queue`                   | sorted set (serialized event, scheduled-fire score) | Resumption gate via TCP/Upstash queue                                     | Dispatcher tick due batches                                   | No TTL; explicit ZREM after delivery/drop. Fixed key count does not bound members during an outage. **Queued deferred alerts have no maximum retention deadline**; finding only, unchanged.                                                     |
| `user_notifications:{user}`          | sorted set (event ID, delivery-time score)          | Successful delivery via TCP/Upstash rate-limit stores                     | Rate limiter's 60s range count                                | 3600 refreshed on write. No score pruning: sustained writes less than 1h apart retain historical members until an idle hour; finding only, unchanged.                                                                                           |
| `active_users`                       | sorted set (user ID, expiry-ms score)               | Legacy socket presence via game-state stores                              | Active-user/device checks                                     | No key TTL; explicit disconnect removal and periodic `sweepExpiredActiveUsers`. Reads range-filter expiry.                                                                                                                                      |
| `presence:{user}`                    | sorted set of device/connection/platform            | Socket lifecycle via `writePresenceConnection` (TCP/Upstash)              | Delivery activity checks                                      | PEXPIRE with caller's presence TTL on write; prune expired scores on writes/removal; delete when empty. Memory presence mirrors expiry.                                                                                                         |
| `presence-vis:{user}`                | hash of connection visibility                       | Same presence lifecycle                                                   | Device activity checks                                        | Same PEXPIRE as presence; expired connection fields pruned, explicit HDEL/disconnect cleanup.                                                                                                                                                   |
| `stake_fired:{stake}:{code}`         | string                                              | `fireClaim` through TCP claims adapter                                    | Bet pass fire-claim check                                     | 86400 on write; durable `stake_trigger_log` remains authoritative after cache expiry.                                                                                                                                                           |
| `game_player_stats:{game}`           | JSON string                                         | Runner summary callback through TCP stats adapter                         | Prop evaluation, settlement, API current bet flags            | 43200 (12h) on write.                                                                                                                                                                                                                           |
| `runner_heartbeat`                   | ISO timestamp string                                | Leader heartbeat through TCP                                              | API current flags liveness                                    | 45 on write; fixed key.                                                                                                                                                                                                                         |
| `pivot:runner:leader`                | owner/epoch string                                  | TCP leader acquire/conditional renewal                                    | Leader/standby coordination                                   | 15 on acquire and matching renewal; fixed key.                                                                                                                                                                                                  |
| `pivot:runner:leader:epoch`          | integer string                                      | TCP leader acquisition INCR                                               | Acquisition fencing value                                     | No expiry, deliberately monotonic, one fixed key.                                                                                                                                                                                               |
| `slip_import:{user}:{ET-date}`       | integer string                                      | Pro import quota TCP/Upstash INCR                                         | Same quota check                                              | 172800 (2d), EXPIRE on first increment; date buckets.                                                                                                                                                                                           |
| `slip_import:{user}:{season}:{week}` | integer string                                      | Free import quota TCP/Upstash INCR                                        | Same quota check                                              | 777600 (9d), EXPIRE on first increment; week buckets.                                                                                                                                                                                           |

`realtime:user:{user}` and `realtime:game:{game}` are Pub/Sub channels, not stored
keys. Publishers are delivery/live-game fanout; subscribers are API sockets.
No TTL is applicable. Scripts and experiments are outside this services inventory.

## Stake and account cleanup

`lib/lineup-sync.ts` writes the rebuilt lineup, then calls `replaceUserStakes`.
TCP/Upstash providers use cursor-based `SCAN MATCH users_with_stake:* COUNT 100`
and SREM the user from unwanted team sets, adding wanted memberships first.
The in-memory provider reconciles its team map. No TTL or new reverse index is
introduced. Week rollover, expired snapshots, and legacy memberships are repaired
on the next successful rebuild, including an empty lineup. The runner uses this
same rebuild path. SCAN avoids a blocking KEYS command but traverses the keyspace
once per rebuild; this is a deliberate cost of repairing pre-existing entries
without another index. Concurrent rebuilds for one user retain the existing
last-writer race; this change does not serialize syncs.

After successful Supabase admin deletion, `DELETE /me` starts detached,
best-effort cache cleanup. Redis failures are logged and cannot delay or fail the
204 response. No cleanup runs on failed admin deletion or demo-account rejection.
TCP/Upstash cleanup scans all forward stake/bet indexes (even if reverse indexes
expired), removes the user from `active_users`, and deletes all weeks of
`user_lineup_cache`, `user_bet_games`, `user_flag_state`, `user_notifications`,
`presence`, `presence-vis`, and `slip_import` for that user. Other users and shared
game state remain intact. Repeating cleanup is safe. Memory cleanup removes the
lineup/stake/bet data that provider owns.

Cleanup is not durable: a process exit, Redis outage, or concurrent in-flight writer
can leave entries behind. Surviving users repair team memberships on rebuild;
pre-existing deleted accounts need Parker's explicit one-time cleanup. Expiring
user keys retain their existing bounds if cleanup cannot finish.

A stale member with no lineup is skipped by `engine/onPlayEvent.ts`. With a
surviving lineup, the engine still computes flags and may emit a removal for a
previous flag. Dispatcher tick drops a missing account before delivery; no push
is attempted. Stale bet members trigger a bet lookup; the runner's short-lived
prepared-bet cache can retain recently deleted bets. Deferred queue members are
not user-indexed keys and remain subject to the existing relevance/missing-user
gates. `stake_fired` is indexed by stake rather than user and retains its 24h TTL.
Pub/Sub channels are not stored keys. No demo behavior or delivery semantics change.

## Operational limits

Expiry unit tests use fake clients and clocks. **TTL behavior against a real Redis
is unverified.** In-memory expiry is lazy removal on access, following #82; it
provides read/write parity, not a background memory sweeper. Existing Redis keys
need Parker's one-time `EXPIRE ... NX` backfill (Redis 7+), documented in the PR.
The resumption-record change affects dispatcher/iOS-push timing and deploys
Tue–Wed only. No deployment or production command was run.
