# Stream Synchronization Research — Findings & Conclusions

**Context:** Pivot routes users to the correct live broadcast based on their fantasy roster (v1, phone-as-remote model — no native playback). Before native streaming ships in v2, notification timing has to account for the gap between when a sports data provider registers an event and when that event actually becomes visible to a given user on their own delayed stream. This document captures the reasoning, evaluation, and empirical findings from the sessions that worked through this problem.

---

## **1. The Core Problem**

Sports data providers register game events (plays, scores, possession changes) at some point in real time. A user's live stream — cable, OTA antenna, or a streaming service like YouTube TV — shows that same event some number of seconds later. That delay varies by:

- **Platform.** OTA antenna and cable tend to run low single-digit-to-low-teens seconds behind real time. Streaming services (YouTube TV, Hulu Live, etc.) commonly run 20–45+ seconds behind, due to segment-based delivery.
- **Individual variance.** Even on the same platform, two users can have different effective delay depending on device, network conditions, and whether they're watching live vs. slightly behind.

A notification that reveals what happened (e.g., "Your RB just scored") is a **spoiler** if it arrives before the user's own stream shows the play. A notification that arrives *after* the user already saw it is just late — usually a minor annoyance, not a real failure.

## **2. Key Reframe: Two Notifications, Not One**

The original framing treated this as one hard problem: time a single notification perfectly so it never spoils and never lags too far behind. The more useful framing splits it into two separate concerns with very different requirements:

1. **The routing nudge** — "something notable just happened, switch to Channel X now." This does not reveal an outcome, so it carries no spoiler risk and can fire as close to real-time as the data provider allows.
2. **The reveal** — "here's what happened." This is the part that's spoiler-sensitive and needs to be timed against the user's actual stream delay.

This means the hard synchronization problem only applies to the *reveal*, not to getting the user's attention in the first place.

## **3. Proposed Delay Model (Conceptual, Pre-Data)**

For the reveal specifically, a layered estimate was proposed rather than a single fixed number:

- **Platform baseline** — derived from onboarding, where users already select which streaming services they have. Different platforms get different default delay assumptions.
- **Conservative bias, not an average.** Given the asymmetric cost (early = spoiler, late = minor), estimates should round up, not split the difference.
- **Optional per-user manual offset** — a simple settings slider ("reveals feel early / feel late") letting a user nudge their personal delay, without needing to infer it automatically.

**Explicitly deferred:** true automatic per-user latency detection via audio fingerprinting (Shazam/ACR-style matching against the live broadcast feed) was identified as the theoretically "correct" solution, but requires microphone access and real infrastructure — flagged as a v3+ direction, not something to build now.

## **4. Data Provider Evaluation**

Before any delay model could be built, a data source for live game events (possession changes, red zone entries, etc.) was needed — none had been integrated yet. Requirements: free or near-free (indie budget), no fantasy- scoring math needed (raw game-state events only), and delivery had to be fast enough to be useful (true push/webhook delivery is realistically an enterprise- tier feature; polling every 5–15s during live windows was accepted as the realistic mechanism for an indie budget).

Three candidates were compared:


|                              |                                      |                                                                                                                                                                                |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Provider**                 | **Price**                            | **Notes**                                                                                                                                                                      |
| **ESPN unofficial site API** | Free                                 | Same family already planned for v2 fantasy integration. Undocumented/unofficial — could change without notice. Includes down/distance, possession, field position, drive info. |
| **Tank01 (via RapidAPI)**    | Free tier + cheap paid               | Fantasy-focused, real business behind it, but play-by-play feature explicitly marked "beta" at time of evaluation.                                                             |
| **MySportsFeeds**            | Free for personal/non-commercial use | License restriction is a real concern if Pivot is monetized later — needs a legal read before relying on long-term.                                                            |


**Sportradar** (the official NFL data partner, with fast feeds) was ruled out outright as enterprise-tier pricing, not viable for an indie budget.

**Decision:** start with ESPN's free endpoint as a prototyping/calibration tool. Rationale: zero cost, same infrastructure family as the already-planned v2 fantasy work, and — critically — it's also the best free way to get real empirical latency data, which was the actual blocking unknown.

## **5. Empirical Test Setup**

A throwaway script (experiments/espn-latency-probe.ts) was built to:

- Poll ESPN's scoreboard endpoint to find a specific live game
- Poll that game's summary endpoint every 5 seconds
- Log each newly-appearing play (deduplicated by play ID) with a wall-clock timestamp, quarter/clock, down/distance, possession, and play text
- Exit cleanly when the game was marked final

This was run live during the Colts @ Lions game (August 29, 2026), compared against YouTube TV as the reference broadcast.

## **6. Results**

**Q3 measurements, two independent methods:**


|                                                                      |          |            |
| -------------------------------------------------------------------- | -------- | ---------- |
| **Method**                                                           | **Mean** | **Median** |
| Hand stopwatch (start on TV event, stop on terminal log)             | ~27.8s   | 30s        |
| World clock vs. terminal timestamp (corrected for ~2.5s clock drift) | ~30.8s   | ~32.5s     |


Two independently-measured methods landing within ~3 seconds of each other was treated as meaningful convergence, not coincidence — giving reasonable confidence in a **~28–32 second baseline delay** between ESPN's play-by-play data and the YouTube TV broadcast.

**Initial hypothesis (later overturned):** a fumble's possession-change log appeared to fire in under 5 seconds — dramatically faster than the ~30s baseline — suggesting ESPN might fast-track certain "exciting" event types (turnovers, possibly scores) ahead of routine plays.

**What the terminal log actually showed**, on closer inspection:

[15:16:17] Q3 1:21 | 3rd & 2 at IND 36 | poss: DET | ...FUMBLES...RECOVERED by IND-M.Melton at IND 32.

[15:16:27] Q3 1:14 | 1st & 10 at IND 32 | poss: IND | Official Timeout at 01:14.

The moment YouTube TV showed officials *confirming* the fumble ruling lined up with the **second** log entry, not the first. This revealed the real mechanism: **both ESPN's data and the broadcast are gated by the same real-world bottleneck — official/replay confirmation — not by ESPN prioritizing certain play types.** A ruling isn't final until officials say so, and neither system can show a settled outcome before that happens.

**This overturned the "fast lane for exciting plays" hypothesis.** Punts and kickoffs (also possession changes, no controversial ruling involved) were measured at ~30s, same as routine plays — no fast-lane behavior. A touchdown was subsequently measured at **~32 seconds** — squarely in the same baseline range, not the near-instant delivery the "exciting plays get fast-tracked" hypothesis would have predicted.

## **7. Revised Conclusion**

**There is no fast lane / slow lane by play type.** ESPN's play-by-play feed runs on a fairly consistent **~30-second delay relative to YouTube TV**, across turnovers, special teams plays, and scoring plays alike. The one apparent exception (the fumble) was explained by a shared real-world confirmation delay, not a data-pipeline priority difference.

This is a simpler result than what was initially hypothesized, and easier to build against: **one baseline number, not a play-type-dependent split.**

## **8. Design Decision: Asymmetric Cost Justifies Conservative Padding**

A specific, mechanism-backed rationale was identified for padding the delay estimate beyond the raw ~30s mean, specifically for **possession-change-triggered notifications**:

- **Firing early** = spoiler, undermines the core value of the app
- **Firing late** = usually low-cost, because a possession change (turnover, punt, kickoff) is very often followed by a commercial break — meaning the user typically isn't missing live action by receiving the notification a bit later than the raw baseline

**Decision:** for possession-change notifications specifically, pad the estimate meaningfully above the raw ~30s mean (e.g., treat the working estimate as ~35–40s rather than ~30s) rather than hugging the measured average tightly. This is justified by the actual commercial-break mechanism, not just general caution.

## **9. Open Items / Next Steps**

- Sample size is currently small (~12 data points, one game, one platform). Not yet a robust production model.
- Not yet tested: whether the ~30s baseline holds on a **different platform** (cable, OTA antenna) — if ESPN's own ~30s lag turns out to be *longer* than a fast platform's broadcast delay, that platform might need little to no added buffer at all, which would simplify the model further.
- The routing-nudge / reveal split (Section 2) remains a good design pattern independent of the data findings, but no longer needs a fast/slow data-source split to implement — both would draw from the same ~30s-delayed feed, just triggered at different points.
- ESPN's unofficial-endpoint risk (no SLA, could change without notice) remains an accepted but real risk, consistent with the same risk already accepted for the v2 fantasy integration plan.
- No commitment yet to ESPN as the production data provider — this was explicitly a free prototyping/calibration choice, not a final decision.



## **10. Resumption Detection: Waiting for the First Real Play, Not a Fixed Delay**



#### **10.1 The Problem With a Single Padded Delay**

Section 8's conclusion — pad possession-change reveals to ~35–40s rather than the raw ~30s mean — implicitly assumed the pause after a possession change is *roughly* a fixed length, just one worth rounding up. That assumption turned out to be wrong, and a fixed padding value (however conservative) can't actually fix it.

#### **10.2 The Insight**

If a possession change is tied to a timeout, that timeout is very often used for a commercial break — which can run around two minutes. A notification fired ~30–40 seconds after the possession change would still leave the user sitting through roughly a minute and a half of commercials before anything actually happens. Instead of anchoring the delay to *when the possession change was logged*, anchor it to **when the first real play after that change is logged** — firing ~5–10 seconds after that entry appears. Since every play is necessarily logged after it physically happens, this naturally lands the user right around the start of the next snap, adjusted for their own stream's delay.

#### **10.3 Empirical Evidence: Four Real Sequences**

Captured live during the Colts @ Lions game (Aug 29, 2026):


|       |                                                             |                                     |         |
| ----- | ----------------------------------------------------------- | ----------------------------------- | ------- |
| **#** | **Sequence**                                                | **Trigger → next logged entry**     | **Gap** |
| 1     | Fumble (DET) → Timeout (IND) → First play (IND)             | Fumble → Timeout                    | 0:10    |
| 1     | (same)                                                      | Timeout → First real play           | 2:51    |
| 2     | Punt (IND) → First play (DET), no timeout tag               | Punt → First real play              | 1:02    |
| 3     | Touchdown (DET) → Timeout (DET) → First play (IND, kickoff) | TD → Timeout                        | 0:42    |
| 3     | (same)                                                      | Timeout → First real play (kickoff) | 2:50    |
| 4     | Turnover on downs (IND) → Timeout (DET) → First play (DET)  | Turnover → Timeout                  | 0:00    |
| 4     | (same)                                                      | Timeout → First real play           | 2:49    |


Raw terminal captures, for reference:

1. Fumble (DET) -> Timeout (IND) -> First play (IND)

[2026-08-29 15:16:17] Q3 1:21 | 3rd & 2 at IND 36 | poss: DET | (Shotgun) R.Williams up the middle to IND 33 for 3 yards (T.Washington). FUMBLES (T.Washington), RECOVERED by IND-M.Melton at IND 32.

[2026-08-29 15:16:27] Q3 1:14 | 1st & 10 at IND 32 | poss: IND | Official Timeout at 01:14.

[2026-08-29 15:19:18] Q3 1:14 | 1st & 10 at IND 32 | poss: IND |  (Shotgun) E.Stick pass incomplete deep middle to E.Pancol [M.Adams].

1. Punt (IND) -> First play (DET)

[2026-08-29 15:21:17] Q3 0:20 | 4th & 10 at IND 32 | poss: IND |  R.Sanchez punts 50 yards to DET 18, Center-L.Rhodes. G.Dortch to DET 38 for 20 yards (D.Veresuk).

[2026-08-29 15:22:19] Q3 0:07 | 1st & 10 at DET 38 | poss: DET |  J.Dobbs pass incomplete short left to M.Cunningham (K.Harris) [T.Smith].

1. Touchdown (DET) -> Timeout (DET) -> First play (IND)

[2026-08-29 15:33:23] Q4 7:25 | 3rd & Goal at IND 1 | poss: DET |  (Shotgun) Tr.Williams up the middle for 1 yard, TOUCHDOWN.

[2026-08-29 15:34:05] Q4 7:25 |  & Goal at IND 15 | poss: DET | Official Timeout at 07:25.

[2026-08-29 15:36:55] Q4 7:25 | — | poss: DET | J.Bates kicks 62 yards from DET 35 to IND 3. D.Giddens to IND 33 for 30 yards (J.Bachie).

1. Turnover on 4th down (IND) -> Timeout (DET) -> First play (DET)

[2026-08-29 15:43:48] Q4 4:26 | 4th & 6 at IND 49 | poss: IND |  (Shotgun) E.Stick pass incomplete short middle to R.Sharpe (K.Abney).

[2026-08-29 15:43:48] Q4 4:23 | 1st & 10 at IND 49 | poss: DET | Official Timeout at 04:23.

[2026-08-29 15:46:37] Q4 4:23 | 1st & 10 at IND 49 | poss: DET |  R.Williams right tackle to IND 45 for 4 yards (C.Ball; T.Smith).

#### **10.4 What the Gaps Show**

Every case with a formal Official Timeout tag lands within **2:49–2:51** of the next real play — consistent with the standard NFL broadcast commercial break, not coincidence. Case 2, with no timeout tag at all, shows a much shorter **1:02** gap. The distribution is **bimodal**: roughly a minute, or roughly 2:50, and not distinguishable in advance from the possession-change event alone. This is exactly what a single padded delay can't represent — anchoring on the actual next real play sidesteps needing to predict which bucket applies.

#### **10.5 The Classification Problem**

Naively taking "the next logged entry" as the trigger doesn't work: an Official Timeout entry is a play-array entry the same way a real snap is. Case 1 shows why this matters — if the timeout entry itself were treated as the trigger, the notification would fire after only 10 seconds, not 2:51, defeating the whole point. The algorithm needs to explicitly distinguish procedural entries (timeouts, period/half/game boundaries) from real action, and keep scanning forward past the procedural ones.

#### **10.6 ESPN's Type Taxonomy (confirmed via later investigation)**

Rather than pattern-matching on free-text descriptions (fragile — breaks on wording variation), ESPN's play objects carry a structured type.id/ type.text field. Confirmed by inspecting a completed game and cross-checked against a **17-game survey**(2026 preseason; 2025 regular weeks 1 and 12; 2025 postseason) to avoid under-sampling from a single game:

SKIP_AND_WAIT: 74 (Official Timeout), 21 (Timeout), 75 (Two-minute warning),

               2 (End Period)

ABORT:         65 (End of Half), 66 (End of Game)

REAL_ACTION:   everything else (default)

Safety ceiling: ~4 minutes of continuous SKIP_AND_WAIT with no REAL_ACTION

                or ABORT fires the notification anyway, so the mechanism can

                never go silent indefinitely

ABORT is deliberately distinct from SKIP_AND_WAIT: halftime runs far longer than a timeout's ~2:50 pattern, so waiting through it the same way would either trigger the safety ceiling mid-halftime (firing a notification with nothing to switch to) or block indefinitely. Cancelling on ABORT and letting a fresh possession-change event next half restart the flow avoids both failure modes.

REAL_ACTION is a **default**, not an enumerated allow-list — an unrecognized type fails toward firing rather than waiting forever for a category it will never see, which is the safer failure direction.

The 17-game survey caught a real gap a single-game sample would have missed: restricted to just the recorded Colts @ Lions game, type ids 67 ("Passing Touchdown") and 79 ("End of Regulation") never appeared — meaning every passing touchdown would have silently fallen to an unmapped default in a narrower build.

#### **10.7 A Bug Found via Backtesting: The Anchor-Timing Subtlety**

The play that first reveals a possession change can itself already be real action — case 2's punt return is the example: poss:only flips to the receiving team on their first offensive snap, which is the same entry as the real action itself, not a separate marker preceding it. An initial implementation scanned *past* this entry looking for "the next" real action, incorrectly picking up an unrelated later event and computing ~2:50 instead of the correct ~1:02.

**Fix**: classify the play that first reveals the possession change *before* deciding whether to keep scanning.

- If that play is REAL_ACTION (the punt case): the trigger is that play itself, but elapsed time is measured from the **preceding** play (the actual real-world moment of the possession change) — not from the revealing play, which would trivially always compute as zero.
- If that play is procedural (the timeout cases): elapsed time is measured from that revealing play, and scanning continues forward as before.

#### **10.8 Backtest Validation**

All four hand-analyzed cases were re-implemented as automated tests against the real recorded game log and matched expected timing after the fix. A mutation test — deliberately disabling the anchor fix and re-running — confirmed the fix's effect is narrowly scoped: **only the punt case (#2) regressed; the other three, where the revealing play is procedural, were unaffected.** This is a stronger guarantee than the original by-inspection backtest, since it directly demonstrates the fix's blast radius rather than just asserting it.

#### **10.9 Status**

This mechanism has been promoted from research/backtest code into real, tested, provider-decoupled production code (@pivot/engine's resumptionWatcher.ts, @pivot/ingestion's ESPN adapter), with the four reference cases now permanent regression tests. It supersedes the ~35–40s padded-delay recommendation from Section 8 for possession-change-triggered notifications. Full implementation detail lives in [PLAN.md](http://PLAN.md) (Section 8's "Resumption detection" subsection) and the corresponding commit history — not duplicated here to avoid the two docs drifting out of sync.

**Still open**: this has been validated against a recorded log and hand-built fixtures, not yet against a live, incrementally-arriving feed, and is not yet wired into the actual notification-firing pipeline. Next live NFL game available for that test: Wednesday, September 9, 2026.