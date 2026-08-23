# Pivot — Sprint 10 Track B / Phase B3 Handoff

Written Aug 21, 2026, at the end of the B0–B2 + rename work. Read this with
`PLAN.md` (source of truth) and `RUNBOOK.md` (how to actually start things).

## Read this first: B3 is not a metadata task

The original Track B brief scoped B3 as "TestFlight build, confirm it installs
and runs for at least one other real tester, start App Store Connect
metadata/screenshots/review-prep." That framing assumed the app was otherwise
shippable. Investigating the codebase at the end of B2 says it is not, for a
reason that has nothing to do with the build pipeline:

**There is no deployed backend. At all.**

- No deploy config exists anywhere in the repo — no `fly.toml`, no `Dockerfile`,
  no Render/Railway/Vercel/Terraform config. `PLAN.md` §6 "Deployment topology"
  specifies "Single Fly.io app for v1. Three processes." None of it is built.
- Supabase is **local-only**. `supabase/config.toml` is a local stack
  (`api_url = "http://127.0.0.1"`), and there is no linked remote project
  (`supabase/.temp/project-ref` does not exist).
- The app's `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_API_BASE_URL` currently
  point at a **USB link-local Mac address** (`169.254.x.x`). These are inlined
  into the JS bundle at Metro/EAS build time.

Consequence: a TestFlight build handed to another person on another network
cannot sign in. It will fail at the first auth call. The B3 goal as written
("confirm it installs and runs for at least one other real tester") is
**unreachable** until a backend is deployed and the app is pointed at it.

This is the single most important thing to resolve before touching App Store
Connect. Do not start with screenshots.

## Status going in

### Verified working on real hardware (B0–B2)

- **B0** — app builds, signs and runs on a physical iPhone (iPhone 14,
  `00008110-000271113C86201E`). Team `LY2XMRG6VY`.
- **B1** — real-device APNs push **verified end to end**. Transport is
  device → Expo push token → `POST /me/push-token` → dispatcher
  `ExpoPushNotifier` → Expo Push API → APNs. There is no raw-APNs driver.
  APNs key: Developer Portal ID `82JW379P4C`, assigned to
  `@parkertjones/fantasy-focus` / `com.fantasyfocus.app`.
- **B2a** — AirPlay implemented natively, then found **not achievable as
  scoped**: with no owned/licensed video rights there is no player in-process,
  so the system offers only an _audio_ route and a chosen route does not
  transfer to the deep-linked streaming app. AirPlay + Chromecast are therefore
  **dormant** — deliberately absent from `createPlaybackSources()`. DeepLink
  always wins in v1. Do not "fix" this; see `PLAN.md` Sprint 8 notes and the
  `PlaybackSource.ts` header comment.
- **B2b** — Chromecast intentionally not built. Honest stub only
  (`canPlay: false`, `createSession` throws).
- **Deep links** — audited against live AASA files and corrected. Verified on
  device: a real YouTube TV game URL opens the YouTube TV app **directly to the
  playing game**.
- **Cold-start notifications** — fixed and device-verified across killed /
  backgrounded / foregrounded.

### Rename (done, Aug 21; renamed again Aug 23)

Product is **Pivot** as of Aug 23 (was **RosterRemote** since Aug 21, before that
Fantasy Focus / FantasyFocus; the Aug 21 rename was over a conflict with ESPN's
"Fantasy Focus" branding — see PLAN.md for both rename notes). The Aug 21 pass was
four commits: a vitest fix, the `@roster-remote/*` workspace scope, docs, and the app
surface. The Aug 23 pass repeated the packages/app-surface/docs categories, landing on
`@pivot/*` and "Pivot" — in-app/display branding only, same as before.

**Deliberately still on the old name — do not "tidy" these.** Full rationale is
in `PLAN.md`'s rename note; the short version:

| Thing              | Value                                            | Why it stays                                                                                                                                                       |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS bundle ID      | `com.fantasyfocus.app`                           | Changing it means a new Apple App ID, new provisioning, and re-doing B1's verified APNs setup, for zero user-visible gain                                          |
| EAS slug / project | `fantasy-focus` / `@parkertjones/fantasy-focus`  | Renaming needs a matching rename on expo.dev — the only remote-state change, against the project holding B1's push credentials. Deferred until TestFlight is green |
| Local Supabase     | `project_id = "FantasyFocusApp"`                 | Names the Docker containers; renaming orphans the local volume (seed data, test user, verified push token) silently                                                |
| Repo directory     | `.../projects/fantasyfocus`                      | GitHub repo is `roster-remote`; the local dir was never renamed. RUNBOOK `cd` paths depend on this                                                                 |
| Settings URLs      | `fantasyfocus.app/terms`, `/privacy`, `support@` | See blocker #4 below — needs a real domain, not a string swap                                                                                                      |

### Repo state

- Branch `main`, **11 commits ahead of `origin/main`** — nothing is pushed.
  Remote is `https://github.com/parker-t-jones/roster-remote`.
- Working tree clean. Typecheck clean. **590 tests pass**, 5 skipped.
- Pre-existing red that is NOT yours to fix unless you want to: `pnpm lint` has
  14 errors and `pnpm format:check` has 68 failures, both long-standing and
  unrelated to recent work. Verified identical before/after the rename.

## Hard blockers before a TestFlight build means anything

Ordered by how much they block. 1–3 are the real work.

**1. Deploy the backend.** See the top of this doc. `PLAN.md` §6 specifies a
single Fly.io app with three processes (API+WebSocket, ingestion, engine +
dispatcher). Nothing exists. Needs: hosted Postgres/Supabase project, migrations
applied, seed data loaded (`pnpm seed:players`, `pnpm seed:schedule`,
`pnpm seed:broadcasts`), Redis (code expects Upstash — `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_TCP_URL`), and `PUSH_DRIVER=expo`
(local default is `none`, a noop).

Full prod env surface, from the code: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CACHE_DRIVER`, the three `UPSTASH_*`,
`PUSH_DRIVER`. Client side: `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`.

**2. There is no live game data feed.** `services/ingestion/src/index.ts` is
literally `export {};`. Real-time Sportradar ingestion is listed _in scope_ for
v1 (`PLAN.md` §4 "v1 Scope" → "In scope") and is unbuilt. Today the engine is driven by
`replayPlaySource` — an nflverse play-by-play CSV replay harness intended for
tests and local dev.

This matters for what a tester can honestly be asked to evaluate: **the
game-day core loop cannot run in production.** A tester can exercise sign-up,
Sleeper league connect, lineup, schedule/Home states, Settings, deep links, and
push delivery (manually triggered). They cannot experience "my player just
became active, switch me to that game" from live NFL data. Decide deliberately
whether B3 ships without it, or whether ingestion comes first.

**3. No app icon.** There is no `icon` field in `app/app.json` and no
`app/assets/` directory — the build is using Expo's default template icon (the
built `.app` contains only `AppIcon60x60@2x.png` /
`AppIcon76x76@2x~ipad.png`). App Store Connect **requires** a 1024×1024 icon
with no alpha channel and no transparency. Also no splash screen configured.
This is a hard submission blocker and needs design work, not code.

**4. No live privacy policy or terms.** Settings links
`https://fantasyfocus.app/terms` and `/privacy` plus
`mailto:support@fantasyfocus.app`. App Store review requires a **reachable**
privacy policy URL. Filed as `PLAN.md` Open Question #5 and deliberately left
on the old name — a renamed URL that 404s during review is worse than an
honestly outdated one. Needs a registered domain serving two real pages.
Related: Open Question #8 (lawyer review of the policy _text_) is the other
half. You will also need to complete App Store Connect's App Privacy
questionnaire — the app collects email, push tokens and fantasy league data.

**5. `version` is `"0.0.0"`** in `app/app.json`. Set a real version (e.g.
`1.0.0`) before the first TestFlight upload. Note `app/eas.json` uses
`"appVersionSource": "remote"` and the `production` profile has
`autoIncrement: true`, so build numbers come from EAS, not the repo.

**6. Trademark clearance on "Pivot" has not been done.** Informal web
searches only — no USPTO TESS search, no counsel. `PLAN.md` Open Question #4.
Worth resolving before a public listing.

## Smaller things to know before you build

- **EAS credentials.** The APNs push key is set up and verified. An iOS
  **distribution** certificate and an App Store Connect API key (for
  `eas submit`) have **not** been verified as existing — check with
  `eas credentials -p ios` before assuming. An App Store Connect app record for
  `com.fantasyfocus.app` may also not exist yet.
- **`aps-environment`.** Dev builds get `development`. A TestFlight build gets
  `production`. The same APNs key covers both, so no new key is needed, but
  push should be re-verified on the TestFlight build rather than assumed —
  production APNs is a different endpoint.
- **App is iPhone-only** (`supportsTablet: false`), so screenshots are needed
  for iPhone sizes only.
- **A clean prebuild discards `DEVELOPMENT_TEAM`.** `app/ios/` is generated and
  gitignored. See RUNBOOK "AFTER A CLEAN PREBUILD" — it also lists the three
  commands for verifying the dormant AirPlay native module re-autolinked, which
  matters because `requireOptionalNativeModule` returns `null` on failure and
  a broken autolink is **completely silent**.
- **Restart the API dev server after any workspace package rename** — the `tsx`
  watcher holds stale module resolution. In RUNBOOK COMMON FIXES.
- **`EXPO_PUBLIC_*` and the drifting device IP.** USB link-local `en8` changes
  on every replug and the values are inlined at bundle time; a stale `.env`
  looks like "fetch failed: The request timed out" with no other clue. Bit us
  four times this session. There's a RUNBOOK backlog note for a
  `scripts/sync-device-env.ts` auto-detector — worth building early if you'll
  be doing repeated device builds.

## Open Known Issues a tester will plausibly hit

From `PLAN.md` Known Issues — none are regressions, all are filed:

- **cbs.com / nbc.com deep links have no usable AASA**, so those services open
  Safari rather than the app. Not fixable by us.
- **A Safari fallback is indistinguishable from success**, so the deep-link
  error state can never fire (v1.5).
- **Deep links open the right _app_, not the right _game_**, except where a real
  game URL is available — per-game links need each provider's internal content
  IDs (Open Question #2).
- **`display_phase` has no season-end bound** — after the 2026 season ends
  (~Jan 2027) it will incorrectly read `'regular'` through the 2027 offseason.
- **NFL schedule seed must be refreshed each season.**
- **Unpaginated `players` fetches silently truncate** at PostgREST's `max_rows`.
- **Offseason-connected Sleeper leagues go stale on renewal** (new `league_id`).
- **Broadcast timing is a heuristic** for multi-broadcast (Sunday afternoon)
  games — spoiler-safety only strictly holds for exclusive-window games.
- Section 10 fidelity gaps: star players is a flat list not a grid; Settings is
  a modal push not a tab.

## Decisions to get from Parker before writing code

1. **Sequencing.** Deploy the backend first (making TestFlight meaningful), or
   produce a TestFlight build against a throwaway hosted backend just to prove
   the pipeline, or build ingestion first? These are materially different
   sprints.
2. **Hosting.** `PLAN.md` says Fly.io + Upstash Redis + hosted Supabase. Confirm
   that's still the intent, and whether paying for it now is in scope.
3. **Scope of the tester test.** Given blocker #2, what is the tester actually
   being asked to validate? Onboarding and league connect only, or wait for
   live data?
4. **Icon and branding.** Who makes the 1024×1024 icon? Blocks submission.
5. **Domain.** What domain, and who stands up `/terms` and `/privacy`?

## Working conventions (carried from Track A/B — these earned their keep)

- **Read the relevant `PLAN.md` sections and summarize back before writing any
  code.** Mandatory gate.
- **Phase-by-phase: stop, report, wait for explicit go-ahead.** Do not batch.
- **Commit at each verified green gate**, not at the end.
- **Verify on real hardware, not test suites or claims in a report.** This
  project's repeated pattern is things passing clean tests and curl checks while
  still being broken in the actual app (a false preseason date, a navigation
  race, an empty-lineup bug, a silent cold-start notification drop).
- **Capture a baseline before mechanical work.** This is how the
  `notificationContent.test.ts` bug was finally caught — 25 push-content tests
  had been silently collecting _zero_ tests since Sprint 6 because a corrupted
  import made the suite fail at load time, which read as one red file among
  sixty. "Pre-existing, unrelated" is a label that stops investigation; it
  survived four sprints. Prefer proving a thing over assuming it, especially
  when the failure mode is silent.
- **No new dependencies by default.** Flag and get agreement (the Google Cast
  SDK was the one agreed exception, and ended up not needed).
- Don't gold-plate; don't add anything not in `PLAN.md`. Reference section
  numbers and ask before deviating.

## Quick reference

```
Repo          /Users/parkerjones/Developer/projects/fantasyfocus   (dir keeps old name)
Remote        https://github.com/parker-t-jones/roster-remote      (11 commits unpushed)
Bundle ID     com.fantasyfocus.app        Team LY2XMRG6VY
EAS project   @parkertjones/fantasy-focus  id 63e2ba9a-dc24-48cc-af2b-dc2c27014634
APNs key      82JW379P4C
Device        iPhone 14, UDID 00008110-000271113C86201E
Local API     pnpm --filter @pivot/api dev        (port 3000)
Tests         pnpm test        (590 pass, 5 skip)
Typecheck     pnpm typecheck   (clean)
```

Startup order, device build steps, signing fixes and push verification are all
in `RUNBOOK.md` — follow it rather than reconstructing.

## Suggested first message for the new chat

> Starting Sprint 10 Track B Phase B3 (TestFlight + App Store Connect prep).
> Before any code: read the attached B3-HANDOFF.md, plus PLAN.md §4 (v1 scope),
> §6 (services + deployment topology), the Open Questions section, and Known
> Issues — then summarize back what you found, specifically what you think the
> blockers are and in what order they should be tackled. Do not start on
> screenshots or metadata. I expect the handoff's claim that there is no
> deployed backend to be the leading issue; confirm or correct it from the
> actual repo state, then propose a phase plan and stop for my go-ahead.
