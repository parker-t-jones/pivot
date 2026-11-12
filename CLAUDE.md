# CLAUDE.md — Pivot

Read this before every task. It is the short version of how this repo works and what must never happen. The long specs are listed under "Docs"; this file wins where they are stale.

## What Pivot is

Pivot routes NFL viewers to the game that matters to them right now. Users add **picks** (fantasy starters via Sleeper or a manual lineup, spreads, totals, moneylines, survivor picks). A live pipeline watches ESPN play-by-play, flags a game when a pick becomes active (e.g. your RB's team has the ball), and sends a push / in-app alert with a one-tap "Watch on {service}" link. Pivot has no video rights: it deep-links into the user's own streaming service.

Status: **live on the App Store** ("Pivot: Fantasy & Picks Live") and on the web at `app.pivot-sports.app`. Real users depend on production. Solo developer: Parker. Treat every change as shipping to strangers.

## Repo layout (pnpm workspace)

| Path                   | Package             | Role                                                                                                                                                         |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/`                 | `@pivot/app`        | Expo / React Native client (iOS + web via react-native-web). Routes in `app/app/` (expo-router), components in `app/components/`, logic in `app/lib/`.       |
| `services/api/`        | `@pivot/api`        | Fastify REST + WebSocket (`src/index.ts`), lineup worker (`src/worker.ts`), live runner (`src/runner.ts`, `src/runner/`). One Fly app, three process groups. |
| `services/engine/`     | `@pivot/engine`     | Switching engine: flag computation, priority, resumption detection (`resumptionWatcher.ts`, `incrementalResumption.ts`).                                     |
| `services/dispatcher/` | `@pivot/dispatcher` | Deferred firing, rate limiting, delivery (Expo push, Web Push, realtime).                                                                                    |
| `services/ingestion/`  | `@pivot/ingestion`  | ESPN unofficial site API consumer (`EspnPlaySource`, `espnPlayTypeMap.ts`).                                                                                  |
| `shared/`              | `@pivot/shared`     | Shared types and pure logic (`broadcast/` destination resolver + watch links, `types/`).                                                                     |
| `supabase/`            | —                   | Migrations, `config.toml` (local stack).                                                                                                                     |
| `scripts/`             | —                   | Seeds and one-offs. All go through `scripts/remoteSafety.ts`.                                                                                                |
| `experiments/`         | —                   | Harnesses and live-capture tools. Unproven ideas start here, not in `services/`.                                                                             |
| `docs/`                | —                   | Design notes, runbooks, recon write-ups.                                                                                                                     |

Infra: Fly.io app `pivot-sports-api` (processes `api`, `worker`, `runner`; region `iad`), self-hosted Redis as Fly app `pivot-sports-redis` (not Upstash, whatever older docs say), hosted Supabase project ref `taucqrptzfyzhfzpinzo`, Cloudflare Pages project `pivot` for the web app (builds from `origin/main`), EAS for iOS builds, RevenueCat for Pro.

## Commands (run from the repo root unless noted)

```bash
pnpm install
pnpm test                 # THE test command: root vitest config. `pnpm -r test` / `pnpm --filter … test` run zero tests — never use them as a gate.
pnpm typecheck            # builds workspace packages, then tsc across root, experiments, and every package
pnpm lint                 # eslint, whole repo
pnpm format:check         # prettier
pnpm --filter @pivot/api dev        # local API on 127.0.0.1:3000
cd app && pnpm start                # Metro / Expo (press i for the simulator, w for web)
pnpm --filter @pivot/app exec expo export -p web --output-dir dist   # the Pages web build
pnpm db:types             # regenerate services/api/src/lib/database.types.ts from the LOCAL db after a migration
```

Local stack (Docker → `supabase start` → `pnpm seed:players` + `pnpm seed:schedule` → API → Metro) is in `RUNBOOK.md`. Its paths still say `.../projects/fantasyfocus`; the repo directory is `.../projects/pivot`.

Runtime gotcha: `@pivot/engine`, `@pivot/dispatcher`, `@pivot/ingestion`, `@pivot/shared` resolve to `./dist/index.js` at runtime. After changing their source, rebuild (`pnpm build` or `pnpm --filter <pkg> build`) before running the API, worker, runner, or a harness, or you will be running old code silently. Tests are unaffected (vitest aliases to source).

## Definition of done (the gates)

A task is not done until all of these pass, run serially (parallel suites cause timeouts that look like failures):

1. `pnpm test` → **0 failed**. The only allowed skips, by condition (anything else, or a new failure, is a fail):
   - Two Redis suites, 5 tests: always (they need `CACHE_DRIVER=redis` plus Upstash env vars).
   - `phiChiFlagDiff` replay, 1 test: when the gitignored recording `experiments/logs/recordings/2026-09-28/401872963` is missing (it exists only on Parker's Mac).
   - `publicGrants` (2 tests), `flagEventInsert` (1), and `accountDeletionCascade` (1), 4 tests: when `services/api/.env` does not point `SUPABASE_URL` at a loopback (local) Supabase. `flagEventInsert` and `accountDeletionCascade` also skip without `SUPABASE_SERVICE_ROLE_KEY`.
   - Expected skipped totals: CI (local Supabase, no recording) **6**; Parker's Mac (local Supabase running, recording present) **5**; fresh clone with no Supabase and no recording **10** (9 if the recording is present).
2. `pnpm typecheck` → exit 0.
3. `pnpm lint` → exit 0 (whole repo, not "touched files").
4. Tests written alongside the change, covering the behavior, not just the happy path. Where a UI bug slipped past unit tests before, add a test of the rendered path.

Report the actual numbers. Never claim a gate passed without running it.

## Product rules (non-negotiable)

- **Copy says "pick", never "stake".** "YOUR PICKS", "Add a pick", hero "TOP GAME". Code names (`stakes`, `add-stake` route, `Stake` types, API paths) stay as they are. Never use "push" to mean a tie in user copy (it collides with push notifications): say "tie" / "refunded". User-facing sentences are full sentences.
- **Nudge vs. reveal.** Every notification trigger is a routing NUDGE (reveals nothing, may fire immediately) or a REVEAL (states an outcome or number, must go through resumption timing). Never ship a REVEAL on fixed padding.
- **No "edge" positioning.** ESPN's feed runs ahead of the broadcast. Never expose that head start as a feature, especially to bettors.
- **Pivot never takes wagers**, never shows promo codes or affiliate links, and never nudges anyone to place a bet.
- **Free-tier caps are enforced server-side** with HTTP 403 + a snake_case `code` (e.g. `league_limit_free`, `stake_limit_free`); the client maps codes in `app/lib/upgradePrompt.ts`. Survivor picks do not count toward the 3 free bets. `users.subscription_tier` is written only by the RevenueCat webhook (service role); never add a client write path.
- **Prices come from RevenueCat.** Don't hardcode a price in copy or code (`scripts/upgradeCopy.test.ts` fails on a `$`-digit price in app source). With no store price the button reads "Upgrade to Pro" and a tap retries offerings. Launch price is $4.99/month.
- **The App Store reviewer demo account must keep working.** Users with `is_demo` are pinned to a fixture live game and lineup (`services/api/src/lib/demoAccount.ts`, `demoFixture.ts`, `demoAlert.ts`); writes are refused with `demo_account_fixed`. Don't break or bypass that path.

## Frozen identifiers — never change

- iOS bundle ID `com.fantasyfocus.app`
- EAS slug `fantasy-focus` (bound to `extra.eas.projectId`)
- `supabase/config.toml` `project_id = "FantasyFocusApp"` (renaming orphans the local DB volume)
- Apple Team ID `LY2XMRG6VY` (used in the AASA file)

They carry old product names on purpose. Do not "tidy" them.

## Code conventions

- TypeScript strict everywhere. No `any` escapes without a comment saying why.
- External integrations stay behind interfaces: `PlaybackSource`, `FantasyProvider`, `BroadcastResolver`, the destination resolver in `shared/src/broadcast/`. New providers are new implementations, not special cases sprinkled through callers.
- Prefer Fastify plugins over ad-hoc middleware.
- **UI:** use `app/lib/theme.ts` tokens and the shared primitives (`PrimaryButton`, `SecondaryButton`, `TextButton`, `TextField`, `ListRow`, `SegmentedControl`, `TeamBadge`, `YardLineLoader`, `Slip`, `Skeleton`, `LoadingState`, `ErrorState`). Use `Skeleton` blocks inside one `SkeletonGroup` for cold-load content with a known shape, the yard-line `LoadingState` for gates and short waits, and `ErrorState` for failures. No raw hex or magic numbers. The accent is `#F5A018` (pinned in `theme.test.ts`); `UI-SPEC.md`'s `#FFB020` is stale, never use it. Team colors come from `app/lib/teamColors.ts`; no team logos or trademarks.
- **Platforms:** web-specific code goes in `*.web.ts(x)` files. `Alert.alert` is a no-op on web: use `confirmAsync` / `alertAsync` from `app/lib/confirm.ts`. Desktop breakpoints: phone layout under 900px, two panes from 900, sidebar layout from 1280. Web and iOS can lay out differently (text metrics, hover, overflow); a web check is not proof of native layout.
- **Storage:** native uses SecureStore/AsyncStorage. On web, browser storage is only for per-device conveniences (snoozes, remembered UI state), wrapped in try/catch; anything that must persist or sync lives in the API/Supabase.
- **Preferences:** a new key needs three coordinated edits: `shared/src/types/preferences.ts` (zod, unknown keys are stripped), `app/lib/me.ts`, and the PATCH allow-list in `services/api/src/routes/me.ts`.
- **Migrations:** new files get a timestamp after the latest one in `supabase/migrations/`. New tables default to RLS on and service-role-only unless the client genuinely needs them. Regenerate types with `pnpm db:types`. Never edit an applied migration.
- **Don't gold-plate.** Build what the task asks. If something adjacent looks wrong, report it instead of fixing it unasked.
- Commit messages are one plain sentence describing the user-visible effect, e.g. "Keep opponent starters in their own Watchlist section, under the user's lineup."

## Safety rules — production, data, secrets

- **Never touch production unless the task explicitly says so and Parker has approved it in that task.** That includes: `fly deploy`, `fly secrets`, `fly scale`, `eas build`, `eas submit`, `eas update` / `pnpm update:ios`, `eas env:*`, `supabase db push` / `link` / any hosted-project command, Cloudflare dashboard settings, App Store Connect, and RevenueCat. Prepare the change and give Parker the exact commands instead.
- **Merging to `main` deploys the web app** (Cloudflare Pages builds `origin/main`). Work on a branch and open a PR. Never push to `main` directly.
- **EAS Update ships JS straight to installed iPhones** (`docs/EAS-UPDATE-RUNBOOK.md`). Sessions never run `eas update`, `pnpm update:ios`, `eas update:republish`, or `eas update:roll-back-to-embedded`. Every PR that touches `app/` or `shared/` says which it is:
  - **update-safe:** JS, copy, or assets only, so Parker can publish an update.
  - **needs a build:** a native package, `app/modules/*/ios`, a native `app.json` field, `app/eas.json`, or an SDK bump. When unsure, compare `npx expo-updates runtimeversion:resolve --platform ios` (run in `app/`) before and after the change; a different runtime means a build.
- **Never modify Parker's real account or any real user's data** (stakes, players, leagues, preferences, password). Manual checks use the local stack and the local test user.
- **Seeds** refuse non-localhost Supabase unless `--allow-remote`; never pass it without explicit approval. `seed:broadcasts` never runs against hosted.
- **Env files** (`.env`, `.env.local`, `.env.production`, `app/.env*`, `services/api/.env*`) are gitignored and hold real keys. Never commit them, never print secret values, never overwrite one you didn't create. In a new git worktree, **copy** env files (`cp`), never symlink: a write through a symlink once overwrote the production app env.
- **Game days:** no production deploys Thu, Sun, or Mon during the NFL season. Backend deploys go out Tue/Wed/Fri/Sat; anything touching iOS push or presence ships Tue–Wed only. Web (Pages) and EAS builds can go out any day, but not during live games.
- **Don't fix production live during a game.** The live slate is the only real feedback signal; capture, then fix after.
- Disk on Parker's Mac runs tight. Don't run a full native iOS build (`expo run:ios`) unless the task needs it and there is room; it writes several GB to Xcode's DerivedData.

## Workflow

1. **Recon first.** Read the relevant code and docs, then state what you found (files, current behavior, root cause) before editing. If the task's description of the code doesn't match the code, stop and say so; the code wins, and the mismatch is worth reporting.
2. **Branch per task** off `main`. Small, focused commits.
   Always branch from and open PRs against main. Never stack a PR on another PR's branch.
3. **Build and test together**, then run the gates.
4. **Report** in this shape: what changed (and why, for bugs: the root cause), anything you deliberately left alone, gate results with numbers, and manual check steps Parker can follow, each with the exact action and the expected result. Say plainly what you could not verify (e.g. native layout, live-game behavior, anything needing a device).
5. Stop at the PR. Parker reviews and merges.

## Docs (what each is for, and how stale)

- `PLAN.md` — the original v1 spec. Still authoritative for the core mechanic (§3 active-player rule, priority score), the engine (§8, including resumption detection), API contracts (§9), and the Known Issues log. Stale on: Upstash (now self-hosted Redis), "iOS only / no web" (web exists), "Cursor" workflow, and the Free/Pro table (see stakes plan §10 and current code).
- `PIVOT-STAKES-PLAN.md` — the stakes/picks model, triggers, ranking, monetization (§10), UI redesign (§11), onboarding/tutorial (§12). **§0 Guardrails apply to everything.**
- `UI-SPEC.md` — visual language ("sportsbook lounge"); a sidecar, not the source of truth. Its accent hex is stale.
- `docs/WEB-PLAN.md` — the web app's decisions, deploy, and Pro-entitlement notes.
- `docs/D1-DEPLOY-RUNBOOK.md`, `docs/W9-PAGES-RUNBOOK.md` — Fly and Pages deploy references.
- `docs/EAS-UPDATE-RUNBOOK.md` — update vs build, publishing JS-only fixes to iPhones, rollback.
- `RUNBOOK.md` — local dev startup (paths stale). `TESTING-RULES.md` — live-gameday harness procedure.
- `.cursorrules` — older Cursor rules; superseded by this file where they disagree (e.g. web may use browser storage as above; PLAN.md is no longer the only spec).

If you change behavior a doc describes, update the doc in the same PR, or say in the report that it is now stale.
