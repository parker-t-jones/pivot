# RosterRemote — Sprint 10 Track B Handoff

## Status as of this handoff

**Apple Developer Program: PURCHASED** ($98.99/year). Enrollment may still be
*processing* on Apple's side (can take anywhere from same-day to several days,
occasionally longer if identity verification is requested) — confirm it shows
as **fully active** at developer.apple.com/account before starting any Track B
work that needs it (device provisioning, push certs, TestFlight). If it's still
"pending," start with the parts of Track B that don't need it (see phase order
below).

**Sprint 10 Track A is complete and committed.** Built in a separate Cursor
chat, reviewed turn-by-turn with Claude. Summary of what shipped:

- **Schedule endpoints:** `GET /state/nfl` (season/week/season_type +
  schedule-derived `display_phase`, `preseason_start`, `regular_season_start`),
  `GET /games?week=`, `GET /games/live` (omit-not-degrade: live games with no
  Redis state are excluded, never shown with fake zero scores).
- **`display_phase`** is the load-bearing fix of this sprint: Sleeper's
  `season_type` / `season_start_date` fields proved unreliable (phase-relative,
  not actual game dates — burned us three times). `display_phase` is instead
  derived server-side from a real seeded NFL schedule
  (`data/nfl-schedule-2026.json`, via `pnpm seed:schedule`), in America/New_York
  calendar time. **Known gap:** no season-end bound yet — after the 2026 season
  concludes (~Jan 2027) `display_phase` will incorrectly stay `'regular'`
  through the 2027 offseason. Filed in PLAN.md Known Issues; needs the annual
  reseed workflow to fix properly. Not urgent now.
- **Home state machine:** all 5 spec states plus the 4a off/pre panel, keyed
  off `display_phase` (never `season_type`).
- **WebSocket client:** Home subscribes to `/v1/realtime` for live flag
  updates, gated on `display_phase` being `'regular'`/`'post'` (currently
  dormant — regular season starts Sept 9, so nothing connects yet). Reconnect
  reconciles against `/flags/current` so no flags are lost during a drop.
  15s ping / 40s server idle-close, TOKEN_REFRESHED-triggered reconnect.
- **Navigation restructure:** zero-league users are gated to connect-team
  before Home (matches spec order: Welcome → Sign up → Connect → Streaming →
  Notifications → All set). `LeaguesGateContext` is now the single source of
  truth for league state across Home/Settings/the gate — this fixed two real
  bugs (a Close-button redirect race, and Home showing stale "no leagues"
  after a connect/disconnect).
- Sleeper offseason league-discovery fallback, connect/disconnect fixes,
  full dark theme + amber accent token layer — all from pre-Sprint-10 work,
  still in place and working.

**One pre-existing, unrelated test failure**: `services/dispatcher/src/
notificationContent.test.ts` fails to load (CommonJS/ESM config issue, 0 tests
run). Confirmed via `git stash` that it fails on pre-Sprint-10 code too — not
something Track A introduced. Still unfixed; that module currently has zero
test coverage. Worth a small standalone fix at some point, not blocking.

> **RESOLVED Aug 21, 2026** (end of Track B, before B3). One-line fix; the
> cause was an editor auto-import, not an ESM/CJS config problem. 25 tests
> restored. See PLAN.md Known Issues for the full entry.

---

## What Track B is

Everything gated on a physical device / Apple Developer enrollment, deferred
out of Track A specifically so it could proceed in parallel with the
enrollment purchase:

1. **Real `AirPlayPlaybackSource` + `ChromecastPlaybackSource`** — currently
   stubbed/deferred since Sprint 8. This is the actual cast-to-TV
   implementation behind the "phone as remote" v1 architecture.
2. **Real-device APNs push verification** — deferred since Sprint 6. Push
   notifications work in principle (dispatcher, `pushNotifier`, rate limiter
   all built and tested) but have never been verified against a real Apple
   Push Notification service credential on real hardware.
3. **TestFlight build + submission prep.**
4. **Real-world Sunday preseason testing** — calendar-gated, not really a
   build phase; happens naturally in August once games are live and the
   device pieces above are working. (Also: preseason is currently
   `display_phase: 'pre'`, not `'off'`, and preseason kickoffs started Aug 6 —
   confirm what the app shows right now before assuming it's still offseason
   by the time you read this.)

## What Track B is NOT

Don't fold Sprint 10 Track A leftovers into this. Those are separate,
already-filed items:
- `notificationContent.test.ts` fix (pre-existing, unrelated)
- The `display_phase` season-end bound (Known Issue, low urgency, needs the
  annual reseed workflow)
- Multi-platform fantasy providers (Yahoo/ESPN/NFL) — filed as a v1.5 roadmap
  item in PLAN.md Section 14, explicitly deferred
- Betting/stake-source generalization — same section, explicitly deferred,
  pending legal review

---

## Recommended Track B phase order

**Phase B0 — Confirm enrollment is fully active + basic device build.**
Before anything else: confirm developer.apple.com/account shows active
membership (not pending). Then get the app building and running on a real
physical iPhone via Xcode (not just the Simulator) with a development
provisioning profile — this is the first real hardware milestone and it'll
surface issues (bundle ID, signing, capabilities) independent of push or
casting specifically. Do this before B1/B2 so you're not debugging two
new things at once.

**Phase B1 — Real-device APNs.**
Register an APNs key/cert in the Apple Developer portal, wire it into
whatever your dispatcher currently uses (check `pushNotifier.ts` / the
Expo push flow — confirm whether you're using Expo's push service, which
handles APNs indirection, or raw APNs). Verify a real push notification
reaches a real physical device. This is lower-risk than casting (no new
playback surface, just proving the pipe works end to end) — I'd do it before
B2.

**Phase B2 — AirPlay + Chromecast.**
Build the real `PlaybackSource` implementations. This is the architecturally
interesting part of Track B — check `app/playback/PlaybackSource.ts` for the
existing interface/stub shape before designing anything new. AirPlay is
native iOS (no third-party SDK needed, uses `AVRoutePickerView` or similar);
Chromecast requires the Google Cast SDK as a real dependency addition — flag
that explicitly when it comes up, since "no new deps" has been the default
constraint all sprint and this is a legitimate exception.

**Phase B3 — TestFlight build + submission prep.**
Once B0–B2 are verified on device, build an actual TestFlight release,
confirm it installs and runs for at least one other real tester (not just
the Simulator or your own dev-signed build), and start the App Store
Connect metadata/screenshots/review-prep work.

---

## Working conventions to carry over (same as Track A)

- **Fresh Cursor chat for this track** (it's effectively its own sprint —
  don't reuse the Track A chat).
- **Model discipline:** Opus 5, High reasoning + MAX Mode for anything
  architectural (the PlaybackSource design, the APNs wiring approach).
  Sonnet 5 High is fine for mechanical implementation once a design is
  approved. Never Auto if you have credits — Track A's Auto-mode phases
  (back when credits were out) were the ones that needed the most rework.
- **Mandatory read-back gate first:** have Cursor read the relevant PLAN.md
  sections (the Playback/PlaybackSource section, whatever covers Sprint 6
  Phase 3 push and Sprint 8 casting) and summarize back before writing any
  code.
- **Phase-by-phase gates**, stop and report, wait for explicit go-ahead —
  same discipline that caught the Close-bounce race and the leagues
  staleness bug in Track A. Device-dependent work is *more* prone to
  silent bugs than the API work was, not less — don't relax verification
  just because it's "just wiring up a device now."
- **Verify on real hardware, not just claims in the report.** Track A's
  worst near-misses (the false preseason-date copy, the navigation race)
  both passed clean test suites and were only caught by you looking at the
  actual device. Push notifications and casting are *device-only*
  behaviors by definition — there is no simulator substitute for "did the
  notification actually arrive" or "did the TV actually start playing."
- **Commit at every green gate.** Track A's discipline of committing after
  each verified phase (rather than batching) meant a bad phase never risked
  more than itself.

---

## Environment reminders (carried over from Track A friction)

- Local API: `pnpm --filter @roster-remote/api dev` (port 3000)
- Local Supabase: `supabase start` (needs Docker Desktop running first)
- Metro/Simulator: `cd app && pnpm start`, press `i`
- **Real device builds** are a new wrinkle Track A never touched — expect a
  first-time Xcode signing/provisioning fight. Don't assume `pnpm expo
  run:ios` targeting a physical device will "just work" the way Simulator
  builds eventually did; budget time for it in Phase B0.
- JWT helper (`jwt` shell function) and the general curl-verification habit
  from Track A still apply for any API-level testing during Track B.

---

## First message to send in the new chat

Something like:

> Starting Sprint 10 Track B. Apple Developer Program is purchased and
> [active / still pending — confirm which]. Read [relevant PLAN.md sections]
> and summarize back before any code. Scope: Phase B0 (real-device build +
> provisioning) first, then B1 (APNs), then B2 (AirPlay/Chromecast), then B3
> (TestFlight). Full context in the attached handoff doc.

Attach this document.