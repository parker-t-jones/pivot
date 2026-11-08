# P2 — Picks model: player props, team/game props, parlays, live bets

Issue #10. Builds on #9 (`stake_spent_slots`, kickoff lock). `PIVOT-STAKES-PLAN.md` §0 Guardrails apply in full. Entry UI is #11 and #12; this doc covers the data model, engine activity and progress, settlement, and the API.

Decisions recorded Nov 8, 2026 (Parker): possession nudges ignore resolution (§6), removed parlays are tracked with `stake_spent_slots.slot_kind` (§3), no progress push in v1 (§6), Q4 excludes OT and H2 includes it (§1).

## 1. Pick catalog

Every pick is a row in `stakes` and is tied to exactly one game. A parlay is a `pick_slips` row; its legs are `stakes` rows with `slip_id` set.

### Player props (`subject: { type: 'PLAYER', playerId, teamId }`)

| Prop                            | Condition                                                | ESPN source (summary `boxscore.players[].statistics`)                        |
| ------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Passing yards                   | `STAT_OVER`/`STAT_UNDER`, `stat: 'PASS_YDS'`             | passing `passingYards`                                                       |
| Completions                     | `PASS_COMP`                                              | passing `completions/passingAttempts`, left of `/`                           |
| Pass attempts                   | `PASS_ATT`                                               | same cell, right of `/`                                                      |
| Passing TDs                     | `PASS_TD`                                                | passing `passingTouchdowns`                                                  |
| Interceptions thrown            | `INT_THROWN`                                             | **passing** `interceptions` (not the defensive group)                        |
| Rushing yards / attempts        | `RUSH_YDS` / `RUSH_ATT`                                  | rushing `rushingYards` / `rushingAttempts`                                   |
| Receiving yards / receptions    | `REC_YDS` / `RECEPTIONS`                                 | receiving `receivingYards` / `receptions`                                    |
| TDs scored (e.g. 2+ = over 1.5) | `ANY_TD`                                                 | rushing + receiving + kick/punt return + defensive + interception-return TDs |
| FGs made                        | `FG_MADE`                                                | kicking `fieldGoalsMade/fieldGoalAttempts`, left of `/`                      |
| Kicking points                  | `KICK_PTS`                                               | kicking `totalKickingPoints`                                                 |
| Anytime TD                      | `PLAYER_EVENT`, `event: 'ANY_TD'`, `side: 'YES' \| 'NO'` | `ANY_TD` ≥ 1                                                                 |
| First TD                        | `PLAYER_EVENT`, `event: 'FIRST_TD'`, `side`              | §5                                                                           |

Lines are multiples of 0.5. An integer line can land exactly, which is a tie.

### Team and game props

| Prop                                  | Subject      | Condition                                                 | ESPN source                                       |
| ------------------------------------- | ------------ | --------------------------------------------------------- | ------------------------------------------------- |
| Team total (full game, quarter, half) | TEAM         | `TEAM_TOTAL_OVER`/`TEAM_TOTAL_UNDER` `{ line, segment? }` | `header.competitions[0].competitors[].linescores` |
| First team to score                   | TEAM         | `FIRST_TO_SCORE`                                          | `scoringPlays[0].team`                            |
| Quarter / half spread                 | TEAM         | `SPREAD { line, segment }`                                | linescores                                        |
| Quarter / half total                  | GAME         | `TOTAL_OVER`/`TOTAL_UNDER { line, segment }`              | linescores                                        |
| Total FGs (game or one team)          | GAME or TEAM | `FG_OVER`/`FG_UNDER { line, segment? }`                   | `scoringPlays` whose type is a field goal         |

`segment` is `Q1 | Q2 | Q3 | Q4 | H1 | H2`. With no segment, the pick covers the full game including OT, which is how the existing spread, total, and moneyline picks already work; they are unchanged. **Q4 excludes OT. H2 includes OT** (the common US book rule).

### Excluded, and why

- Longest rush, reception, or FG; rush + receiving yards; last TD scorer; first scoring play type; tackles and sacks. ESPN can decide these, but #10 doesn't ask for them. Each is a small addition later.
- Anything not in the summary boxscore (snap counts, routes, targets vs. air yards). ESPN doesn't publish it there.
- Quarter and half moneylines, and 3-way lines. Not requested, and 3-way needs a tie as an outcome.
- Cross-week parlays, and parlays that contain survivor or fantasy rows. A slip is one season and week of bet legs. Survivor stays a weekly pool pick.
- Odds, payouts, and amounts. Pivot tracks outcomes, not money (Guardrail §0.7).
- Post-game stat corrections. Results settle on ESPN's final summary. A correction ESPN makes days later is not applied.

## 2. Parlays (slips)

- Created in one request with 2–12 legs, all in the same season and week. Each leg is validated exactly like a single pick. Legs may share a game (same-game parlay).
- Immutable. There is no adding or removing legs. `DELETE /stakes/:id` on a leg returns **409 `pick_in_slip`**. The whole slip is removed with `DELETE /picks/slips/:id`.
- Status from its legs: `lost` once any leg has lost or missed. `won` when every leg that isn't refunded has won. Tie and void legs drop out ("refunded"). A slip whose every leg is refunded is `void`.
- Live summary returned with the slip: `{ status, legs, hit, alive, lost, refunded }`.

## 3. Free cap and kickoff lock (builds on #9)

- **Slot unit:** `slip_id` for a leg, the stake's own id otherwise. Survivor and fantasy rows never use a slot (unchanged).
- `used = |distinct slot ids among the week's counted rows| + |spent rows whose slot id is not still live|`. This is #9's rule, keyed by slot id instead of stake id.
- A slip has **kicked off** when any leg's game has (`gameHasKickedOff` in `services/api/src/lib/kickoff.ts`). Deleting a slip after that writes one `stake_spent_slots` row with `slot_kind = 'slip'`, `stake_id` = the slip id, and `game_id` = the earliest leg's game. Deleting before kickoff refunds the slot.
- **Live bets:** `POST` accepts in-progress games (the existing rule; `final` is rejected). A pick or slip added after kickoff counts and can't be refunded, because kickoff is already past. The API never checks the pick against the current game state: rejecting a pick that has "already cleared" would reveal that it has.
- Over the cap: the existing **403 `stake_limit_free`**.

## 4. Activity and priority

**Active means:**

- **Player prop:** the fantasy rule, unchanged. `computeFlagState` runs on a one-player cache (the same `onePlayerCache` the `ROSTERED` evaluator uses), built from the player's team and side of the ball. Every position except `DEF` is offense, including K and the QB on `INT_THROWN`, which matches `rebuildUserLineupCache`.
- **Team prop:** that team has the ball while the pick's segment is being played. Once the pick is decided (for `FIRST_TO_SCORE`, after the first score) its leverage drops to 0, but it still counts as active for the nudge (§6).
- **Full-game game-level prop:** the existing late-game rules (`lateGame.ts`, Q4 or OT).
- **Segment prop (Q1–Q4, H1, H2):** the segment is being played, with a "late" stretch in its last 5:00 (quarters) or its last quarter (H1 = Q2, H2 = Q4 and OT).

**Leverage** feeds the existing `betPriorityScore = max(1, round(leverage × 12))`:

- Player prop: `priorityToLeverage(flag.priorityScore) × (0.5 + 0.5 × proximity)`. For an over, `proximity = 1 − min(needed / (2 × bigPlay), 1)`, with bigPlay = 15 rush yds, 25 rec yds, 40 pass yds, 1 for counts. For an under, it measures how close the stat is to going over the line. TD props get +0.25 in the red zone, capped at 1.
- Team prop: 0.6 with the ball, 0.9 in the red zone.
- Game-level: existing `lateGameLeverage`.
- A slip ranks a game **once** (the max over its legs in that game), so a 6-leg same-game parlay doesn't outweigh everything else. The leg's leverage is ×1.0 when it is the slip's last undecided leg and ×0.8 otherwise.

## 5. Progress, settlement, first TD

`pickProgress(stake, stats, game)` is pure and returns `{ status, current?, line?, needed? }`:

| Status                 | Meaning                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `pending`              | Game not started, or no stats yet                                                                 |
| `live`                 | Undecided                                                                                         |
| `hit` / `missed`       | Decided during play: an over cleared, an under went over, someone else scored the first TD        |
| `won` / `lost` / `tie` | Once the game is final, or for a quarter or H1 pick, once play has moved past its segment         |
| `void`                 | The player has an `espn_id` and isn't in the final boxscore (did not play). Copy says "refunded". |
| `unavailable`          | No ESPN match for the player. Never voids and never triggers.                                     |

- If a stat correction drops a `hit` back below the line, the pick returns to `live`. That causes no crash and no duplicate fire.
- **Player matching:** `players.espn_id` first. Fallback: normalized first + last name against `athlete.displayName` within the player's team's boxscore group.
- **First TD:** the first entry in `scoringPlays` with a touchdown scoring type. The scorer is the name its `text` starts with ("Christian Watson 4 Yd pass from Jordan Love"), matched within that team's boxscore athletes (longest matching name wins). No TD in the game: YES loses, NO wins. No match: `unavailable`.
- **Settlement:** when the runner sees `final`, it writes `stakes.result`, `result_value`, `settled_at`, and the slip's `result` (service role). Live progress is never persisted.

## 6. Nudge vs. reveal

| Trigger                                                                  | Kind   | When                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROP_LIVE_POSSESSION` (player prop), `TEAM_PROP_POSSESSION` (team prop) | NUDGE  | The pick is active. **Whether or not it's already decided, and whether or not its slip is alive.** A nudge that stopped coming once the over cleared or the parlay died would tell the user the outcome before their stream shows it. This corrects `PIVOT-STAKES-PLAN.md` §3, which said "while prop is unresolved and near". Copy is the existing `bet_in_play`: "Your {label} is in play." The label is the user's own pick, never progress. |
| `PROP_NEAR` (over), `PROP_DANGER` (under)                                | REVEAL | Live, undecided, and the stat is ≥ 80% of the line or within one big play of it. Goes through `ResumptionGatedDispatcher`, like every bet event: with no possession window open, it waits for the next real snap (this answers §9 Q4).                                                                                                                                                                                                          |
| Segment `SPREAD_SWING` / `TOTAL_SWING`                                   | REVEAL | The existing rules, applied to the segment's late stretch. Same gate.                                                                                                                                                                                                                                                                                                                                                                           |
| Results, "leg 2 of 4 alive"                                              | —      | **In-app only in v1.** No push. `GAME_FINAL` stays off.                                                                                                                                                                                                                                                                                                                                                                                         |

Every trigger fires at most once per pick per game (`claimFirstFire`, unchanged). Per-drive dedupe still needs a drive id on `GameState`.

**In-app:** `GET /picks` returns live progress from the Redis snapshot `game_player_stats:{gameId}`, which the runner writes on each summary poll. That is the same live, unheld path `GET /games/live` uses for the scores on Home. Anything in a push goes through the gate.

## 7. API

- `POST /picks`: a single pick `{ pick }` or a parlay `{ legs: [...] }`. Accepts every bet type, including the existing four. Survivor can't be a leg. It validates that the player is active and on one of the game's teams, that the line is a multiple of 0.5 inside the stat's range, and that the same pick doesn't already exist.
- `GET /picks?week=` returns the singles, the slips with their legs and summary, progress for each pick, `free_slots_used`, and `free_limit`.
- `DELETE /picks/slips/:id`. Single picks are still deleted with `DELETE /stakes/:id`.
- Demo account: writes are refused with `demo_account_fixed`. `GET /picks` returns the demo fixture's picks with no slips.

**Old iOS builds:** `POST /stakes` and `DELETE /stakes/:id` keep their behavior. `GET /stakes` returns only legacy-shaped rows (one of the four existing types, no `segment`, no slip, not a player subject) and adds the slots that the hidden new rows use to `free_slots_spent`, so an old build's "free left" stays correct.

## 8. Data model

Migration `20261109120000_picks_props_parlays.sql`:

- `players.espn_id` (unique where set), filled by `pnpm seed:players` from Sleeper's `espn_id`.
- `pick_slips` (RLS on, service role only).
- `stakes.slip_id`, `result`, `result_value`, `settled_at`. The condition CHECK is widened to the new types, plus a CHECK that a leg is never fantasy or survivor.
- `stake_spent_slots.slot_kind` (`stake` | `slip`).

Shared types live in `shared/src/types/picks.ts`. The engine's `stakes/types.ts` re-exports them.
