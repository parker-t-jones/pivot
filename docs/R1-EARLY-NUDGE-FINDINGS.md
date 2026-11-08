# R1 — Firing the possession nudge on the possession-ending play

Issue #6. Experiment only: no production code changed here. The gate bug this replay found (§4) was fixed separately in #22, now merged to `main`. "Today" below means `main` with that fix (replay rerun on `main` after the merge), and the pre-fix numbers are kept next to them. Replay: `experiments/replay-early-nudge.ts` (pure logic in `experiments/earlyNudge.ts`, tests in `experiments/earlyNudge.test.ts`).

## Summary

- **End-of-play detection would send the possession nudge a median 55s sooner** (p10 31s, p90 194s) than today's runner, across 108 possession changes in 9 recorded games. Before #22 the gap was 87s.
- **Today the nudge reaches the queue a median 109s after the possession-ending play happened** (its ESPN `wallclock`; 139s before #22). Under end-of-play detection it would be **53s** (p10 41s, p90 73s). That 53s is almost entirely ESPN's own publish lag (median 45s).
- **The replay found a gate bug, now fixed in #22.** After a touchdown, the receiving team's first-snap `flag_added` was parked until the _second_ snap arrived (27 of 27 TD kickoffs in the data). That matches "usually lands on 2nd down, sometimes 3rd". See [§4](#4-the-gate-held-kickoff-drives-until-the-second-snap-fixed-in-22). With the fix, kickoff drives push on the first snap, and the kickoff gap to end-of-play detection drops from 78s to 41s.
- **`end.team` was present on every live play** (850 of 850). It was wrong on first publication once: a muffed punt where a penalty forced a re-kick.
- **End-of-play detection adds 7 false nudges**, against 108 real changes. All 7 fall into two shapes that simple guards remove in this data: return touchdowns, and turnovers or punts with 0:10 or less left in Q2/Q4.
- **The scoreboard endpoint is not meaningfully faster.** When its `lastPlay` was ahead of the summary, the lead was a median 5.6s (p90 15s): one to three summary polls. Not worth a new source. It is useful as a cross-check, and it caught the muffed-punt case correctly.

## Correction to the issue

The issue says the recordings are summary-only. They are not. The recorder (`experiments/espn-live-recorder.ts:55-56`) polled summaries every 5s and the scoreboard every 60s, and every date folder has a `scoreboard/` directory. Those snapshots carry `situation.possession` and `situation.lastPlay` (with `end.team`). That made a partial offline scoreboard comparison possible (§6).

## 1. Data

| date       | game      | summary snapshots | live arrivals | backfilled | changes (all) |
| ---------- | --------- | ----------------- | ------------- | ---------- | ------------- |
| 2026-09-27 | 401872949 | 255               | 33            | 172        | 23            |
| 2026-09-27 | 401872950 | 185               | 23            | 150        | 16            |
| 2026-09-27 | 401872958 | 851               | 159           | 39         | 17            |
| 2026-09-27 | 401872959 | 839               | 146           | 45         | 25            |
| 2026-09-27 | 401872962 | 953               | 193           | 17         | 20            |
| 2026-09-28 | 401872963 | 797               | 166           | 0          | 16            |
| 2026-10-11 | 401872989 | 380               | 86            | 100        | 25            |
| 2026-10-11 | 401872991 | 417               | 97            | 92         | 21            |
| 2026-10-11 | 401872992 | 467               | 89            | 87         | 24            |

Skipped: `2026-09-25/401872948` (7 snapshots, already final) and `2026-10-11/401872993` (still pregame when the disk guard stopped the recorder).

A play counts as **backfilled** when it first appears in a game's first snapshot, or right after a summary-poll gap longer than 30s. Its `seenAt` is then the recorder's catch-up time, not a real arrival. Gaps come from the index's successful polls; `status: "error"` polls don't count. A possession change counts only when every play from the preceding play to the push play is live. 110 of the 187 changes qualify.

The two big backfills deserve a note. Games 949/950 have a ~2.8h recorder outage. On Sep 27, 958/959 have a long run of `fetch failed` in `recorder.log`: the Mac lost network for about 75 minutes. It is not an ESPN stall. As a safety net, the replay also flags any play first seen more than 10 minutes after its wallclock while polling was healthy. There were none.

## 2. Method

"Today" is not re-derived. For each game, the replay feeds plays in first-seen order through the real `IncrementalResumptionTracker`, the real `ResumptionGatedDispatcher`, and the real `applyPlayToState`. It calls them in the order `services/api/src/runner/playSession.ts` does: `beginPlay(gameId, playType)` → `releaseMidDrive` (real-action plays) → `tracker.observe` → stake pass → `endPlay`. The clock is set to the play's `seenAt`. The `ResumptionCeiling` silence timer and the gate's mid-drive ceiling are both simulated at 4 minutes.

The one stand-in is the stake pass. Each team gets one synthetic user whose flag is on while that team's offense is on the field ("your RB's team has the ball"). That user gets `flag_added` when the flag turns on and `flag_removed` when it turns off, both dispatched through the gate. Today's push time is when the gate enqueues the receiving team's first `flag_added` after the possession change.

**Early** is the `seenAt` of the first non-procedural play whose `end.team` differs from the team that had the ball after the previous play. Timeouts and period ends are skipped, because ESPN's team fields on those entries are unreliable. A nudge fires immediately; it is a routing NUDGE.

Both models ignore the dispatcher's 500ms tick and delivery latency (APNs / Web Push), which they share.

## 3. Results

Publish lag (`seenAt − wallclock`, 992 live plays): **median 45.2s, p10 30.9s, p90 62.3s**. This matches the issue's PHI measurement.

### Seconds gained (today's push − early nudge)

| ended by               | n   | median                                | p10   | p90   | before #22: median (p10–p90) |
| ---------------------- | --- | ------------------------------------- | ----- | ----- | ---------------------------- |
| **all**                | 108 | **54.5**                              | 31.0  | 194.4 | 87.0 (35.5–198.9)            |
| punt                   | 40  | 174.9                                 | 36.4  | 202.1 | unchanged                    |
| kickoff after score    | 44  | 40.8                                  | 27.2  | 67.5  | 77.7 (34.8–147.4)            |
| turnover (INT, fumble) | 13  | 51.9                                  | 22.9  | 188.7 | unchanged                    |
| turnover on downs      | 7   | 63.3                                  | 47.5  | 202.2 | 63.3 (47.5–214.7)            |
| missed FG              | 4   | 185.8                                 | 173.5 | 212.1 | unchanged                    |
| end of half            | 1   | today never pushes (window `ABORTED`) |       |       |                              |

End of half means the second-half kickoff. Today's tracker aborts that window. End-of-play detection would nudge on the kickoff. The 1 change with no matched early nudge is the muffed punt (§5).

The punt and missed-FG gains are large because the next snap is far away in real time. The median from a punt to the next scrimmage play is 180s of wallclock, which is the TV break. Today's push waits for that snap to show up in ESPN's feed; the early nudge goes out about 50s after the punt. From kickoff to the first snap, the median is 47s.

The replay also reports the gain against a gate that always pushes on the new team's first snap. With #22 that matches today's column exactly, so all of the remaining gain is detection.

### When the push goes out, relative to the possession-ending play's wallclock

| ended by            | today median (p10–p90) | before #22          | early median (p10–p90) |
| ------------------- | ---------------------- | ------------------- | ---------------------- |
| all                 | 109.1 (87.6–247.9)     | 139.3 (92.2–253.9)  | 53.3 (41.3–72.5)       |
| punt                | 228.3 (96.1–250.6)     | unchanged           | 51.2 (39.1–68.4)       |
| kickoff after score | 93.6 (82.1–121.9)      | 132.4 (90.8–211.3)  | 52.9 (45.0–65.1)       |
| turnover            | 127.5 (105.7–274.5)    | unchanged           | 76.1 (58.2–121.7)      |
| turnover on downs   | 114.8 (101.1–252.3)    | 114.8 (101.1–264.8) | 52.0 (49.8–57.8)       |
| missed FG           | 229.5 (220.0–254.8)    | unchanged           | 42.0 (38.6–51.8)       |

The user's stream delay behind real time was not measured. If it is D seconds, the early nudge arrives about `53 − D` seconds after the possession-ending play airs, which is before it airs when D > 53s. Today's push arrives about `109 − D` after (`139 − D` before #22). The early nudge can beat the broadcast; Parker accepted that on Nov 8. Turnovers are slower in both models: ESPN publishes interception and fumble plays later than other plays (early median 76s versus about 52s).

## 4. The gate held kickoff drives until the second snap (fixed in #22)

The gate's decision for each pushed change, before and after #22:

| ended by (preceding drive result) | before #22                                   | n            | after #22                    |
| --------------------------------- | -------------------------------------------- | ------------ | ---------------------------- |
| punt                              | `fire_immediately` (REAL_ACTION)             | 40           | same                         |
| **kickoff after Touchdown**       | **`held_pending_resumption`, no resolution** | **27 of 27** | **`fire_immediately`**       |
| kickoff after Field Goal          | `fire_immediately` (carry-over)              | 14           | same                         |
| kickoff after Field Goal          | `held_pending_resumption`, no resolution     | 3            | `fire_immediately`           |
| turnover / downs / missed FG      | `fire_immediately`                           | 23           | same                         |
| downs, punt (one each)            | `held_pending_resumption`                    | 2            | downs fires; punt still held |

The root cause was in `services/dispatcher/src/resumptionGate.ts`. The resolution is game-scoped, and the first dispatch on or after the resolving play claimed it, whichever user that dispatch was for.

1. **TD → kickoff.** The tracker resolves `REAL_ACTION` on the kickoff. On that same play, the scoring team's offense flag turns off, and its `flag_removed` was dispatched with the resolution. It is not push-eligible, but `endPlay` counted it as dispatched and deleted both `resolutionThisPlay` and `carryOverResolution`. The receiver's first-snap `flag_added` then found no resolution, went to `parkMidDrive`, and was released only when the next real play arrived: the second snap.
2. **FG → kickoff → timeout → snap.** `beginPlay` kept a resolution for exactly one play (`carryOverResolution`). A TV timeout between the kickoff and the snap used up that play, so the same mid-drive hold followed: 3 of 17 FG kickoffs. A pre-snap penalty did the same; that was the one downs case.
3. **Only the first event on the snap got the carry-over.** Found while fixing; the replay can't show it, because it has one user per team. With several users in a game, every user but one waited for the second snap.

#22 makes only a push-eligible event spend the resolution, lets timeouts, period ends and pre-snap penalties pass without aging the carry-over (`playSession` now passes the play type to `beginPlay`), and lets the carry-over cover every event on its snap. The remaining held punt is a fumble-return touchdown on the receiving team's first play, followed by a kickoff back to that team: a return-TD shape outside #22.

The replay tests `kickoff after a TD: the first-snap flag fires with the kickoff resolution` and `kickoff after a FG: the carry-over fires on the first snap, even after a timeout` pin the fixed behavior. #22 has the gate-level and runner-level tests.

## 5. Edge cases

Counts are for live plays and changes unless noted.

| case                                            | count                                                                              | what `end.team` did                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plays missing `end.team`                        | 0 of 850 non-procedural                                                            | –                                                                                                                                                                                                                                                                                                                                                                             |
| plays missing `wallclock`                       | 0 of 992                                                                           | –                                                                                                                                                                                                                                                                                                                                                                             |
| `end.team` changed in a later snapshot          | 1                                                                                  | Muffed punt (401872962 `4018729623118`). First published with DEN recovering (`end.team` DEN). A penalty forced a re-kick, and `end.team` was revised to LAR. **One false nudge.** The re-kick then went to DEN anyway; with first-seen semantics no second nudge fires, which is the 1 "no early nudge" change. The scoreboard said "LAR 4th & 19" throughout and was right. |
| plays deleted later                             | 0                                                                                  | –                                                                                                                                                                                                                                                                                                                                                                             |
| replay reviews (reversed / upheld / challenged) | 13                                                                                 | None changed `end.team`. Two reversed TDs kept the same team on the ball. No turnover was overturned in this data.                                                                                                                                                                                                                                                            |
| onside kicks                                    | 0 live (1 during a recorder outage, 401872958: `end.team` = receiving SF, correct) | –                                                                                                                                                                                                                                                                                                                                                                             |
| muffed punts                                    | 2                                                                                  | Recovered by the kicking team (ARI): `end.team` unchanged, so no nudge, which is correct. The second is the revised case above.                                                                                                                                                                                                                                               |
| safeties                                        | 0                                                                                  | not observed                                                                                                                                                                                                                                                                                                                                                                  |
| return touchdowns (punt, INT, fumble)           | 3                                                                                  | The return play's `end.team` is the scorer, who never runs an offensive snap: **3 false nudges**. The following kickoff then correctly nudges the original team. Today's tracker opens no window for those kickoffs (same team before and after), so today they push only through the mid-drive path.                                                                         |
| change with 0:10 or less left in Q2/Q4          | 4 (3 live)                                                                         | Punt at 0:06 Q2, interceptions at 0:03 Q2, 0:08 Q4, and 0:02 Q4: **3 live false nudges** for teams that never snap. The second-half kickoff then correctly nudges the receiver.                                                                                                                                                                                               |

That makes 7 false nudges against 108 real ones. In this data, two guards remove 6 of them with no lost real nudges:

- **No early nudge on a scoring play.** Every matched early nudge fired on a kickoff, punt, turnover, missed FG, or failed fourth down; none fired on a scoring play.
- **No early nudge in Q2/Q4 with the play's start clock at 0:10 or less.** Fall back to today's next-snap path, whose `end_half`/`end_game` abort already handles it. This rule matched exactly the 4 cases above and nothing else.

The remaining false-nudge shape is the revised muff. It happened once in 110 live possession changes, and the cost is one wrong "has the ball" nudge.

## 6. Scoreboard vs summary

From 1,013 in-progress scoreboard samples (60s polls) with a `lastPlay`, compared against the summary stream at the same moment:

- **Ahead in 192 samples (19%):** the scoreboard's `lastPlay` wasn't in any summary yet. The lead was a median of 5.6s (p10 0.7s, p90 15.1s).
- **Level in 789:** both showed the same latest play.
- **Stale in 4:** the summary already had a later play (median 47s).
- **Never in the summary in 28:** the `lastPlay` id never appeared in any summary snapshot.
- **`situation.possession` disagreed with the summary's `end.team` in 12 of 770 samples.** In 9, the scoreboard showed the new possession 0.1–16s before the summary did. The other 3 were consecutive samples of the muffed punt, where the scoreboard was right and the summary's first `end.team` was wrong.

So the scoreboard is sometimes a poll or two ahead, but by seconds, not the ~45s publish lag. It is the same pipeline behind a different cache. It isn't worth adding as a detection source for speed. It is a cheap veto for the rare `end.team` that ESPN later revises.

These samples are 60s apart, so they show how often and by how much the scoreboard leads at a random moment. They do not give per-play first-appearance latency. Measuring that live would need:

- Run `experiments/espn-live-recorder.ts` with `SCOREBOARD_INTERVAL_MS` lowered to 5000 (it is a constant at `:56`), so both endpoints are polled at the same cadence. One full slate is enough.
- Also record the response `Age` / `Cache-Control` / `Date` headers for both endpoints, to tell CDN caching apart from upstream lag.
- Disk: the 60s scoreboard was ~270KB per changed poll. At 5s, expect on the order of 1–2GB per slate before gzip dedupe. The recorder's disk guard stopped the Oct 11 run at 2.9GB free, so free space first.
- Then compute, for each play id, the first-seen time on each endpoint. `compareScoreboard` in `experiments/earlyNudge.ts` already does the pairing.

## 7. Proposal for R2

The detection moves to the play that ends the possession, and the possession nudge stops going through resumption timing, because it reveals no outcome.

1. **`@pivot/ingestion`.** Add an optional `end: { team: { id } }` to the play schema in `services/ingestion/src/espn/espnTypes.ts`. Today the schema strips it, next to `espnPlayStartSchema` (`:40`). `EspnGameContext` gains an ESPN team id → abbreviation map, built in `resolveGameContext` from `header.competitions[0].competitors`. `mapEspnPlay` sets a new `PlayEvent.endPossessionTeamId: TeamId | null` (null on `NO_POSSESSION_PLAY_TYPES`). The engine still never sees ESPN shapes.
2. **`@pivot/engine`.** In `applyPlayToState`, when a non-procedural play's `endPossessionTeamId` differs from the play's possessing team (or, on a kickoff, from the kicking team), set the state after that play to `possessionTeamId = endPossessionTeamId` with `unitOnField = 'offense'`. Suppress this on scoring plays and with 0:10 or less left in Q2/Q4 (§5). This one change handles kickoff drives too: the receiver's offense flag turns on on the kickoff itself, a full play before the first snap, so no kickoff special case is needed downstream. `computeFlagState` and `diffFlagStates` are unchanged. The tracker keeps comparing `possessionTeamId`, so its windows now open on the possession-ending play, which is still what REVEAL timing wants.
3. **`@pivot/dispatcher`.** A `flag_added` produced by a possession change is a NUDGE, so `ResumptionGatedDispatcher.dispatch` sends it with `fire_immediately` instead of parking it in the window. REVEAL events keep going through the window exactly as today. Two decisions for R2:
   - how to tag the event (a `trigger: 'possession'` on `FlagEvent`, or a reason code);
   - the §4 gate bug is already fixed on `main` (#22), so R2 starts from first-snap timing.
4. **Copy.** The nudge must stay a nudge: "{Team} has the ball", never "after a punt / interception". Even so, it implies the previous drive ended, before some streams show it. Parker accepted that trade on Nov 8, and it is noted here so R2's copy review doesn't rediscover it.
5. **Revisions.** A nudge can't be recalled. R2 can optionally compare against `situation.possession` from one scoreboard fetch before firing on a turnover or muff. That would have caught the single revised case. That costs one extra request per change and about 0–15s; skip it unless false alarms show up live.

R2 tests should reuse this replay. Run it with the new mapping and the gate change, and assert that the early column becomes today's column.

## 8. What this does not show

- **Small sample:** 9 games and 108 measured changes, from three slates. 3 games are partly backfilled (Oct 11 started mid-game; 949/950 mostly lost). No safeties, no live onside kick, no overturned turnover.
- **`seenAt` is the recorder's poll time on Parker's Mac,** not the Fly runner's. Polling cadence (5s) is the same as production; network path and timing are not.
- **Synthetic stakes.** One flag per team, with no real users, bet triggers, or priority changes. Real stake passes dispatch more events per play; the pre-#22 numbers therefore understate how often the old gate held a push (§4, point 3).
- **Unmeasured:** delivery latency (APNs / Web Push), the dispatcher tick, and the user's stream delay. The push-versus-broadcast comparison is therefore given in terms of an unknown D.
- **Scoreboard per-play latency** needs the live capture described in §6.

## Reproduce

```bash
pnpm build
npx tsx experiments/replay-early-nudge.ts --detail
```

It reads `experiments/logs/recordings/`, which is gitignored and exists only on Parker's Mac. It prints all of the tables above, the edge-case lists, and a per-change detail table. `pnpm test` runs `experiments/earlyNudge.test.ts` without the recordings.
