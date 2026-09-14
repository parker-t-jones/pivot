# Live Sunday test — findings log (1pm ET slate, Sept 13, 2026)

Running notes captured *during* today's live multi-game test (`experiments/live-sunday-harness.ts`,
Bills @ Texans + Bears @ Panthers). Observations flagged by Parker mid-game, root-caused against the
actual code and the run's `experiments/logs/*.jsonl`, and where practical fixed live (real code
changes to `services/engine`, not just harness patches) without stopping the test. Line/file refs are
to the repo state as of this run.

## Data

Two independent, timestamp-aligned logs from this slate — the system's own account of what it did,
and a human's live account of what actually appeared on the broadcast. Both share one time source
(same machine, `Date.now()`/local wall clock, no drift correction needed) so they can be lined up
directly. Findings below cite both.

| | Live harness (system side) | Mark-visible marks (human ground truth) |
|---|---|---|
| **Readable file** | [`experiments/logs/live-harness-run-1pm-2026-09-13.log`](./logs/live-harness-run-1pm-2026-09-13.log) | [`experiments/logs/mark-visible-1pm-2026-09-13.log`](./logs/mark-visible-1pm-2026-09-13.log) |
| **Raw/machine file** | `experiments/logs/plays-2026-09-13T18-56-05-002Z.jsonl` + `events-2026-09-13T18-56-05-002Z.jsonl` (this run's final restart) | `experiments/logs/markers-2026-09-13T18-02-22-807Z.jsonl` |
| **Produced by** | `experiments/live-sunday-harness.ts` stdout — every normalized ESPN play, every `watchForResumption` decision, every dispatched push | `experiments/mark-visible.ts` — Parker hitting Enter (optionally with a note) the instant a play became visible on the CBS/FOX broadcast |
| **Format** | Plain text, one line per play/event, local ET wall-clock timestamps (`[HH:MM:SS.mmm]`) | Readable file: same `[HH:MM:SS.mmm] #N note` shape, generated from the raw JSONL (`{wall, index, note}`, epoch ms) |
| **Volume** | ~600 play/event lines across both games, full slate through both `end_game`s | 30 marks |
| **Answers** | *What did the pipeline do, and exactly when* (resumption outcome, hold time, push sent/dropped) | *What did the human actually see, and exactly when* — plus live running commentary on whether each push made sense |
| **Status** | Final — harness exited clean (`exit_code 0`) after both games went final, ~4:36pm ET | Live snapshot as of ~4:55pm ET; `mark-visible.ts` (terminal 34, pid 10312) is still running, so the raw JSONL may gain more marks if Parker watches/marks later games — re-render the readable copy from it if so |

## Status summary

| # | Finding | Status |
|---|---|---|
| 1 | Mid-drive timeouts flap the flag off/on with no possession change | **FIXED** (~2:43pm ET) |
| 1a | Same symptom, second cause: `no_play` (pre-snap penalty) also flapped the flag | **FIXED** (~2:56pm ET) |
| 1b | `flag_removed` push copy names the wrong team on a real possession change | **Open, root-caused, NOT a side effect of 1/1a** — confirmed reproducible, see below |
| 2 | Kickoffs resolve the resumption window before the `flag_added` event they're meant to gate exists | **FIXED** (~5:20pm ET, post-slate follow-up — harness-only, `experiments/resumptionGate.ts`) |

---

## Finding 1: Mid-drive timeouts flap the flag off and back on with no possession change

**STATUS: FIXED live, mid-test (Sept 13, 2026, ~2:43pm ET).** See "Fix applied" below.

**Symptom (reported live):** Repeated "Texans RB1 active" / "Texans RB1 no longer active" pushes
while Houston retained the ball across a timeout, with no actual turnover. Reported a second time for
the Bears game (CHI bouncing active/not-active while remaining on offense) — same root cause,
confirmed against the Bears/Panthers play log too.

**Confirmed in the logs** (`plays-2026-09-13T*.jsonl` / `events-2026-09-13T*.jsonl`, game
`401872660`):

```
...HOU 1&10 (run) → HOU 2&4 → HOU 3&1 → [[TIMEOUT]] → HOU 1&10 (pass) → HOU 2&5 → HOU 3&2 → punt
```

Matching `events.jsonl` entries around the timeout (wall-clock `1789323244056`):

- `flag_added` "Texans have the ball — Q2, 3:33" fired *before* the timeout.
- `flag_removed` "Possession has changed." fired **at the same timestamp as the timeout play**,
  even though Houston had the ball on the very next snap.
- `flag_added` "Texans have the ball — Q2, 3:05" fired again on that next snap — same team,
  same drive.

**Root cause:**

- `services/engine/src/applyPlayToState.ts`'s `unitOnFieldFor()`:
  ```ts
  function unitOnFieldFor(play: PlayEvent): UnitOnField {
    if (play.possessionTeamId === null) return 'none';
    ...
  }
  ```
  Every `timeout` play (and `end_period`) carries `possessionTeamId: null` — that's true for every
  provider mapping today, not just ESPN's — so it always evaluates to `unitOnField: 'none'`.
- `services/engine/src/computeFlagState.ts`'s offense rule requires
  `state.unitOnField === 'offense'` to set `flagged`. A timeout momentarily zeroes `unitOnField`,
  so `flagged` drops to `false` for that one play, then flips back to `true` on the team's next
  offensive snap — producing a spurious `flag_removed` → `flag_added` pair around *every* mid-drive
  timeout, independent of whether possession actually changed.
- This is a real gap in `computeFlagState`/`applyPlayToState`, not a harness artifact — the harness
  just made it visible by delivering real pushes instead of only logging.

**Fix applied** (`services/engine/src/applyPlayToState.ts`, `possessionFieldsFor`): a play with
`possessionTeamId === null` now carries `possessionTeamId`, `unitOnField`, `yardsToOpponentEndzone`,
`down`, `distance`, and `inRedZone` forward from the previous `GameState` when
`classifyPlayType(play.playType) === 'SKIP_AND_WAIT'` (i.e. `timeout` / `end_period`, reusing
`resumptionWatcher.ts`'s own categorization rather than re-deriving it). `ABORT` plays (`end_half` /
`end_game`) deliberately still reset to `null`/`'none'` — those are real intermissions.

Verified two ways before restarting the live run:
- `services/engine/src/applyPlayToState.test.ts` — added 6 new cases (carries forward through
  `timeout` and `end_period`; does NOT carry forward through `end_half` / `end_game`; no-op with no
  `previous`; a genuine possession change still updates normally). Full suite:
  **121/121 passing**, including the existing real-game (KC @ LV 2024) integration replay.
- Replayed this run's actual Bears/Panthers `plays-*.jsonl` through the rebuilt
  `applyPlayToState`/`computeFlagState` directly: every mid-drive timeout where CHI kept the ball
  before and after now shows `flagged` staying `true` uninterrupted through the timeout (previously
  every timeout — regardless of team — forced a `false` blip).

`@pivot/engine` was rebuilt (`tsc`) and the harness restarted at ~2:43pm ET to pick it up. As with
every restart, the catch-up replay fired a few more stale pushes before settling — not a regression,
same restart artifact as every other restart today.

### Finding 1a: same symptom, second cause (`no_play` / pre-snap penalty)

**STATUS: FIXED live (Sept 13, 2026, ~2:56pm ET).**

Reported again live for the Bears game ("CHI bouncing between active/not-active despite remaining on
offense"), *after* the Finding 1 fix above was already deployed — so a different root cause. Traced
to the actual play sequence in this
run's `plays-*.jsonl` (game `401872660`): `kickoff(HOU) → run(HOU) → run(HOU) → no_play(HOU)`. Houston
held the ball through all four plays (`no_play` = a pre-snap penalty, ESPN `type.id` `'8'`,
`possessionTeamId` still `'HOU'`, not null), but `flag_removed` fired anyway on the `no_play`.

Cause: `unitOnFieldFor` maps `'no_play'` to `'none'` unconditionally, with no exception for
"possession didn't actually change" the way the timeout case does — because `no_play`'s
`possessionTeamId` is *not* generally null (unlike a timeout), the original Finding 1 fix's
`possessionTeamId === null` guard never engaged for this case.

**Fix applied**, same file: extracted the carry-forward condition into
`continuesPreviousPossession(play, previous)`, which now also carries possession-derived fields
forward for a `no_play` whose `possessionTeamId` matches `previous`'s — same drive continuing. A
`no_play` naming a *different* team than `previous` (the genuinely ambiguous "penalty on the very
first play of a new, not-yet-established drive" case `espnPlayTypeMap.ts`'s comment describes) still
falls through to the original `'none'` behavior, unchanged.

Verified: 3 new tests added (124/124 passing total, full suite incl. the real-game integration
replay), plus a direct replay of this exact `kickoff → run → run → no_play` sequence through the
rebuilt `applyPlayToState`/`computeFlagState` — confirms `flagged` now stays `true` uninterrupted
through the `no_play`. `@pivot/engine` rebuilt and harness restarted again at ~2:56pm ET.

Open question, not yet chased down: whether there are more play types with the same shape of bug
(possession genuinely unchanged, but `unitOnFieldFor` has no case that says so) beyond `timeout`,
`end_period`, and now `no_play`. Worth a systematic pass rather than fixing these one report at a
time.

---

## Finding 1b: `flag_removed` push copy names the wrong team on a real possession change

**STATUS: Open. Root-caused with high confidence (Sept 13, 2026, ~3:09pm ET) — reproduces on
essentially every punt, confirmed to recur in the post-Finding-1a-fix run, so it is definitely NOT a
side effect of the flapping bugs (an earlier note in this doc speculated it was — that was wrong,
corrected here from live evidence).**

**Confirmed intermittent, not universal** — corrected after the full run completed (all games went
final at 4:36pm ET, harness exited clean, exit code 0). Tallying every "Texans RB1 no longer active"
push against its punt in the completed `/tmp/live-harness-run.log` (game `401872660`): **6 such
pushes total, 4 correctly said "Bills," 2 wrongly said "Texans"** (at `15:07:56` and again later at
`15:56:43` ET) — roughly 1-in-3, not "essentially every punt" as this doc first guessed. Frequency
matters for the root cause below: it's consistent with a timing race (see last bullet), not a
guaranteed structural miss.

**Root cause** (`services/dispatcher/src/delivery.ts`):

- `deliverFlagEvent` resolves the notification's team name via `resolveNotificationTeamNames(gameState, ...)`,
  where `gameState` is `deps.gameStateStore.getGameState(event.gameId)` fetched **fresh, at delivery
  time** — not a snapshot from when the flag actually changed.
- A punt's `PlayEvent.possessionTeamId` (per ESPN's own play-by-play attribution, and
  `services/ingestion`'s mapping of it) still names the **kicking** team — the punt is "their" play.
  `applyPlayToState`'s `possessionFieldsFor` has no special case for punts (only `SKIP_AND_WAIT`/
  same-team `no_play` carry forward), so after a punt the stored `GameState.possessionTeamId` is
  still HOU, `unitOnField` is `'special_teams'`.
- `computeFlagState` correctly sees `unitOnField !== 'offense'` and flips `flagged: false` →
  `flag_removed` fires — that part is right.
- But `resolveNotificationTeamNames` reads that *same, still-HOU* `GameState` to answer "who has it
  now," and since `possessionTeamId` is non-null (still HOU) it happily returns "Texans." The actual
  new possessor (Buffalo) doesn't exist in `GameState` yet — it only appears once the *next* play (the
  return team's first offensive snap) is processed. Because `flag_removed` is an un-gated
  `fire_immediately` event (Finding 2's `ResumptionGatedDispatcher` doesn't hold `flag_removed`),
  delivery happens near-instantly after the punt play, essentially guaranteeing it beats the next play.
- The ~1-in-3 hit rate (not every punt) fits this being a genuine **race**: whether the wrong name
  shows up depends on whether the *next* play (the return team's first snap) has already been
  ingested and applied to `GameState` before `deliverFlagEvent` happens to read it — a function of
  ESPN poll timing relative to delivery latency, not something the punt play itself determines. It's
  independent of the Finding 1/1a flapping bugs either way (this run's fix for those was already
  active for both the wrong and the correct instances above).

**Not fixed live.** `delivery.ts` already has a deliberate, reviewed ruling on an adjacent question
(`old_state.possession_team` is unconditionally `null` rather than best-effort, per the "Sprint 9
Phase 1 gate review" comment at the `old_state:` line) — i.e. this exact "state as of when vs. state
as of delivery" tradeoff has already been litigated once for a sibling field, so the right fix
(likely: resolve the *new* possessor from `event.newState`/the triggering play rather than re-reading
current `GameState`, or explicitly special-case punts) deserves the same deliberate treatment rather
than a quick patch while unattended. Flagging for a real fix pass, not patching now.

---

## Finding 2: Kickoffs resolve the resumption window before the flag event they're meant to gate exists

**Symptom (reported live):** A kickoff return is the actual first instance of a new possession, but
doesn't read as "a worthy resumption play" — i.e. the resumption-timing signal doesn't seem to line
up with when the notification actually fires.

**Two separate, both-intentional classifications collide here:**

1. `services/engine/src/resumptionWatcher.ts`'s `classifyPlayType()` has no explicit case for
   `'kickoff'`, so it falls through to the `REAL_ACTION` default — a kickoff *is* already treated as
   valid real action for timing purposes, by design ("unrecognized play type fails toward firing").
2. `services/engine/src/applyPlayToState.ts`'s `unitOnFieldFor()` puts `'kickoff'` in
   `SPECIAL_TEAMS_PLAY_TYPES`, deliberately **not** `OFFENSE_PLAY_TYPES` — also by design (see the
   comment there re: kicker-flag double-counting, Section 4 "special handling for kickers" being
   out of scope for v1). So a kickoff itself never sets `unitOnField: 'offense'`, and therefore
   `computeFlagState` never emits a `flag_added` on the kickoff play — only on the *following*
   offensive snap.

**The mismatch:** `experiments/resumptionGate.ts`'s `ResumptionGatedDispatcher` opens a resumption
window on the possession-revealing play and closes it as soon as that play classifies as
`REAL_ACTION`. Since a kickoff already reveals the new possession *and* already classifies as
`REAL_ACTION`, the window opens and resolves in the same step — on the kickoff. `beginPlay()` then
clears `resolutionThisPlay` before the *next* play (the actual offensive snap that produces the real
`flag_added`) is processed. By the time that `flag_added` event reaches `dispatch()`, there is no
open window and no stored resolution, so it goes out via the plain `fire_immediately` path with
`resolution: null` — bypassing the resumption-gating logic entirely for every kickoff-started drive.
Confirmed in `events.jsonl`: gated entries consistently show `"resumptionOutcome":null` alongside
`"decision":"fire_immediately"`.

This matches (and explains) `resumptionGate.ts`'s own header comment, which already predicted
`holdMs ≈ 0 for every event` because "the play that reveals a new possession is always itself
REAL_ACTION" — that prediction is correct for the *resumption-timing* question, but it means the
window closes one play too early relative to the *flag_added* event a kickoff-started drive actually
needs gated.

**Possible direction (not evaluated in depth):** either (a) have the incremental tracker keep the
window open through a `kickoff` specifically until the next non-special-teams play arrives, or
(b) have `dispatch()` fall back to the *last* resolution for the game rather than only the one from
the current play, so a flag_added one play behind the resolving play still inherits it.

**STATUS: FIXED post-slate (Sept 13, 2026, ~5:20pm ET).** Went with direction (b), scoped tightly:
`experiments/resumptionGate.ts`'s `ResumptionGatedDispatcher` now demotes an unconsumed resolution
into a one-play `carryOverResolution` grace slot in `beginPlay()` instead of discarding it outright.
`dispatch()` checks that slot as a fallback and consumes it (deletes it) the first time any event
claims it, so it can cover exactly the "kickoff resolves, but the flag_added it's for doesn't exist
until next play" gap without misattributing itself to unrelated events further downstream.
`noteWindowOpened()` also clears a stale, not-yet-consumed carry-over when a fresh possession change
starts (e.g. the kickoff return is immediately fumbled before its own `flag_added` ever fired) so a
second, real resolution can't be shadowed by a stale first one.

This is a **harness-only fix** — `resumptionGate.ts` isn't shipped `services/*` code, it's this test's
own simulation of what resumption-gating dispatch would look like if wired into production (per the
verification at the top of this test, `resumptionWatcher.ts` isn't wired into the live firing path
yet). So this fix only affects the accuracy of *today's test data going forward*, not any running
production behavior.

Verified with two standalone simulation scripts reproducing the exact harness call order
(`beginPlay` → `tracker.observe` → `onPlayEvent`/`dispatch`, per `live-sunday-harness.ts`'s
`makeHandler`):
1. Kickoff resolves `REAL_ACTION` with no dispatch that play → next play's `flag_added` now correctly
   shows `resolution.outcome: 'REAL_ACTION'` instead of `null` → a third, later event correctly shows
   `null` again (no over-carry).
2. A second window opening before the first resolution is consumed (fumbled return) correctly
   overrides the stale first resolution rather than leaking it forward.

---

## Post-slate follow-up pass (~5:00–5:20pm ET)

Before starting any further live testing, went back through every open item above:

1. **Ran `services/dispatcher`'s test suite against today's `services/engine` changes** (Finding 1/1a)
   — caught one real failure: `dispatcher.integration.test.ts`'s rate-limit test used a
   `makeTimeoutPlay()` helper whose own comment admitted it depended on a timeout toggling the flag
   off ("reliably produces a `flag_removed` diff... without needing priority-delta math") — i.e. it
   was unknowingly built on top of the exact bug Finding 1 fixed. Replaced it with
   `makeAwayPossessionPlay()` (a genuine possession change to the other team, not a stoppage), which
   exercises the same rate-limit behavior for the right reason. **279/279 tests passing** after the
   fix (`services/engine` + `services/dispatcher` combined).
2. **Systematic pass on the open question from Finding 1a** (whether other play types share the
   carry-forward gap): enumerated all 14 `PlayType` values against `unitOnFieldFor` /
   `continuesPreviousPossession` and `espnPlayTypeMap.ts`. Result: **no further gaps**. Every
   offense/special-teams play type always carries a genuine non-null `possessionTeamId` on the play
   itself (per `PlayEvent.possessionTeamId`'s own doc comment — null is only possible for
   pre-snap/timeout/end-of-period/end-of-game, i.e. exactly `no_play`/`timeout`/`end_period`/
   `end_half`/`end_game`, all already handled correctly: the first three carry forward, the last two
   intentionally don't). Closing this question.
3. **Finding 2 fixed** — see its own section above.
4. **Finding 1b intentionally NOT fixed** — see below.

## Finding 1b: why it's not fixed, and what a real fix needs

Root cause is confirmed (see Finding 1b above), but the fix isn't a small patch: the only reliable way
to name the correct new possessor after a punt/kickoff is to know which team possessed the ball
*before* the triggering play, and `FlagState` (PLAN.md Section 8, described in `delivery.ts`'s own
comments as a "frozen" shape) carries no team identity at all — only player ids. `delivery.ts` already
has a deliberate, reviewed ruling on the identical tradeoff for a sibling field
(`old_state.possession_team` is unconditionally `null`, not best-effort, per the "Sprint 9 Phase 1 gate
review" comment), and `notificationContent.ts`'s own JSDoc separately documents this general class of
gap as "Accepted for v1." A correct fix means either extending `FlagState`/`FlagEvent` with a real
team-identity field, or threading the triggering `PlayEvent`'s possession data through
`onPlayEvent` → the dispatcher → `delivery.ts` — both are schema/architecture changes relative to what
Section 8/9 currently specify, not a bug-fix-in-place. Per repo convention (check PLAN.md section
number and ask before deviating), this is flagged for a deliberate decision rather than patched
unilaterally. **Left open, cosmetic-only impact** (wrong team name in push body text; doesn't affect
resumption timing/delivery correctness, which is what this test slate is actually measuring).

- Still worth checking whether interceptions/fumble returns share the same
  `PlayEvent.possessionTeamId`-names-the-pre-play-team shape as punts (evidence from today's marks
  suggests interceptions do NOT — the intercepting team's possession appears in the same play, no
  race), i.e. the bug is specifically punts/kickoffs/missed-FG-return situations, not all
  change-of-possession plays.
- Whether Finding 2's original mechanism also affects punts (also `SPECIAL_TEAMS_PLAY_TYPES`, also
  possession-revealing on the return) — the fix applied is generic (any unconsumed resolution gets a
  one-play grace period), so it should already cover punts too, but not separately confirmed against a
  live punt-return example.
