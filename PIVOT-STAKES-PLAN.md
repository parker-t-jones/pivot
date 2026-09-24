# Pivot — Stakes Model Expansion Plan

**Purpose:** Make Pivot's engine work for more than fantasy rosters. Generalize the "roster" into a **watchlist of stakes**. A stake is anything a user has riding on a game: a fantasy player, a player prop, a spread or total, a Kalshi contract, or a survivor pick. Everything downstream (triggers, ranking, routing nudges, reveals) should work off stakes, not rosters.

**Also covers:** monetization changes (Section 10), the Home/Watchlist visual redesign (Section 11), onboarding and the tutorial (Section 12), and how those phases interleave with the stakes work (Section 13).

**Audience:** Cursor, implementing in phases. Each phase is a gated commit set with a baseline, a before/after check, and explicit verification steps.

**Revision (Sept 24, 2026):** corrected against `docs/STAKES-PLAN-RECON.md` (repo at `f1e0963`). Where this plan and the recon disagree on a *fact about the code*, the recon wins. Flag any remaining mismatch instead of guessing.

### Repo facts every phase must use
- **Test command:** `pnpm test` at the repo root (root `vitest.config.ts`). `pnpm --filter app test` and `pnpm -r test` run **zero tests** and exit 0. Never use them as a gate.
- **Component tests:** the vitest config collects `.ts` only, in a `node` environment. There are no component tests, and adding a React Native testing setup is out of scope unless a phase says so. UI regressions are verified with before/after simulator screenshots.
- **Type check:** `pnpm typecheck`.
- **Paths:**
  - Home screen: `app/app/(app)/(tabs)/index.tsx`
  - Settings: `app/app/(app)/(tabs)/settings.tsx`
  - Paywall: `app/components/UpgradeSheet.tsx`, opened via `useUpgradeSheet().openUpgrade()`
  - Home branch logic: `app/lib/homeState.ts` (`resolveHomeBranch`)
  - Purchases: `app/lib/purchases.ts`
  - Billing webhook: `services/api/src/routes/billing.ts`
- **Home branch names in code:** `state1`, `state2`, `state3`, `state4`, `season_idle` (with `variant: 'off' | 'pre'`; this plan's "State 4a"), and `no_leagues` (this plan's "State 5").
- **Captured live fixtures:** `experiments/logs/events-<ISO timestamp>.jsonl` (plus `markers-*.jsonl`). This plan's older references to `plays-<date>.jsonl` mean these files. Their replayability is **unverified**, so confirm the shape before relying on them.
- **Accent:** the real accent is **`#F5A018`** (rgb 245,160,24), pinned in `app/lib/theme.test.ts`. `UI-SPEC.md`'s `#FFB020` is stale. Never introduce `#FFB020`.
- **Free-tier cap convention:** HTTP **403** with a snake_case `code` (`league_limit_free`, `manual_lineup_limit_free`, `watched_league_limit_free`). The client matches codes in `app/lib/upgradePrompt.ts`.
- **Preferences:** zod schema in `shared/src/types/preferences.ts`. Unknown keys are **silently stripped**. A new key needs three coordinated edits: that schema, the client mirror `app/lib/me.ts`, and the PATCH allow-list in `services/api/src/routes/me.ts`.

---

## 0. Guardrails (read first, apply to every phase)

1. **Prerequisite: Phase P0 (production live pipeline).** Stakes Phases 1–5 and UI phases U4/U6 are blocked until P0 is merged and verified on device. The recon found **0 of 4** pipeline fixes merged. More fundamentally, **there is no production live-ingestion runner**: `services/api/src/worker.ts` only syncs lineups, and the only path from ESPN to a notification is `experiments/live-sunday-harness.ts`. P0 is its own planned phase (separate prompt), covering:
   - a production ingestion runner that owns one `EspnPlaySource` per live game and runs `subscribe()` loops concurrently (port the `Promise.all` pattern from the harness);
   - `watchForResumption` driving `scheduledFireAt` in the dispatcher, replacing the fixed `lagSecondsFor` padding in `scheduleFlagEvent.ts`;
   - a wall-clock ceiling-on-silence timer owned by the runner (today the ceiling in `resumptionWatcher.ts` only fires when a later play arrives);
   - per-game notification collapse (see §3 rules). This is **not** simply re-keying the rate limiter, which would loosen the global cap.

   UI phases U1–U3, U5 and M1 do **not** depend on P0. M2 and U7 depend on it indirectly, through stakes Phase 3.
2. **Frozen identifiers are untouched:** bundle ID `com.fantasyfocus.app`, EAS slug `fantasy-focus`, Supabase `project_id: FantasyFocusApp`.
3. **No production deploys on live-game days** (Thu, Sun, Mon during the NFL season). Unproven data sources and triggers go into `experiments/` first and are validated against real games before they are promoted.
4. **Nudge vs. reveal classification is mandatory.** Every new trigger must declare `kind: 'NUDGE' | 'REVEAL'`.
   - Any notification copy that states an outcome or a number is a **REVEAL**. Examples: "Taylor is at 92 yds", "the game is now within 3", "the Over is 4 pts away".
   - REVEALs must go through reveal timing: the resumption watcher, not a fixed delay. Today the dispatcher uses **only** fixed padding (`scheduleFlagEvent.ts`), and P0 replaces it. No new REVEAL trigger ships before P0. NUDGEs can fire immediately.
5. **No "edge" positioning.** ESPN's feed is near-instant, and the user's broadcast lags behind it. Pivot therefore sees outcomes before the user's stream shows them.
   - That is exactly why REVEALs are held back to match the user's stream.
   - Pivot must never expose that head start as a feature. For Kalshi and live-bet users in particular, no copy, setting, or "instant mode" should deliver outcomes ahead of the broadcast or imply a trading advantage.
   - Pivot is an attention router, not a faster data source.
6. **No sportsbook or exchange credentials stored in v1.** Stakes come from manual entry, public market data, or Sleeper OAuth only.
   - Credential sync (the Pikkit/BookSync pattern) and Kalshi portfolio API keys stay out of scope.
   - Either would bring security and compliance burden that isn't justified yet.
7. **Pivot never takes wagers, never displays promo codes or affiliate links, and never pushes users toward placing bets.**
   - Keep App Store review risk (gambling-adjacent content) low.
   - Add a short responsible-play line in Settings.
   - Parker to get a legal read before any monetization tied to betting or prediction-market partners.

---

## 1. Target user segments (priority order)

| # | Segment | What they have riding | Why Pivot fits | Phase |
|---|---|---|---|---|
| 1 | Fantasy managers (existing) | Their own roster | Core v1 | Done |
| 2 | Fantasy managers, opponent view | Opponent's roster in this week's matchup | Low build cost via Sleeper matchups; high emotional value | P2 |
| 3 | Sportsbook bettors: spreads, totals, moneylines | Team or game outcomes | Late-game leverage moments are the most watch-worthy | P3 |
| 4 | Survivor / pick'em pool players | One team per week, or a slate of picks | "Your survivor pick is trailing in the 2H" | P3 |
| 5 | Player-prop & pick'em players (DraftKings, FanDuel, PrizePicks, Underdog) | Player stat thresholds | Threshold-approaching triggers | P4 |
| 6 | Prediction-market traders (Kalshi) | Game, spread, total, and player contracts | Same stakes, different source; public market data lets users pick a contract instead of typing it | P5 |
| 7 | DFS players | 8–9 players spread across a slate | Heavy multi-game juggling; ranking matters most | P4 (falls out of prop + roster work) |
| 8 | Handicappers, content creators, group chats | Shared card of picks | Shareable watchlists that followers import | P6 |

---

## 2. Core abstraction: the Stake model

Create a new package-level module in `@pivot/engine`: `src/stakes/`.

```ts
// @pivot/engine/src/stakes/types.ts
export type StakeSource =
  | 'SLEEPER_ROSTER'
  | 'SLEEPER_OPPONENT'
  | 'MANUAL'
  | 'KALSHI_MARKET'
  | 'SHARED_LIST';

export type StakeSubject =
  | { type: 'PLAYER'; playerId: string; teamId: string }
  | { type: 'TEAM'; teamId: string }
  | { type: 'GAME'; gameId: string };

export type StakeCondition =
  | { type: 'ROSTERED' }                                   // fantasy: any involvement matters
  | { type: 'OPPONENT_ROSTERED' }                          // fantasy: watch to worry
  | { type: 'STAT_OVER'; stat: StatKey; line: number }     // props, pick'em
  | { type: 'STAT_UNDER'; stat: StatKey; line: number }
  | { type: 'MONEYLINE'; side: 'TEAM' }
  | { type: 'SPREAD'; line: number }                       // from subject team's perspective
  | { type: 'TOTAL_OVER'; line: number }
  | { type: 'TOTAL_UNDER'; line: number }
  | { type: 'SURVIVOR' };

export type StatKey =
  | 'RUSH_YDS' | 'REC_YDS' | 'PASS_YDS' | 'RECEPTIONS'
  | 'RUSH_ATT' | 'PASS_TD' | 'ANY_TD';

export interface Stake {
  id: string;
  userId: string;
  season: number;
  week: number;
  gameId: string;               // resolved at creation
  subject: StakeSubject;
  condition: StakeCondition;
  source: StakeSource;
  sourceRef?: string;           // e.g. Kalshi ticker, Sleeper league id
  weight: number;               // user-adjustable importance, default 1
  createdAt: string;
}
```

Design notes:
- An existing roster player becomes `subject: PLAYER` + `condition: ROSTERED` + `source: SLEEPER_ROSTER | MANUAL`. **No behavior change for current users.**
- `gameId` is resolved at creation from the ESPN schedule. A stake is always tied to exactly one game.
- `weight` feeds ranking (Section 4). Default 1. Set it higher for a starter than a bench player, and higher for a bigger bet if the user chooses.
- Keep evaluators as pure functions (`(stake, gameState, playerStats) => Trigger[]`). This way they are fully testable with fixtures, the same as `resumptionWatcher`.

---

## 3. Trigger catalog

Each evaluator emits triggers:

```ts
interface Trigger {
  stakeId: string;
  gameId: string;
  code: TriggerCode;
  kind: 'NUDGE' | 'REVEAL';
  leverage: number;
  dedupeKey: string;
}
```

`leverage` is a 0–1 score.

| Condition | Trigger | Kind | Rule (defaults, all configurable) |
|---|---|---|---|
| ROSTERED | `POSSESSION_START` | NUDGE | Existing behavior |
| ROSTERED | `RED_ZONE` | NUDGE | Existing `FieldGauge` red-zone detection |
| OPPONENT_ROSTERED | `OPP_RED_ZONE` | NUDGE | Opponent's player's team enters red zone |
| STAT_OVER | `PROP_NEAR` | REVEAL | Current stat ≥ 80% of line, **or** remaining need ≤ one typical big play (rush 15, rec 25, pass 40 yds) |
| STAT_OVER | `PROP_LIVE_POSSESSION` | NUDGE | Player's team gains possession while prop is unresolved and near |
| STAT_UNDER | `PROP_DANGER` | REVEAL | Same thresholds as `PROP_NEAR`, inverted framing |
| MONEYLINE / SURVIVOR | `ONE_SCORE_LATE` | REVEAL | Q4 or OT, margin ≤ 8 |
| SURVIVOR | `PICK_TRAILING_2H` | REVEAL | 2H, pick team trailing |
| SPREAD | `SPREAD_SWING` | REVEAL | Q4, cover margin within ±3 of the line |
| TOTAL_OVER / UNDER | `TOTAL_SWING` | REVEAL | Q4, points needed to hit total ≤ 7 |
| any | `GAME_FINAL` | REVEAL | Resolution summary (optional, off by default) |

Rules:
- Once P0 lands, every REVEAL goes through reveal timing via the resumption watcher. No exceptions and no fixed-delay fallback. (Today the fixed delay is the *only* path. That's why new REVEALs are blocked on P0.)
- Gap to resolve before Phase 3/4 ship: the resumption watcher anchors on possession changes. Mid-drive REVEALs (`PROP_NEAR` on a play that doesn't change possession, `SPREAD_SWING` after a field goal) have no possession change to anchor on. Options to decide between:
  - defer those REVEALs to the next resumption point;
  - send them as outcome-free NUDGEs instead ("Taylor's prop is in play — tap to switch");
  - design a new anchor.
  See Open Question 4.
- NUDGE copy must be outcome-free. Allowed: "Colts have the ball — tap to switch." Not allowed: "Colts have the ball and Taylor needs 9 yds."
- Dedupe per `(userId, stakeId, code, drive)` so a user gets one `PROP_NEAR` per drive, not one per play.
- **Per-game collapse (built in P0; it does not exist today).** The rate limiter is keyed by user only (`user_notifications:{user_id}`, 3 per 60s globally). **Keep that global cap.** Add a separate per-`(userId, gameId)` collapse step *before* the rate limiter: triggers from multiple stakes in the same game within one reveal window merge into one notification, and the highest-leverage trigger supplies the copy. Re-keying the limiter itself to `(userId, gameId)` is **not** the fix, because it would allow 3 notifications per game instead of 3 overall.

---

## 4. Ranking across games ("what should I be watching right now")

Generalize the existing "Also Flagged" priority promotion/demotion logic:

```
gameScore(game) = Σ over user's stakes in game: stake.weight × maxLeverage(active triggers for stake)
                + small bonus for game-level leverage (one-score Q4) even with zero stakes, off by default
```

- The top game becomes the primary card. The rest go to "Also Flagged".
- Keep the existing eight priority tests passing unchanged. Roster-only users must get identical rankings. This is the regression gate for Phase 1.

---

## 5. Data sources

| Source | Used for | Status | Notes |
|---|---|---|---|
| ESPN summary `plays` | Possession, red zone, score, clock | Live | Existing ingestion |
| ESPN summary boxscore / player stats | `STAT_*` conditions | **Needs probe** | Validate field names, update cadence, and lag vs. play log in `experiments/` before building evaluators |
| ESPN scoreboard `odds` (if present) | Prefill spread/total lines | **Needs probe** | Convenience only; the user's own line always wins |
| Sleeper `/league/{id}/matchups/{week}` | Opponent roster | Needs wiring | Opponent = same `matchup_id`, different `roster_id` |
| Kalshi public market data (Trade API v2 events/markets) | Let users search and pick an NFL contract; parse it into a Stake | **Needs probe** | Read-only public endpoints; no user auth, no portfolio access. Confirm endpoint paths, ticker format, and how game/player/line are encoded before designing the parser |
| Manual entry | Everything | Extend | New "Add a stake" flow |
| Bet-slip screenshot OCR (on-device Vision) | Sportsbook bets without APIs | Later (P6) | Parse on-device; user confirms each parsed stake before saving |

All new sources go behind interfaces in `@pivot/ingestion`, following the same swap-ready pattern as the ESPN adapter and `BroadcastIdResolver`. Examples: `PlayerStatSource`, `MarketCatalogSource`.

---

## 6. Database (Supabase migrations)

New tables. Existing roster tables are **not dropped**.

- `stakes`: columns mirror the `Stake` interface. `subject` and `condition` are stored as `jsonb` with a `CHECK` on the `type` keys. Index on `(user_id, season, week)` and on `game_id`. Add RLS so a user can only read and write their own rows.
- `stake_trigger_log`: `(stake_id, code, drive_key, fired_at, kind)`. Used for dedupe and analytics.
- `shared_lists` (P6 only): owner, slug, and a frozen array of stakes. Readers copy stakes into their own rows. Never subscribe live to someone else's rows.

Migration strategy for Phase 1:
- Write-through. The existing roster writes also upsert matching `ROSTERED` stakes.
- A one-time backfill script converts current rosters into stakes.
- The engine reads from `stakes`.
- Keep the old read path behind a flag for one week, then remove it.

---

## 7. UI changes (follow `UI-SPEC.md` and `theme.ts` tokens; reuse existing primitives)

The full visual redesign (Home, Board | My card, Watchlist, tokens) is specified in **Section 11**, and onboarding and the tutorial in **Section 12**. This section covers only the stake-specific screens.

- **Onboarding:** see Section 12.
- **Add a stake:** a single entry point with a type picker. Each type is a short form (player + stat + line, team + spread, and so on).
  - Use the existing `TextField`, `ListRow`, and `PrimaryButton` primitives.
  - Kalshi type: search box → pick a market → confirm the parsed stake.
- **Watchlist screen:** layout per Section 11.4. Each stake card shows the condition in plain language ("Over 100.5 rush yds", "DET −3.5"). Swipe to delete, tap to adjust weight.
- **Game card:** show which stakes put this game on screen (small chips). Keep `FieldGauge` as is.
- **Settings:** responsible-play line, and per-trigger toggles. Default on: possession, red zone, prop near, one-score late. Default off: final summaries.
- Do not coerce stake rows into `ListRow` if they need a structurally different layout. The same principle as `PlayerPicker` applies.

---

## 8. Phases

Every phase ends with: all existing tests green, new tests green, on-device check by Parker (Cursor's own success report is not sufficient), and a commit.

### Phase 1 — Stake model, migration, zero behavior change
- Add `stakes/types.ts`, evaluator interface, and a `ROSTERED` evaluator that reproduces current triggers.
- Supabase migration + backfill script + write-through.
- Route the engine through stakes.

**Verify:**
1. Before any edits, run `pnpm test` at the repo root and save the output as the baseline.
2. Replay a captured `experiments/logs/events-<ISO>.jsonl` fixture (confirmed replayable in P0) through the old path and save the emitted notifications to `baseline-notifications.json`.
3. After the change, replay the same fixture through the stakes path. Diff against the baseline. **Expect zero differences.**
4. Run the backfill against a local Supabase. Expect: `select count(*) from stakes where condition->>'type'='ROSTERED'` equals the total rostered players across users.
5. On device: sign in with a Sleeper account. The roster, game cards, and "Also Flagged" should look identical to before.

### Phase 2 — Opponent tracking (Sleeper matchups)
- `SLEEPER_OPPONENT` source and `OPPONENT_ROSTERED` evaluator (`OPP_RED_ZONE` only).
- A toggle on the watchlist: "Also watch my opponent". Default off.

**Verify:**
1. Unit tests with a recorded Sleeper matchups JSON. The opponent is the roster with the same `matchup_id` and a different `roster_id`.
2. Check the bye-week case: no `matchup_id`. Expect no opponent stakes and no error.
3. On device with a real league: enable the toggle. Opponent players appear in a separate "Opponent" group, and ranking weights them below the user's own players.

### Phase 3 — Team & game stakes (spread, total, moneyline, survivor)
- Evaluators for `ONE_SCORE_LATE`, `PICK_TRAILING_2H`, `SPREAD_SWING`, `TOTAL_SWING`.
- Manual add flows. Optional line prefill only if the ESPN odds probe succeeds.

**Verify:**
1. Build fixture games covering: a blowout (no triggers), a one-score Q4 (trigger), OT, a spread push, and a total landing exactly on the line.
2. Unit tests for each evaluator's boundary values (margin 8 vs. 9; points needed 7 vs. 8).
3. Replay a recorded full game. Every emitted trigger must be `REVEAL` and must pass through reveal timing. Assert this in the test, not just by inspection.

### Phase 4 — Player prop thresholds
- **4a (experiments):** `experiments/espn-boxscore-probe.ts` polls summary player stats during a live game. Log per-poll stat values alongside play-log timestamps. Answer three questions: Does the boxscore update on the same poll as the play? Are there lagging corrections? What are the exact field paths?
- **4b:** `PlayerStatSource` adapter, then the `STAT_OVER` and `STAT_UNDER` evaluators, the `PROP_NEAR`, `PROP_DANGER`, and `PROP_LIVE_POSSESSION` triggers, and per-drive dedupe.

**Verify:**
1. The 4a probe report is committed in `experiments/` with a summary of findings before any 4b code is written.
2. Unit tests: exactly at 80%, one yard under 80%, a stat correction that *decreases* a total (expect no duplicate fire and no crash), and a player who leaves the game.
3. Replay a game with a known 100+ yd rusher. Expect exactly one `PROP_NEAR` per qualifying drive.

### Phase 5 — Kalshi market linking (read-only)
- **5a (experiments):** `experiments/kalshi-market-probe.ts` lists the current week's NFL events and markets from the public API. Dump the ticker, title, and rules text for game winner, spread, total, and player markets. Document how team, player, and line are encoded.
- **5b:** `MarketCatalogSource` + `KalshiMarketCatalog` adapter, and a parser (ticker/rules → `Stake`). Search UI in the add-stake flow. Markets that can't be parsed show "Can't track this market yet" instead of guessing.
- Out of scope: portfolio import, API keys, order placement, and price alerts.

**Verify:**
1. Parser tests against the saved 5a dump. Every fixture must map to an expected `Stake` or an explicit `UNSUPPORTED`.
2. Resolve team names to ESPN team IDs. Test all 32 teams, plus any abbreviation mismatches found in 5a.
3. On device: search "Chiefs", pick the game-winner market, and confirm the stake appears as `MONEYLINE` on the correct game.

### Phase 6 — Later (not for this handoff)
Shared watchlists (handicappers and group chats), bet-slip OCR, NBA/MLB/NCAA via new ingestion adapters, and Polymarket or other exchanges once their US data access has been verified.

---

## 9. Open questions for Parker (decide before the phase that needs them)

1. Phase 3: should game/team stakes be available to all users, or only after the user selects "Bets & props" in onboarding? (Recommendation: available to all, surfaced by selection.)
2. Phase 4: are the default prop thresholds (80% / one big play) right, or should the thresholds be user-set per stake?
3. Phase 5: is Kalshi worth building before a legal read on marketing to prediction-market users? The feature itself is read-only and low risk. The positioning is the part to check.
4. Phases 3–4: how should REVEALs that don't follow a possession change be timed? (Recommendation: send them as outcome-free NUDGEs in v1, since that sidesteps timing entirely, and revisit once live data on mid-drive triggers exists.)
5. Phase M1: final Season Pass price. $34.99 is the working number (Section 10.2).
6. Phase M1: are Kalshi market search and per-trigger alert tuning Pro-only, or free? (Recommendation: free at launch. Gate volume, not features, per Section 10.1. Revisit once there's usage data.)
7. Phase 6: are shared watchlists free? (Recommendation: yes. Like opponent tracking, they're a growth lever.)

**Decided (Sept 23–24, 2026):**
- Free bet cap is **3** non-fantasy stakes per week.
- Opponent tracking is **free** and doesn't count toward any cap.
- A **Season Pass** is added next to monthly Pro.
- Home is **one screen built on the Board layout (direction A)**, with a **Board | My card** switch. There is no day-of-week screen swapping and no sidebar.
- The palette stays **amber on black with the existing warm neutrals**. Cool-slate neutrals were considered and rejected.
- (Sept 24, after the recon) The ladder is built around the **real accent `#F5A018`**. U1 is additive, not a palette migration.
- `flare` `#FFC94D` is approved as a live-only exception to the single-accent rule.
- The stake cap follows the existing **403 + snake_case code** convention (`stake_limit_free`).
- Pro gating moves to a read-time `isPro` predicate. The webhook-written `subscription_tier` is no longer trusted on its own.
- Per-game notification collapse is built as a step *before* the unchanged global rate limiter.

---

## 10. Monetization (updates `PLAN.md` §3 "Monetization")

### 10.1 Principles
1. **Gate how much a user tracks, never whether it works.** Spoiler-safe reveal timing, routing nudges, deep links and ranking are identical on Free and Pro.
2. **The paywall appears only when a cap is hit.** It never appears in onboarding or before the user has seen the product work.
3. **Opponent stakes ride free.** `SLEEPER_OPPONENT` stakes never count toward any cap, since opponent tracking is how Pivot spreads through a league.

### 10.2 Tiers

| | Free | Pro |
|---|---|---|
| Connected leagues | Max **3** (unchanged) | Unlimited |
| Watched leagues (Active Lineup) | Exactly **1** (unchanged) | Multi-select |
| Manual lineup size | Max **9** (unchanged) | Unlimited |
| Bet / market / pool stakes | Max **3 per NFL week** (new) | Unlimited |
| Opponent tracking | Included | Included |

- **What counts toward the 3:** any stake whose `condition.type` is not `ROSTERED` or `OPPONENT_ROSTERED`. That covers props, spread, total, moneyline, survivor and Kalshi stakes.
- **When the count resets:** it's scoped to `(user_id, season, week)`. A deleted stake frees its slot.
- **Where it's enforced:** on the API. `POST /stakes` returns **403** with `code: 'stake_limit_free'` and `details: { limit: 3 }`, matching the existing cap convention. Add `stake_limit_free` to the code list in `app/lib/upgradePrompt.ts` so the paywall opens. Never enforce only on the client.

### 10.3 Products (RevenueCat)
- `pivot_pro_monthly`: existing, $9.99/month, auto-renewing.
- `pivot_pro_season`: **new**, a **non-renewing subscription**. Working price $34.99, which is about 36% off paying monthly from September through the Super Bowl.
  - Expires **the day after the Super Bowl**. For the 2026 season that's Feb 15, 2027; the Super Bowl is Feb 14, 2027. Store the expiry in config per season. Don't hard-code it.
  - Apple requires non-renewing subscriptions to work on all of a user's devices. The Supabase account covers that: the entitlement lives server-side.
- **Entitlement model:** gate on a shared read-time predicate, not on the cached column.
  - Add `users.pro_expires_at timestamptz null` (a migration, plus the `database.types.ts` update).
  - Add `isPro(user: { subscription_tier, pro_expires_at }, now)` in `shared/`, with unit tests. It returns `true` when `subscription_tier === 'pro'` (monthly, maintained by the webhook's grant and revoke events) **or** `pro_expires_at > now`.
  - **All 5 server gating reads** move to `isPro`:
    - `leagues.ts` `assertCanConnectLeague`
    - the connect-league flow
    - the manual-lineup cap in `leagues.ts`
    - the watched-league cap in `me.ts`
    - `watched-leagues.ts`

    That way a lapsed season pass stops being Pro at the exact expiry moment, with no event and no cron job.
  - `GET /me` and `PATCH /me/preferences` add a computed `is_pro: boolean` to the response. **All client read sites** switch from `me.subscription_tier === 'pro'` to `me.is_pro`: `UpgradeSheet.tsx`, `ActiveLineupPicker.tsx`, `connect-team.tsx`, `edit-manual-lineup.tsx` and `settings.tsx`.
  - The webhook sets `pro_expires_at` on `NON_RENEWING_PURCHASE` for the season product. That event type is already in `GRANT_TYPES`. **Don't** set `subscription_tier = 'pro'` for season-pass purchases. Leave that column for monthly only, so the two sources never fight.
  - Pass-through reads (`flags.ts`, `lineup-sync.ts`) switch to `isPro` as well, for consistency.
- **Purchases client (real-money fix):**
  - `getProMonthlyPackage()` in `app/lib/purchases.ts` falls back to `current.availablePackages[0]`. With two products in the offering, that fallback could charge the Season Pass price under a monthly button.
  - Replace it with `getPackage(productId)`, which does an **exact product-id match only**. It returns `null` when nothing matches, and the paywall hides that option instead of guessing.
  - Add `PRO_SEASON_PRODUCT_ID = 'pivot_pro_season'`.
- **Dashboard prerequisite (Parker, before M1):** create `pivot_pro_season` in App Store Connect and in RevenueCat, attached to the `pro` entitlement. Whether RevenueCat sends `EXPIRATION` for it doesn't matter anymore, because `isPro` reads the expiry directly.
- **Late-season policy:** hide `pivot_pro_season` from the paywall after a configurable week. Default: after Week 12, `SEASON_PASS_LAST_WEEK = 12`. After that week, only monthly is offered.
- Out of scope for now: annual SKU, family sharing, win-back offers, and the August "Pivot is back" push for lapsed season-pass users. That push is a later scheduled job; note it in PLAN.md.

### 10.4 Paywall copy and layout
Keep the existing floating Pro card treatment. It's the reference design for the "slip" component (Section 11.2). Update the content:

```
PIVOT PRO                                   Close
Track everything you've got riding.
Free covers 3 leagues, 1 Active Lineup and 3 bets a week. Pro removes the caps.
▸ Unlimited leagues and Active Lineups
▸ Unlimited bets, props, markets and pools
▸ Unlimited manual lineup players

[ Season Pass — $34.99 ]        ← primary, gold
  Through the Super Bowl · Save 36% vs. monthly
[ $9.99 / month ]               ← secondary
Restore purchases                Not now
```

- **The savings line is computed, not hard-coded:** `1 − seasonPrice / (monthlyPrice × monthsRemainingUntilExpiry)`, rounded down. Hide the line if the result is under 10%.
- **Context line:** when the cap-hit code is `stake_limit_free`, add a line above the headline: "You've tracked 3 bets this week."

### 10.5 Verify (Phase M1)
1. **Sandbox purchase:** in a sandbox build, buy the Season Pass with a sandbox Apple ID. Expect:
   - `users.pro_expires_at` equals the configured date;
   - `subscription_tier` is **unchanged**;
   - `GET /me` returns `is_pro: true`;
   - the Pro UI unlocks without a relaunch.
1b. **Expiry boundary:** in a local database, set `pro_expires_at` to one minute from now for a test user. Before it passes, connecting a 4th league succeeds. After it passes, the same request returns `403 league_limit_free`. Nothing else needs to run in between. Also run the `isPro` unit tests with `pnpm test`.
1c. **Package resolver:** unit-test `getPackage` with an offering that contains only `pivot_pro_season`. `getPackage('pivot_pro_monthly')` must return `null`, never the season package.
2. **Stake cap:** as a Free user, add 3 spread stakes. The 4th `POST /stakes` should return `403` with `code: 'stake_limit_free'`, and the paywall should open with the context line.
3. **Opponent stakes don't count:** as a Free user with opponent tracking on and 14 opponent players, add 3 bet stakes. All succeed. The cap is still hit only on bet #4.
4. **Late-season hide:** set `SEASON_PASS_LAST_WEEK` to the current week minus 1. The paywall should show monthly only.
5. **Restore:** run restore purchases on a second sandbox device. Pro should restore from `pro_expires_at`.

---

## 11. UI redesign (supersedes `UI-SPEC.md` for Home; fold into `PLAN.md` §10 when shipped)

Reference mockups are on the "Pivot Mid-Week Home Directions" design canvas, rows **V2** and **Amber ladder tokens**. Parker can share screenshots with Cursor. The first row (A/B/C) and the palette row are exploration only. **Don't build the Felt, Floodlight, Midnight or Slate palettes.**

### 11.1 Tokens: add the amber ladder to `app/lib/theme.ts`
Additive only. **No existing key or value changes.** If any existing assertion in `theme.test.ts` would need editing, stop and ask. The ladder is built around the **real** accent `#F5A018` (rgb 245,160,24). The design canvas mockups used `#FFB020`, and the difference is imperceptible. Don't port canvas hexes directly.

| Token | Value | Use |
|---|---|---|
| `colors.ember` | `rgba(245, 160, 24, 0.05)` | Translucent tint for board rows with a stake |
| `colors.emberSolid` | `#17120F` | Opaque ember (`ember` composited over `background` `#0B0B0F`), for surfaces that can't be translucent |
| `colors.brass` | `#A07C38` | Eyebrows, secondary labels, countdowns. **Never body text** (contrast is ~5:1) |
| `colors.accent` | `#F5A018` (**existing, unchanged**) | Actionable or today: CTAs, stake markers, game-day kickoff times, selected segment |
| `colors.flare` | `#FFC94D` | **Live only:** LIVE eyebrow dot, Now Active eyebrow, possession marker. A lighter tint of the same hue family, not a second accent (see note) |
| `colors.well` | `#070709` | Recessed surfaces (board, segmented-control track) |
| `colors.wellBorder` | `#1E1E25` | Stroke on wells |
| `colors.rowDivider` | `#16161B` | Hairlines between board rows |
| `effects.flareGlow` | `{ shadowColor: '#FFC94D', shadowOffset: {width:0,height:0}, shadowOpacity: 0.25, shadowRadius: 24, elevation: 10 }` | Live hero card only. Same shape as `panelGlow` |

**Note on `flare` vs. the "competing accent colors" decision:** Parker has approved `flare` as a deliberate, scoped exception. It is the accent's highlight, used only while something is live, and never for CTAs, borders or resting states. `accent` stays the single interactive color. Record this in `UI-SPEC.md` when U1 ships.

Color rules (add them to UI-SPEC):
- Amber never means warning or error. Danger stays `#FF5A5A`, and the field gauge's red zone stays red.
- Flare and its glow appear only when something is live. Stillness means nothing is happening.
- Team colors are the second accent. Use them only as stripes, bands or washes, never as text color on black.

### 11.2 New shared components
- **`SegmentedControl`** (`app/components/SegmentedControl.tsx`):
  - Track: 44pt tall, `well` fill, `wellBorder` stroke, radius 12.
  - Selected segment: `surfaceRaised` fill, `accent` label.
  - Labels in JetBrains Mono, uppercase.
  - Accessibility role `tablist`, with `tab` for each segment.
  - Props: `segments`, `value`, `onChange`.
- **`Slip`** (`app/components/Slip.tsx`): generalize the Pro card surface in `app/components/UpgradeSheet.tsx` (the `card` style).
  - **Surface recipe, lifted verbatim from `UpgradeSheet`:**
    - `backgroundColor: theme.colors.background`
    - `borderColor: theme.colors.accentBorder`
    - `borderRadius: theme.radii.lg`
    - `borderWidth: theme.effects.panelBorderWidth`
    - `...theme.effects.panelGlow`
  - **Props:**
    - `children`;
    - `style` override (the paywall passes its modal-specific `maxHeight: '80%'`, padding and width through this, and they don't move into `Slip`);
    - `onPress?`: when provided, render a `Pressable`, otherwise a `View`. The paywall passes `onPress={() => {}}` to keep blocking taps from reaching the backdrop;
    - `elevated?: boolean`, **default `false`**: adds an offset drop shadow for floating slips. Off by default so the paywall doesn't change.
  - **Not in U1:** the perforated divider (a dashed hairline with half-circle notches). It has no consumer until U5/U7, so it gets built as `SlipPerforation` in U5.
  - Used by the paywall (U1), tutorial cards (U5), and the Watchlist week card and "stake added" confirmation (U7).
  - The paywall must be refactored onto `Slip` with **no visual change**. Only the outer surface moves. The header, scroll body, footer and `cardWrap`/`dim` styles stay in `UpgradeSheet`.
- **`BoardRow`** (`app/components/BoardRow.tsx`): a 38–40pt row.
  - Left: a 3pt team-color stripe, shown only when the user has a stake.
  - Then a kickoff time or live clock (mono, tabular numbers), the matchup, the network (mono, small, muted), and one `accent` dot per stake (max 3, then "+n").
  - **Network label** comes from a new pure helper, `networkLabel(broadcasts: GameBroadcast[]): string | null`, in `app/lib/`, with unit tests. It picks the game's airing network, **not** the user's best service: `rankBroadcasts`'s subscription ordering is the wrong input. Prefer linear networks (`cbs`/`fox`/`nbc`/`abc`), then streaming exclusives (`amazon_prime`/`peacock`/`espn_plus`/`nfl_plus`/`nfl_network`/`sunday_ticket`/`paramount_plus`/`hulu`/`fubo`/`directv` — the `STREAMING_SERVICES` enum in `services/api/src/routes/me.ts`). Map those enum values to display text ("CBS", "PRIME", "ESPN+", "YTTV"). There is no bare `espn`, `prime`, or `netflix` key in the catalog. Return `null` when there's no broadcast, in which case the column renders empty.
  - Rows without a stake use muted text and no tint.
  - Live rows show the clock in `flare` and the score on the right.
- **`FeaturedStakeCard`** (`app/components/FeaturedStakeCard.tsx`):
  - A 4pt split band across the top in the two teams' primary colors.
  - "BIGGEST STAKE" eyebrow in `accent`, and the kickoff plus network on the right.
  - Uppercase team nicknames in `title` weight.
  - Outlined stake chips: roster players now, stake conditions after stakes Phase 3.
- **Stake-shaped cards** (Watchlist only; build these in stakes Phase 3 and later, not in the U phases):
  - `PropMeterCard`: a track, with the line marker at 80% of the track width.
  - `SpreadLineCard`: a number line from −14 to +14 with the cover zone shaded.
  - `MarketTicketCard`: a perforated stub holding the price.
  - `SurvivorBadgeCard`: a ring badge plus an ALIVE count.
  - `RosterStripCard`: segments proportional to starters per game, **with each label rendered inside its own segment's column** so labels align with their bars.

### 11.3 Home: one screen, two modes, one switch
Home keeps its existing state machine (`resolveHomeBranch` in `app/lib/homeState.ts`, switched on in `app/app/(app)/(tabs)/index.tsx`). The **branch logic** doesn't change, but the **screen's data layer does**. `loadHome` (`index.tsx`, ~110 lines, re-run on a 30s interval and on every WebSocket reconcile) builds all of `HomeData` in one callback. U2 must **not** grow it further:
- Extract the board derivation into pure functions in `app/lib/homeState.ts` (or a new `app/lib/board.ts`), each with unit tests collected by `pnpm test`:
  - `buildBoardRows(weekGames, stakeGameIds, now)`: groups by window, marks stake rows, counts stakes per game;
  - `pickFeaturedGame(...)`: the pre-game ranking rule below;
  - `groupWindow(kickoff)`: THURSDAY NIGHT / SUNDAY · EARLY / SUNDAY · LATE / PRIMETIME / MONDAY, with explicit handling for Saturday and international games;
  - `networkLabel(...)`: see `BoardRow`.
- `loadHome` only calls them.

**Data inputs (resolves the State 3 vs. 4 split):** `state3` currently renders `lineupGroups` (all stake games this week), and `state4` renders `upcomingGames` (future kickoffs only). In the merged pre-game presentation:
- **The board** uses `weekGames` (already fetched via `fetchGamesWeek`; the full slate). Stake markers come from `lineupGroups`, so games already played this week still show their dots.
- **The featured card** chooses only from **future kickoffs** (the same filter as `upcomingGames`).

**Pre-game ranking rule** (for `pickFeaturedGame`; `gameScore` and `priority_score` are both live-only and evaluate to nothing pre-game):
1. Most stakes in the game. Before stakes Phase 1, this is starters from `countStakePlayersInGame`. After Phase 1, it's the sum of `stake.weight`.
2. Tie → earliest kickoff.
3. Tie → lowest game id (deterministic).

Unit-test all three tie levels.

**Fixed skeleton, top to bottom:**
1. **Header:** mode eyebrow, "Home" title, and a right-side meta block.
2. **`SegmentedControl`:** `BOARD | MY CARD`.
3. **Hero slot.**
4. **Also Flagged row:** State 1 only. Unchanged.
5. **Board.**
6. Tab bar.

**Mode mapping:**

| Existing state | Mode eyebrow | Header right | Hero slot | Board |
|---|---|---|---|---|
| `state1` (active flag) | `● LIVE · {n} GAMES` (flare) | Current time | `NowActiveCard`, **unchanged**, plus `flareGlow` | Live rows first (clock + score), then upcoming |
| `state2` (live, no flag) | `● LIVE · {n} GAMES` (flare) | Current time | `FeaturedStakeCard` for the top-ranked live game, with the `fieldAlignedMatchup` scoreboard and `FieldGauge` | Same as State 1 |
| `state3` (pre-game window) and `state4` (off-day) | `WEEK {n} · PRE-GAME` (brass) | "NEXT KICKOFF" + countdown (brass, `accent` within 24h) | `FeaturedStakeCard` for `pickFeaturedGame` (ranking rule above) | Full week's slate grouped by window: THURSDAY NIGHT / SUNDAY · EARLY / SUNDAY · LATE / PRIMETIME / MONDAY |
| `season_idle` (`off` / `pre`), `no_leagues` | Unchanged | Unchanged | Unchanged | Unchanged. **Do not merge `off` and `pre`** (see the existing docstring and regression test) |

Rules:
- **The board shows the whole slate, not just stake games.** Games without a stake appear muted. That's what makes it a board. `GET /games?week=` already returns every game in the week, and the client already holds it as `weekGames`, so no new endpoint or fetch is needed. It returns `[]` when `display_phase` is `'off'`, which is harmless because Home never reaches the board then. To exercise it off-season, mock `/state/nfl`.
- **Mode changes only on real events** (kickoff, final, flag fired or cleared), never on a clock-of-day timer.
- The countdown ticks every second only while Home is focused. Use `useFocusEffect` from `expo-router` (new usage in this repo), and don't run the interval in the background.
- "Test notifications" is **already** Settings-only. There's nothing to move. Correct `PLAN.md` §10 State 3, which still describes the link on Home.

**MY CARD segment:**
- Same header. The hero slot and board are replaced by one list.
- The list shows the user's stake games in kickoff order. Each game is a `well` block with a header row (stripe, time, matchup, network) and one line per stake: a mono type tag (FANTASY / PROP / SPREAD / MARKET / SURVIVOR) in `brass`, a label, and the key value in `accent`.
- Top right: a "Manage" link that goes to the Watchlist tab.
- **Before the stakes model ships,** My card lists fantasy players only: FANTASY lines built from the existing "Active Players" data. So it can ship in Phase U3 without waiting on stakes Phase 1.
- Remember the selected segment per session only. Home always opens on BOARD after a cold start.

### 11.4 Watchlist tab
- **Rename the "Lineup" tab to "Watchlist" only when stakes Phase 3 ships.** Until then, the Lineup tab and its screens are unchanged.
- **Layout, top to bottom:**
  1. A "WEEK {n}" eyebrow and "Watchlist" title.
  2. The **week card** (`Slip` with perforation): a 2×2 grid of Fantasy (starters), Opponent (tracking / off), Bets & props ("{used} of 3 free" in `accent` for Free users, the plain count for Pro), and Pools. Below the grid, a primary "Add a stake" button.
  3. Filter pills: All / Fantasy / Bets / Markets / Pools.
  4. Stake-shaped cards (Section 11.2).
- The league management actions from today's Lineup screen (connect, sync, edit lineup, disconnect) move into the Fantasy filter view as a header block. They must stay reachable within 2 taps.

### 11.5 Verify (Phases U1–U4)
1. **Tokens:** run `pnpm test` at the repo root, **not** `pnpm --filter app test`, which runs zero tests. Expect the same passing count as the baseline plus the new token block. Then run `git diff app/lib/theme.ts` and `git diff app/lib/theme.test.ts`: both should show added lines only, and no `-` lines inside existing blocks. Finally run `pnpm typecheck`.
2. **Paywall regression:** open the paywall before and after the `Slip` refactor, and screenshot both on the same simulator. Expect no pixel-visible change.
3. **Pre-game Home:** on a Tuesday–Saturday during the season (or with `/state/nfl` mocked to `regular` and no live games), open Home. Expect:
   - the eyebrow reads `WEEK {n} · PRE-GAME`;
   - the countdown matches the next kickoff;
   - the featured card matches `pickFeaturedGame` (most stakes / starters, then earliest kickoff, then lowest game id);
   - the board lists **every** game this week, grouped by window, with stake rows tinted and dotted.
4. **Live Home** (U4, after P0): replay a captured `experiments/logs/events-<ISO>.jsonl` through the local pipeline so a flag fires. Home should switch to LIVE with no manual refresh, and the hero should be `NowActiveCard` with its existing content. When the flag clears, the hero should go back to the featured card.
5. **Segment switch:** tap MY CARD, then background and foreground the app. The segment should stay on MY CARD. Force-quit and reopen, and it should come back on BOARD.
6. **Accessibility:** turn on VoiceOver. The segments should be read as tabs with a selected state, and every board row should read as "{time}, {matchup}, {network}, {n} stakes".
7. **On device:** Parker confirms on a physical iPhone. Cursor's own report is not sufficient.

---

## 12. Onboarding and tutorial (updates `PLAN.md` §10 "Onboarding")

### 12.1 Onboarding flow
Changes to the existing 6 screens are marked **new** or **changed**.

1. **Welcome.** Unchanged.
2. **Sign up / sign in.** Unchanged.
3. **What are you following?** (**new**)
   - A multi-select of Fantasy team / Bets & props / Prediction markets / Survivor or pick'em pools. At least one is required.
   - Stored as `preferences.following: string[]`.
   - **It only changes ordering** of add-flows and filter pills. It never gates a feature.
   - Options whose stakes phase hasn't shipped are hidden behind feature flags.
4. **Add your first stakes** (**changed** from "Connect fantasy team")
   - Show the add paths for the selections in step 3, in that order: Connect Sleeper / Add manually / Add a bet (stakes Phase 3+) / Search Kalshi (stakes Phase 5+).
   - "Skip for now" is allowed. Home then shows State 5.
5. **Streaming services.** Unchanged.
6. **Notifications primer** (**changed** copy). It must explain the timing before the iOS prompt:
   > "Pivot alerts you when a game you care about is worth switching to. Alerts are timed to your stream, so a play never shows up in a notification before you've seen it."
   - Then trigger the iOS permission prompt.
   - If the user denies, show the existing recovery path to Settings. Don't loop the prompt.
7. **Quick tour** (**new**, skippable): the tutorial cards (12.2) in a `Slip`. It ends with "Try a demo game day" or "Go to Home".
8. **All set.** Unchanged.

### 12.2 Tutorial (replayable from Settings)
- **Four cards**, each a `Slip` with a small static illustration built from real components:
  1. **"This is the Board."** The whole week's slate. Gold dots mark games you have a stake in, and the top card is your biggest one. Flip to My card to see just yours.
  2. **"When it's live, Home lights up."** Show the LIVE eyebrow and `NowActiveCard`. When something's worth switching for, the top card tells you where to go.
  3. **"Alerts land at the right moment."** Pivot waits until the play is about to reach your screen, so you're never spoiled. Tap an alert to jump to the right channel.
  4. **"Your Watchlist."** Everything you've got riding, in one place. Free covers 3 bets a week.
- **Demo game day** (**new**):
  - A local-only sandbox that replays a bundled, trimmed fixture. Take one real drive sequence from a captured `experiments/logs/events-<ISO>.jsonl`, after confirming it contains replayable plays, compress it to about 90 seconds, and bundle it at `app/assets/demo/demo-game.json`. `app/assets/` doesn't exist yet, so create it.
  - The fixture drives Home through PRE-GAME → LIVE with a flag → a local notification. The notification is sent with `expo-notifications` `scheduleNotificationAsync`. No server calls.
  - A persistent `DEMO` banner, with an Exit button, stays on screen the whole time.
  - The demo uses fake stakes that are **never written** to `stakes` or `lineup_slots`.
  - Don't use real team names from the fixture in notification copy, and label the demo clearly, so a demo alert can never be mistaken for a real one.
- **Coach marks:**
  - One-time tooltips on the first visit to Home (the segmented control), the Watchlist (the week card) and Settings (Replay tour).
  - Track them in `preferences.seenCoachMarks: string[]`.
  - Never show more than one coach mark per screen visit.
- **Settings → Help:** "Replay tour", "Try a demo game day", and the existing "Test notifications" action (already in Settings; regroup it under Help).
- **Preference keys:** `following` and `seenCoachMarks` each need the three coordinated edits listed under "Repo facts". Otherwise zod strips them silently and the setting "doesn't persist" with no error. Add a round-trip unit test for each key: parse → serialize → parse keeps the value.

### 12.3 Verify (Phases U5–U6)
1. **Fresh-install onboarding:** delete the app, reinstall, and sign up. Expect the 8-step flow. Pick only "Bets & props" in step 3 while the stakes Phase 3 flag is off. Step 4 should still offer Connect Sleeper / Add manually, and no bet option should appear.
2. **Notification denial:** tap Don't Allow at the iOS prompt. Expect the recovery screen, not a second prompt. Then check that iOS Settings → Pivot → Notifications is reachable from the link.
3. **Demo game day:**
   1. Start the demo from Settings → Help.
   2. Within ~90s, expect Home to show LIVE and a local notification to arrive (with the app backgrounded as well as foregrounded).
   3. Exit the demo. Expect real Home to return unchanged.
   4. Query `select count(*) from stakes where user_id = '<you>'` before and after. The count should be unchanged.
4. **Coach marks:** open Home twice. The coach mark should appear on the first visit only. After "Replay tour", it should not reappear. Replay covers the tour cards, not the coach marks.

---

## 13. Phase sequencing (UI and monetization interleaved with stakes)

The UI and monetization phases don't depend on the stakes phases unless noted. That means they can ship during stakes Phase 1 work. Each phase is still gated, with baseline → change → verify → Parker on-device check → commit.

| Phase | Scope | Depends on | Model |
|---|---|---|---|
| **P0** | Production live pipeline: ingestion runner, resumption-watcher timing, silence ceiling, per-game collapse (§0.1). Separate prompt. **Start with a read-only design pass**, since the recon shows this is larger than 4 bullets | — | Opus 5, High, MAX |
| **U1** | Amber-ladder tokens (11.1) + `Slip` refactor of the paywall (11.2). No perforation | — | Sonnet 5 High |
| **U2** | Board pure functions + tests, `networkLabel`, `BoardRow`, `FeaturedStakeCard`, Home pre-game mode (11.3) | U1 | Opus 5, High, MAX (touches `loadHome`) |
| **U3** | `SegmentedControl` + MY CARD, fantasy-only (11.3) | U2 | Sonnet 5 High |
| **U4** | Home live mode mapping, `state1`/`state2` (11.3) | U2, **P0** | Opus 5, High, MAX |
| **M1** | `pro_expires_at` + `isPro` predicate across all gating reads, `is_pro` on `/me`, exact-match package resolver, Season Pass, paywall copy (10.3–10.4) | U1; Parker creates the product in App Store Connect and RevenueCat | Opus 5, High, MAX (billing and entitlements; real money) |
| **M2** | Stake cap enforcement, `403 stake_limit_free` (10.2) | Stakes Phase 3 | Sonnet 5 High |
| **U5** | Onboarding changes + tutorial cards + coach marks + `SlipPerforation` + the two preference keys (12.1–12.2) | U3 | Sonnet 5 High |
| **U6** | Demo game day (12.2) | U4, U5 | Opus 5, High, MAX (fixture compression, local notifications) |
| **U7** | Watchlist tab rename + week card + stake-shaped cards (11.4) | Stakes Phase 3, M2 | Sonnet 5 High |

When a phase ships, fold its section into `PLAN.md` (§3 for monetization, §10 for UI) and mark the corresponding `UI-SPEC.md` sections as superseded. Same convention as the Sept 18 and Sept 23 status notes.

---

**Recommended model (defaults):**
- Architectural or novel work (P0; stakes Phases 1 and 5b; U2, U4, U6, M1): **Opus 5, High reasoning, MAX Mode**.
- Mechanical implementation of an approved design (stakes Phases 2, 3, 4b; U1, U3, U5, U7, M2): **Sonnet 5 High**.
- Never Auto.
