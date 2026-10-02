# Live replay on the simulator (`replay-live.ts`)

Replays one recorded game through the real P0 runner (`startLiveRunner`) against the local stack,
so the simulator's Home receives `game_state` and flag events over the WebSocket exactly as it
would during a live game. Only ESPN is replaced: `fetch` to `site.api.espn.com` returns the
recorded payload at the replay's virtual time, and the production `espnClient` still validates it.

## Prerequisites

- Docker Redis `pivot-redis` on `127.0.0.1:6379` and local Supabase (`supabase start`) running.
- `services/api/.env` points at both: `SUPABASE_URL=http://127.0.0.1:54321`,
  `REDIS_URL=redis://127.0.0.1:6379`, `CACHE_DRIVER=redis`. The script refuses to start if
  either host is not `localhost` / `127.0.0.1` / `::1`.
- API dev server running against that same Redis (`pnpm --filter @pivot/api dev`). It fans
  runner publishes out to the WebSocket.
- The simulator is on Home, signed in as a user whose watched lineup has a player on one of the
  replayed teams. For the command below that means PHI or CHI.
- No other runner. The script refuses while `pivot:runner:leader` is held. Stop
  `services/api/src/runner.ts` and wait about 15s for the lock to expire. Any runner started while
  the replay leads sits in standby and takes over after the replay exits.
- Keep the Mac awake (`caffeinate -i`). If the machine sleeps past the 15s lock TTL, a standby
  runner can take the lead in the middle of the replay.

## Command

```sh
pnpm tsx experiments/replay-live.ts --recording experiments/logs/recordings/2026-09-28 --game 401872963 --speed 20
```

This is PHI @ CHI, Monday 2026-09-28. It is the only game recorded that night, runs from pre-game
to `STATUS_FINAL`, and has a frame about every 10s with no gaps. At 20x the whole game takes about
9 minutes. `--from <ISO>` starts somewhere else on the recording's clock. The default is the first
frame. Start before kickoff: the first summary the runner sees after discovery is its seed, and
those plays are marked seen, not delivered.

The script prints one line per publish:

```
wall time                 clock    event              detail
2026-10-02T01:06:42.396Z  Q1 08:42  game_state         PHI 0-7 CHI
2026-10-02T01:06:42.884Z  Q1 08:42  flag_added         user 2057923d Saquon Barkley (RB)
2026-10-02T01:07:03.135Z  Q1 06:09  flag_removed       user 2057923d
```

## What Home shows

Times are wall time after start, at `--speed 20`. Home reloads every 30s, and the WebSocket only
carries games Home already knows about. If a phase does not show up, pull to refresh.

1. **Pre-game (0 to ~20s).** The game's row has been moved into the current NFL week with
   kickoff about 19s out. After a refresh, Home shows the pre-game view (board, MY CARD, countdown)
   with PHI @ CHI in it. At 20x this phase is shorter than one reload. Use `--speed 1` to stay here.
2. **Live, no flag (state 2).** Discovery polls the recorded scoreboard every 30s of real time,
   so `game_state` lines start 0–30s after kickoff. Home shows "Your next flag is incoming" with
   PHI @ CHI under YOUR LIVE GAMES. Score and field position move with each `game_state`.
3. **Flag (state 1).** On `flag_added`, the NOW ACTIVE card switches to PHI @ CHI with the
   flagged player and a watch button. Observed: "Saquon Barkley active — RB · Eagles",
   Q1 8:42, about 45s in.
4. **Flag cleared.** On `flag_removed`, the card drops and Home goes back to state 2, or to the
   next flag if another game is flagged.
5. **Final (~9 min).** The served scoreboard takes the game's status from the summary at the same
   instant, because the recorded scoreboard was polled about once a minute and this one stops at
   0:39 Q4. Within 30s of the final summary frame, discovery marks the game final and the script
   prints `final`. The game leaves `/games/live` and Home's live list on the next reload. The
   recording then holds on its last frame until you stop the script.

## Ctrl+C

Stops the runner, then undoes everything the replay wrote:

- Redis: `game_state:{game}`, `user_flag_state:*:{game}`, `espn_seen_plays:{espnId}`,
  `resumption_open:{game}`, this game's `flag_event_queue` members, the replay's
  `user_notifications` entries, and the leader key if the replay holds it.
- Postgres: the replay's `flag_events` rows for this game, plus the game's `week`,
  `season_type`, `scheduled_start`, and `status`, which go back to their original values.

The rows written by the runner's stake rebuild (`users_with_stake:*`, `user_lineup_cache:*`) and
by the airings ingest are the same ones a normal runner writes. They are left in place. Push is
forced to `none`. A second Ctrl+C exits without cleanup. If the process dies without cleaning up,
the next run refuses and prints the `update games …` statement that restores the row.
