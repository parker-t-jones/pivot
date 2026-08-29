# Stream Synchronization Research — Findings & Conclusions

**Context:** Pivot routes users to the correct live broadcast based on their fantasy
roster (v1, phone-as-remote model — no native playback). Before native streaming
ships in v2, notification timing has to account for the gap between when a sports
data provider registers an event and when that event actually becomes visible to
a given user on their own delayed stream. This document captures the reasoning,
evaluation, and empirical findings from the sessions that worked through this
problem.

---

## 1. The Core Problem

Sports data providers register game events (plays, scores, possession changes)
at some point in real time. A user's live stream — cable, OTA antenna, or a
streaming service like YouTube TV — shows that same event some number of seconds
later. That delay varies by:

- **Platform.** OTA antenna and cable tend to run low single-digit-to-low-teens
  seconds behind real time. Streaming services (YouTube TV, Hulu Live, etc.)
  commonly run 20–45+ seconds behind, due to segment-based delivery.
- **Individual variance.** Even on the same platform, two users can have
  different effective delay depending on device, network conditions, and
  whether they're watching live vs. slightly behind.

A notification that reveals what happened (e.g., "Your RB just scored") is a
**spoiler** if it arrives before the user's own stream shows the play. A
notification that arrives *after* the user already saw it is just late — usually
a minor annoyance, not a real failure.

## 2. Key Reframe: Two Notifications, Not One

The original framing treated this as one hard problem: time a single notification
perfectly so it never spoils and never lags too far behind. The more useful
framing splits it into two separate concerns with very different requirements:

1. **The routing nudge** — "something notable just happened, switch to Channel X
   now." This does not reveal an outcome, so it carries no spoiler risk and can
   fire as close to real-time as the data provider allows.
2. **The reveal** — "here's what happened." This is the part that's genuinely
   spoiler-sensitive and needs to be timed against the user's actual stream delay.

This means the hard synchronization problem only applies to the *reveal*, not to
getting the user's attention in the first place.

## 3. Proposed Delay Model (Conceptual, Pre-Data)

For the reveal specifically, a layered estimate was proposed rather than a single
fixed number:

- **Platform baseline** — derived from onboarding, where users already select
  which streaming services they have. Different platforms get different default
  delay assumptions.
- **Conservative bias, not an average.** Given the asymmetric cost (early =
  spoiler, late = minor), estimates should round up, not split the difference.
- **Optional per-user manual offset** — a simple settings slider ("reveals feel
  early / feel late") letting a user nudge their personal delay, without needing
  to infer it automatically.

**Explicitly deferred:** true automatic per-user latency detection via audio
fingerprinting (Shazam/ACR-style matching against the live broadcast feed) was
identified as the theoretically "correct" solution, but requires microphone
access and real infrastructure — flagged as a v3+ direction, not something to
build now.

## 4. Data Provider Evaluation

Before any delay model could be built, a data source for live game events
(possession changes, red zone entries, etc.) was needed — none had been
integrated yet. Requirements: free or near-free (indie budget), no fantasy-
scoring math needed (raw game-state events only), and delivery had to be fast
enough to be useful (true push/webhook delivery is realistically an enterprise-
tier feature; polling every 5–15s during live windows was accepted as the
realistic mechanism for an indie budget).

Three candidates were compared:

| Provider | Price | Notes |
|---|---|---|
| **ESPN unofficial site API** | Free | Same family already planned for v2 fantasy integration. Undocumented/unofficial — could change without notice. Includes down/distance, possession, field position, drive info. |
| **Tank01 (via RapidAPI)** | Free tier + cheap paid | Fantasy-focused, real business behind it, but play-by-play feature explicitly marked "beta" at time of evaluation. |
| **MySportsFeeds** | Free for personal/non-commercial use | License restriction is a real concern if Pivot is monetized later — needs a legal read before relying on long-term. |

**Sportradar** (the official NFL data partner, with genuinely fast feeds) was
ruled out outright as enterprise-tier pricing, not viable for an indie budget.

**Decision:** start with ESPN's free endpoint as a prototyping/calibration tool.
Rationale: zero cost, same infrastructure family as the already-planned v2
fantasy work, and — critically — it's also the best free way to get real
empirical latency data, which was the actual blocking unknown.

## 5. Empirical Test Setup

A throwaway script (`experiments/espn-latency-probe.ts`) was built to:
- Poll ESPN's scoreboard endpoint to find a specific live game
- Poll that game's summary endpoint every 5 seconds
- Log each newly-appearing play (deduplicated by play ID) with a wall-clock
  timestamp, quarter/clock, down/distance, possession, and play text
- Exit cleanly when the game was marked final

This was run live during the Colts @ Lions game (August 29, 2026), compared
against YouTube TV as the reference broadcast.

## 6. Results

**Q3 measurements, two independent methods:**

| Method | Mean | Median |
|---|---|---|
| Hand stopwatch (start on TV event, stop on terminal log) | ~27.8s | 30s |
| World clock vs. terminal timestamp (corrected for ~2.5s clock drift) | ~30.8s | ~32.5s |

Two independently-measured methods landing within ~3 seconds of each other was
treated as meaningful convergence, not coincidence — giving reasonable confidence
in a **~28–32 second baseline delay** between ESPN's play-by-play data and the
YouTube TV broadcast.

**Initial hypothesis (later overturned):** a fumble's possession-change log
appeared to fire in under 5 seconds — dramatically faster than the ~30s baseline
— suggesting ESPN might fast-track certain "exciting" event types (turnovers,
possibly scores) ahead of routine plays.

**What the terminal log actually showed**, on closer inspection:
```
[15:16:17] Q3 1:21 | 3rd & 2 at IND 36 | poss: DET | ...FUMBLES...RECOVERED by IND-M.Melton at IND 32.
[15:16:27] Q3 1:14 | 1st & 10 at IND 32 | poss: IND | Official Timeout at 01:14.
```
The moment YouTube TV showed officials *confirming* the fumble ruling lined up
with the **second** log entry, not the first. This revealed the real mechanism:
**both ESPN's data and the broadcast are gated by the same real-world bottleneck
— official/replay confirmation — not by ESPN prioritizing certain play types.**
A ruling isn't final until officials say so, and neither system can show a
settled outcome before that happens.

**This overturned the "fast lane for exciting plays" hypothesis.** Punts and
kickoffs (also possession changes, no controversial ruling involved) were
measured at ~30s, same as routine plays — no fast-lane behavior. A touchdown
was subsequently measured at **~32 seconds** — squarely in the same baseline
range, not the near-instant delivery the "exciting plays get fast-tracked"
hypothesis would have predicted.

## 7. Revised Conclusion

**There is no fast lane / slow lane by play type.** ESPN's play-by-play feed
runs on a fairly consistent **~30-second delay relative to YouTube TV**, across
turnovers, special teams plays, and scoring plays alike. The one apparent
exception (the fumble) was explained by a shared real-world confirmation delay,
not a data-pipeline priority difference.

This is a simpler result than what was initially hypothesized, and easier to
build against: **one baseline number, not a play-type-dependent split.**

## 8. Design Decision: Asymmetric Cost Justifies Conservative Padding

A specific, mechanism-backed rationale was identified for padding the delay
estimate beyond the raw ~30s mean, specifically for **possession-change-triggered
notifications**:

- **Firing early** = spoiler, undermines the core value of the app
- **Firing late** = usually low-cost, because a possession change (turnover,
  punt, kickoff) is very often followed by a commercial break — meaning the
  user typically isn't missing live action by receiving the notification a
  bit later than the raw baseline

**Decision:** for possession-change notifications specifically, pad the estimate
meaningfully above the raw ~30s mean (e.g., treat the working estimate as ~35–40s
rather than ~30s) rather than hugging the measured average tightly. This is
justified by the actual commercial-break mechanism, not just general caution.

## 9. Open Items / Next Steps

- Sample size is currently small (~12 data points, one game, one platform).
  Not yet a robust production model.
- Not yet tested: whether the ~30s baseline holds on a **different platform**
  (cable, OTA antenna) — if ESPN's own ~30s lag turns out to be *longer* than a
  fast platform's broadcast delay, that platform might need little to no added
  buffer at all, which would simplify the model further.
- The routing-nudge / reveal split (Section 2) remains a good design pattern
  independent of the data findings, but no longer needs a fast/slow data-source
  split to implement — both would draw from the same ~30s-delayed feed, just
  triggered at different points.
- ESPN's unofficial-endpoint risk (no SLA, could change without notice) remains
  an accepted but real risk, consistent with the same risk already accepted for
  the v2 fantasy integration plan.
- No commitment yet to ESPN as the production data provider — this was
  explicitly a free prototyping/calibration choice, not a final decision.