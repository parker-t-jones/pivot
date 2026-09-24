# Stakes-Plan Reconciliation

Read-only reconciliation of `PIVOT-STAKES-PLAN.md` against the repo as of commit `f1e0963` (branch `main`, Sept 24 2026). No source files were edited; this document is the only output.

Scope of the pass: `PIVOT-STAKES-PLAN.md` in full, `PLAN.md` §3 and §10, `UI-SPEC.md`, `app/lib/theme.ts`, `app/lib/theme.test.ts`, `app/components/UpgradeSheet.tsx` (the paywall), plus the API/engine/dispatcher code the plan's assumptions depend on.

Working-tree caveat: `PLAN.md`, `UI-SPEC.md`, `app/app/(app)/(tabs)/index.tsx`, `app/components/HomeLiveIdleCard.tsx`, `app/components/HomeOffDayCard.tsx`, `app/lib/homeState.ts` and `app/lib/homeState.test.ts` have uncommitted modifications. All line numbers below are from the working-tree state, not from `HEAD`.

---



## 1. Path & name mismatches



### 1.1 The accent hex the whole token plan is built on does not exist in the repo

This is the single most consequential mismatch, so it leads.


| Plan says                                                             | Repo actually has                           |
| --------------------------------------------------------------------- | ------------------------------------------- |
| `PIVOT-STAKES-PLAN.md:366` — ``colors.accent` | `#FFB020` (existing)` | `app/lib/theme.ts:14` — `accent: '#F5A018'` |


`#FFB020` appears nowhere in `app/`. The pinning test asserts the real value at `app/lib/theme.test.ts:13` (`expect(theme.colors.accent).toBe('#F5A018')`). The derived tokens follow the same wrong base:


| Token               | Plan value (line)                | Repo's actual base                                      |
| ------------------- | -------------------------------- | ------------------------------------------------------- |
| `colors.ember`      | `rgba(255,176,32,0.05)` (`:364`) | accent is `245,160,24`, cf. `app/lib/theme.ts:17,24,26` |
| `effects.flareGlow` | shadow `#FFC94D` (`:368`)        | `panelGlow` uses `#F5A018`, `app/lib/theme.ts:56`       |


`UI-SPEC.md:34` is the origin of the error — under a heading that reads "**Already in** `app/lib/theme.ts`**, unchanged:**" (`UI-SPEC.md:29`), it lists `colors.accent` as `#FFB020`. The spec's *proposed* rows carry the same wrong base: `accentBorder` as `rgba(255, 176, 32, 0.25)` and `accentGlow` as `rgba(255, 176, 32, 0.15)` (`UI-SPEC.md:49-50`), where the values that actually shipped are `rgba(245, 160, 24, …)` (`app/lib/theme.ts:24,26`). So the implementation correctly derived both from the real accent and the spec was never corrected. The stakes plan inherited the stale hex from the spec. See §3.1 for the conflict framing.

### 1.2 Components the plan names that do not exist

All four are genuinely new (expected for U1–U3), but note the directory convention is confirmed correct — `app/components/` is flat and already holds 24 components.


| Plan reference                                  | Status         |
| ----------------------------------------------- | -------------- |
| `app/components/SegmentedControl.tsx` (`:379`)  | Does not exist |
| `app/components/Slip.tsx` (`:385`)              | Does not exist |
| `app/components/BoardRow.tsx` (`:389`)          | Does not exist |
| `app/components/FeaturedStakeCard.tsx` (`:394`) | Does not exist |




### 1.3 The paywall component is never named in the plan

§10.4 (`:328`) says "Keep the existing floating Pro card treatment" and §11.2 (`:387`) says "The existing paywall should be refactored onto it". Neither names the file. It is `app/components/UpgradeSheet.tsx` (declared at `:55`, `export function UpgradeSheet()`), mounted once in `app/app/(app)/_layout.tsx` and opened via `useUpgradeSheet().openUpgrade()` (`app/contexts/UpgradeSheetContext.tsx:27`).

### 1.4 Screen paths in `UI-SPEC.md` are stale (the stakes plan defers to them)


| `UI-SPEC.md` says                                     | Actual path                         |
| ----------------------------------------------------- | ----------------------------------- |
| `app/app/(app)/index.tsx` (`:172`, `:198`)            | `app/app/(app)/(tabs)/index.tsx`    |
| `app/app/(app)/settings.tsx` (`:111`, `:200`, `:227`) | `app/app/(app)/(tabs)/settings.tsx` |


`PLAN.md:1546-1548` has the correct `(tabs)/` paths. The `.cursorrules` file-layout note (`app/screens/`) is also stale: `app/screens/` does not exist; `app/playback/` does.

### 1.5 Test commands in the plan are silent no-ops


| Plan says                                                                             | Reality                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PIVOT-STAKES-PLAN.md:449` — "run `pnpm --filter app test`"                           | `app/package.json` has no `test` script (scripts are `start`, `ios`, `typecheck`). Verified: `pnpm --filter app test` exits `0` having run **zero tests**. |
| `PIVOT-STAKES-PLAN.md:225` — "run `pnpm -r test` and save the output as the baseline" | No workspace package defines `test`. Verified: `pnpm -r test` prints `Scope: 6 of 7 workspace projects` and exits `0`, running zero tests.                 |


The only command that runs the suite is `pnpm test` at the repo root (`package.json:14`, `"test": "vitest run"`), driven by the single root `vitest.config.ts`. Both plan commands **pass vacuously**, which is worse than failing — a U1 verification that "ran the tests" would be green while testing nothing.

### 1.6 The root vitest config cannot collect component tests

`vitest.config.ts:15-21` sets `environment: 'node'` and `include: ['shared/src/**/*.test.ts', 'services/*/src/**/*.test.ts', 'app/**/*.test.ts', 'scripts/**/*.test.ts']` — `.ts` only, no `.tsx`, no jsdom, and no React Native testing library in `app/package.json`. There are **zero test files in** `app/components/`; every app test lives in `app/lib/` (16 files). Consequence for §11.5 verify step 2: the `Slip` refactor has no automated regression path and is screenshot-only.

### 1.7 Captured fixture filename

The plan references `plays-<date>.jsonl` at `:226`, `:456` and `:493`. No file matching `plays-*` exists anywhere in the repo. The captured live runs are `experiments/logs/events-<ISO timestamp>.jsonl` (11 files, Sept 13–15 2026) plus `markers-<ISO timestamp>.jsonl`. The offline resumption backtest uses a different artifact again: `experiments/game-latency-log.txt` (`PLAN.md:1119`).

### 1.8 Database objects


| Plan reference                  | Status                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stakes` table (`:187`)         | No migration. `supabase/migrations/` holds 10 files, none mentioning `stakes`.                                                                                                                                                        |
| `stake_trigger_log` (`:189`)    | No migration.                                                                                                                                                                                                                         |
| `users.pro_expires_at` (`:319`) | Column does not exist. `users` is defined at `supabase/migrations/20260510120000_users_user_app_presence.sql:26`, which has `subscription_tier` but no expiry column. Not in `services/api/src/lib/database.types.ts:400-418` either. |




### 1.9 Endpoints and error contracts


| Plan reference                                                   | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /stakes` (`:311`)                                          | Does not exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| HTTP `402` with `{code: 'STAKE_CAP', limit: 3}` (`:311`, `:348`) | `402` is used nowhere in the codebase. Every existing free-tier cap returns **403** with a snake_case code: `league_limit_free` (`services/api/src/routes/leagues.ts:43`), `manual_lineup_limit_free` (`leagues.ts:399`), `watched_league_limit_free` (`services/api/src/routes/me.ts:187`). The client's cap handler hard-codes exactly two of those codes (`app/lib/upgradePrompt.ts:12`) and ignores status entirely. `ApiError` does support a `details` payload (`services/api/src/lib/errors.ts:10`), so `{limit: 3}` is expressible. |
| `POST /billing/revenuecat` sets `pro_expires_at` (`:321`)        | Route exists (`services/api/src/routes/billing.ts:65`) but only writes `subscription_tier` (`billing.ts:93-96`).                                                                                                                                                                                                                                                                                                                                                                                                                            |




### 1.10 Preference keys


| Plan reference                                  | Status                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferences.following: string[]` (`:472`)      | Not in the schema. `shared/src/types/preferences.ts:9-21` defines exactly four keys: `notificationMode`, `quietHours`, `autoSwitch`, `watchedLeagueIds`. |
| `preferences.seenCoachMarks: string[]` (`:500`) | Same — absent.                                                                                                                                           |


Both are `z.object(...)` fields parsed through `parsePreferences` (`preferences.ts:26-28`), and zod strips unknown keys by default, so writing `following` without a schema change would **silently discard it** on the next read. Adding either key needs three coordinated edits: `shared/src/types/preferences.ts`, the client mirror `app/lib/me.ts:11-17`, and the PATCH body allow-list `services/api/src/routes/me.ts:85-97`.

### 1.11 Misc

- `app/assets/demo/demo-game.json` (`:493`) — `app/assets/` does not exist at all. `UI-SPEC.md:213` already notes this.
- `useFocusEffect` (`:429`) — used nowhere in `app/` today. Available from `expo-router` (`expo-router ~56.2.11`, `app/package.json`), so this is a new-usage note rather than a blocker.
- Frozen identifiers (`:20`) all check out: `supabase/config.toml:5` `project_id = "FantasyFocusApp"`, `app/app.json:4` `"slug": "fantasy-focus"`, `app/app.json:10` `"bundleIdentifier": "com.fantasyfocus.app"`.
- Primitives §7 (`:206`) claims to reuse — `TextField`, `ListRow`, `PrimaryButton`, `PlayerPicker` — all exist in `app/components/`. Confirmed, no mismatch.

---



## 2. Assumption checks



### (a) Where the Pro paywall lives, and whether a `Slip` refactor is visually safe — **CONFIRMED, with one caveat**

The paywall is `app/components/UpgradeSheet.tsx`. The "floating Pro card treatment" the plan wants to generalize is the `card` style, `app/components/UpgradeSheet.tsx:234-244`:

```234:244:app/components/UpgradeSheet.tsx
  card: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    maxHeight: '80%',
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    width: '100%',
    ...theme.effects.panelGlow,
  },
```

That is a clean, self-contained surface recipe — background fill, accent stroke, radius, glow — and matches §11.2's `Slip` description (`:386`) almost exactly, except the plan also says "plus a drop shadow" where the component today has only `panelGlow` (a zero-offset glow, `app/lib/theme.ts:55-61`). A separate offset drop shadow would be a **visual change**, contradicting "no visual change" at `:387`. Recommendation: make the drop shadow an opt-in prop defaulted off, so the paywall keeps its current appearance.

Three structural facts that make the refactor mechanically safe:

1. The card is a `Pressable` used purely as a tap-blocker (`UpgradeSheet.tsx:165`, `onPress={() => {}}`), so `Slip` must either render a `Pressable` or accept children that do — a plain `View` wrapper would re-enable backdrop dismiss through the card.
2. `maxHeight: '80%'` (`:239`) is modal-specific, not part of a general slip treatment. It should stay on the call site via a `style` override prop rather than move into `Slip`.
3. The header, scroll body, and footer (`UpgradeSheet.tsx:166-220`) are all paywall content, not slip chrome. Only the outer surface moves.

Caveat on verification: there is no test covering this component (§1.6), so "no visual change" rests entirely on §11.5's before/after screenshot step.

### (b) What `theme.test.ts` pins, and whether §11.1 is purely additive — **CONFIRMED additive, but the plan's values are wrong**

`app/lib/theme.test.ts` has five `it` blocks pinning, exhaustively:

- **Colors** (`:6-19`): `background #0B0B0F`, `surface #1A1A20`, `surfaceRaised #22222A`, `border #2A2A32`, `textPrimary #FFFFFF`, `textSecondary #9A9AA3`, `textTertiary #6E6E78`, `accent #F5A018`, `accentPressed #D68C10`, `accentMuted rgba(245, 160, 24, 0.18)`, `onAccent #412402`, `danger #FF5A5A`, `dangerMuted rgba(255, 90, 90, 0.14)`, `success #3ECf8E`.
- **Colors, second block** (`:101-102`): `accentBorder rgba(245, 160, 24, 0.25)`, `accentGlow rgba(245, 160, 24, 0.15)`.
- **Effects** (`:104-111`): `panelBorderWidth 1` and `panelGlow` via `toEqual` — `shadowColor #F5A018`, offset `{0,0}`, opacity `0.15`, radius `20`, elevation `8`.
- Spacing, radii, opacity, and the full type scale (`:21-98`), several via exact `toEqual`.

**Additivity verdict:** adding `ember`, `brass`, `flare`, `well`, `wellBorder`, `rowDivider` to `colors` and `flareGlow` to `effects` touches no pinned key. Every color assertion is a per-key `toBe`, never a whole-object `toEqual`, so new sibling keys cannot break them. The two `toEqual` assertions are on `theme.effects.panelGlow` (`:105`) and individual `type.`* entries (`:65-91`) — neither is the object §11.1 extends. **§11.1 is purely additive as a structural matter.**

The problem is the *values*, not the shape: §11.1 presents `#FFB020` as the existing accent (`:366`). If that row is implemented literally, `theme.test.ts:13` fails and the U1 diff is no longer additive — it becomes a palette change across every accent surface in the app. See §3.1.

### (c) Does `GET /games?week=` return the full weekly slate? — **CONFIRMED yes, with two conditions**

`services/api/src/routes/games.ts:51-82` queries `games` filtered **only** by `week` and `season_type`:

```75:80:services/api/src/routes/games.ts
      const { data: gameRows, error: gamesError } = await fastify.supabase
        .from('games')
        .select('id, status, scheduled_start, home_team_id, away_team_id')
        .eq('week', week)
        .eq('season_type', seasonType)
        .order('scheduled_start', { ascending: true });
```

There is no user, league, roster, or stake filter anywhere in the handler. It returns every game in the week, each with team display fields and ranked broadcasts (`games.ts:130-140`). §11.3's claim at `:427` ("It needs `GET /games?week=`, which already exists") is correct, and the client already fetches and holds the full slate — `fetchGamesWeek(nflState.week)` at `app/app/(app)/(tabs)/index.tsx:217`, stored as `weekGames` (`index.tsx:231`, `:273`). **The board needs no new endpoint and no new fetch.**

Two conditions worth knowing before U2:

1. **Empty during the offseason.** `games.ts:69-71` short-circuits to `{ week, games: [] }` when the derived `display_phase` is `'off'`. Harmless for Home (which never reaches the live machine in that phase, `app/lib/homeState.ts:82-85`) but it means the board cannot be exercised off-season without mocking.
2. **Network labels are derivable but not direct.** §11.3 (`:391`) wants "the network (mono, small, muted)" per row. `ScheduleGame` carries `broadcasts: GameBroadcast[]` (`app/lib/schedule.ts:19`), where `service` is the streaming-service enum (`fox`, `cbs`, `nbc`, `abc`, `espn_plus`, `sunday_ticket`, … — `services/api/src/routes/me.ts:12-27`). Rendering "CBS" means picking a broadcast and mapping the enum to a display label. `rankBroadcasts` already orders them by user eligibility (`games.ts:30-41`), which is a *subscription* ordering, not a "which network is this game on" answer. This is a small new display helper, not a data gap — but it is not free.



### (d) How `resolveHomeBranch` maps to States 1–4/4a/5 — **CONFIRMED complete coverage, naming diverges**

`resolveHomeBranch` (`app/lib/homeState.ts:69-98`) returns exactly six shapes, typed at `homeState.ts:23-29`:


| Returned branch                           | Plan's name        | Covered by §11.3 table?                      |
| ----------------------------------------- | ------------------ | -------------------------------------------- |
| `{branch: 'no_leagues'}`                  | State 5            | Yes — `:424` "State 4a, State 5 | Unchanged" |
| `{branch: 'season_idle', variant: 'off'}` | State 4a (`'off'`) | Yes, same row                                |
| `{branch: 'season_idle', variant: 'pre'}` | State 4a (`'pre'`) | Yes, same row                                |
| `{branch: 'state1'}`                      | State 1            | Yes — `:421`                                 |
| `{branch: 'state2'}`                      | State 2            | Yes — `:422`                                 |
| `{branch: 'state3'}`                      | State 3            | Yes — `:423`                                 |
| `{branch: 'state4'}`                      | State 4            | Yes — `:423`, merged with State 3            |


**The §11.3 mode table covers every branch the function returns.** No branch is orphaned. Three notes:

1. Code names are `no_leagues` / `season_idle` (+`variant`), not `state5` / `state4a`. The plan's table is readable but won't grep against the switch at `app/app/(app)/(tabs)/index.tsx:400-455`.
2. The `state3` vs `state4` split is **not** day-of-week. It's `isPregameWindow` (`homeState.ts:94`, defined at `:100-104`): same local calendar day, or within 12 hours (`PREGAME_WINDOW_MS`, `homeState.ts:13`). Merging them into one presentation row (`:423`) is therefore consistent with "no day-of-week screen swapping" (`:287`) — but it also means the merged row inherits a real behavioral difference: `state3` renders `lineupGroups` (all stake games this week, `index.tsx:444`) while `state4` renders `upcomingGames` (`index.tsx:451`), which is filtered to kickoffs still in the future (`homeState.ts:313-326`). Collapsing the presentation does not collapse those two inputs; U2 must pick one.
3. `'off'` and `'pre'` are deliberately distinct branches with a "do not merge" docstring (`homeState.ts:56`, `:83`) and an explicit regression test (`app/lib/homeState.test.ts:59-68`). "Unchanged" at `:424` is the right call and should be held to.



### (e) Every `users.subscription_tier` read site — **CONFIRMED, 11 production read sites**

The plan at `:318-322` says to replace the bare read with a derived check while keeping `subscription_tier` as a cached value "so existing reads don't break." Here is the full inventory that claim has to hold for.

**Server, tier-gating reads (5):**


| Site                                              | What it gates                                        |
| ------------------------------------------------- | ---------------------------------------------------- |
| `services/api/src/routes/leagues.ts:26-32`        | `assertCanConnectLeague` — early-returns for `'pro'` |
| `services/api/src/routes/leagues.ts:113,117`      | Connect-league flow tier                             |
| `services/api/src/routes/leagues.ts:389,394`      | `PUT /leagues/:id/lineup` manual-lineup cap          |
| `services/api/src/routes/me.ts:156,182`           | `PATCH /me/preferences` watched-league cap           |
| `services/api/src/lib/watched-leagues.ts:115,129` | Watched-league resolution for the engine             |


**Server, pass-through reads (3):**


| Site                                          | Use                                          |
| --------------------------------------------- | -------------------------------------------- |
| `services/api/src/routes/me.ts:127,73`        | `GET /me` response body                      |
| `services/api/src/routes/me.ts:204`           | `PATCH /me/preferences` response body        |
| `services/api/src/routes/flags.ts:122,128`    | Coerced to `'pro' | 'free'` for flag context |
| `services/api/src/lib/lineup-sync.ts:270,286` | Sync context                                 |


**Client reads (4):**


| Site                                            | Use                                            |
| ----------------------------------------------- | ---------------------------------------------- |
| `app/components/UpgradeSheet.tsx:68`            | `setIsPro(me.subscription_tier === 'pro')`     |
| `app/components/ActiveLineupPicker.tsx:31`      | `const isPro = me.subscription_tier === 'pro'` |
| `app/app/(app)/connect-team.tsx:204`            | Manual-lineup free cap                         |
| `app/app/(app)/edit-manual-lineup.tsx:44`       | Manual-lineup free cap                         |
| `app/app/(app)/(tabs)/settings.tsx:161,220,225` | Plan label + Upgrade CTA                       |


**Single write site:** `services/api/src/routes/billing.ts:93-96`.

**Assessment of the plan's approach.** Keeping `subscription_tier` as a derived cache does keep all 15 sites compiling, but it introduces a correctness hazard the plan does not address: a season pass expires by *time*, with no inbound event at the moment of expiry. If the webhook is the only writer (`billing.ts:93`), a lapsed season-pass user keeps `subscription_tier = 'pro'` until something else recomputes it. The plan's own §10.3 wording — "A user is Pro when there's an active RevenueCat `pro` entitlement **or** `pro_expires_at > now()`" (`:320`) — is a read-time predicate, which is correct, but "keep `subscription_tier` as a cached value" (`:322`) is a write-time denormalization, and nothing in the plan says who recomputes it on the expiry boundary. This needs a decision before M1: either a scheduled recompute, or make the five gating reads call a shared `isPro(userRow)` helper and let the cached column be display-only.

### (f) Is RevenueCat configured for a non-renewing product alongside `pivot_pro_monthly`? — **CANNOT BE DETERMINED from the repo; code is partially ready**

RevenueCat product/offering configuration lives in the RevenueCat dashboard and App Store Connect, neither of which is represented in this repository. There is no offerings fixture, no product catalog file, and no RevenueCat config export. The API key itself is an unset env var (`app/.env.example:12`, `EXPO_PUBLIC_REVENUECAT_API_KEY=`), as is the webhook secret (`services/api/.env.example:26`). **Whether a second product exists in the dashboard is unanswerable from code and must be checked by Parker in the RevenueCat console.**

What the code does say:

- **Client is single-product.** `app/lib/purchases.ts:12` declares exactly one id: `PRO_MONTHLY_PRODUCT_ID = 'pivot_pro_monthly'`. `getProMonthlyPackage()` (`purchases.ts:42-53`) resolves it from `offerings.current` with a three-step fallback — exact product id, then `current.monthly`, then `availablePackages[0]`. That last fallback is a hazard for M1: **if a season-pass package were added to the current offering and the monthly product id ever failed to match, this would silently return the season pass and charge $34.99 under a button labelled** `Upgrade — $9.99/month` (`UpgradeSheet.tsx:206`, `:60`). Adding a second product requires splitting this function, not extending it.
- **Webhook already accepts the event type.** `services/api/src/routes/billing.ts:13` includes `'NON_RENEWING_PURCHASE'` in `GRANT_TYPES`, so a season-pass purchase would already flip `subscription_tier` to `'pro'` (`billing.ts:43-48`, `:93-96`). That is a genuine head start.
- **But revocation is event-only.** `REVOKE_TYPES` is `{'EXPIRATION', 'REFUND'}` (`billing.ts:19`). With no `pro_expires_at` column and no scheduled job, expiry depends entirely on RevenueCat emitting `EXPIRATION` for a non-renewing product — which in turn depends on a duration being configured on that product in the dashboard. Unverifiable here; flag it as a sandbox test item for M1 §10.5.1.
- **Entitlement id is shared.** `PRO_ENTITLEMENT_ID = 'pro'` on both sides (`app/lib/purchases.ts:9`, `billing.ts:6`), so a season pass mapped to the same `pro` entitlement needs no new identifier.



### (g) The four §0 guardrail-1 production pipeline fixes — **NOT MERGED (1 of 4 partially, in** `experiments/` **only)**

The plan gates all stakes phases, and phase U4, on these being "merged and verified on device" (`:12`).

**1.** `resumptionWatcher` **wired into the dispatcher — NOT MERGED.**

`watchForResumption` is a pure function in `services/engine/src/resumptionWatcher.ts:73`, exported from the engine barrel at `services/engine/src/index.ts:17-19`. The dispatcher imports from `@pivot/engine` in four files, and every one of them imports only `defaultClock` / `Clock` / `EventDispatcher` (`services/dispatcher/src/dispatcher.ts:1`, `delivery.ts:1`, `scheduleFlagEvent.ts:1`, `dispatcher.integration.test.ts:6`). `watchForResumption` has **no non-test caller anywhere in** `services/` — only `applyPlayToState.ts:3` uses the sibling `classifyPlayType`.

Scheduling is still the fixed broadcast-lag padding:

```37:40:services/dispatcher/src/scheduleFlagEvent.ts
    const lagSec = lagSecondsFor(broadcastSource);

    const scheduled: FlagEvent = { ...event, scheduledFireAt: clock() + lagSec * 1000 };
    await this.deps.queue.enqueue(scheduled);
```

`PLAN.md:1121` states this explicitly as a known open item. Note this directly contradicts the plan's own §3 rule "Every REVEAL goes through reveal timing via the resumption watcher. No exceptions and no fixed-delay fallback" (`:142`) — see §3.3.

**2.** `EspnPlaySource.subscribe()` **concurrent across games — NOT MERGED in production; solved in** `experiments/`**.**

`EspnPlaySource` is one instance per game (`eventId` in the constructor options, `services/ingestion/src/espn/espnPlaySource.ts:15`), and `subscribe()` is an unbounded `while (!this.disconnected)` poll loop (`espnPlaySource.ts:79-83`) that never returns while the game is live. Concurrency is therefore entirely the caller's responsibility.

The only caller that gets it right is the experiment harness:

```898:905:experiments/live-sunday-harness.ts
  // `subscribe()` runs until its game goes final, so these MUST be concurrent — awaiting them in
  await Promise.all(
    sources.map((source, i) => {
      const context = allContexts[i]!;
      return source.subscribe(makeHandler(context.gameId)).catch((error: unknown) => {
```

There is **no production consumer at all**. `services/api/src/worker.ts` is a lineup-sync loop (`worker.ts:4`, `runWorkerCycle`; 5-minute interval at `:6`) and never touches `PlaySource`. Grepping `services/api/src` for `onPlayEvent` or `PlaySource` outside tests returns nothing. So this item is better described as "the production ingestion runner does not exist yet" than "the concurrency fix isn't merged."

**3. Rate limiter keyed by** `(userId, gameId)` **— NOT MERGED.**

The key is user-only, both in the interface and in both implementations:

```28:32:services/dispatcher/src/rateLimiter.ts
  /** Count of notifications delivered to `userId` with `deliveredAt` in `[sinceMs, untilMs]`. */
  countRecentNotifications(userId: string, sinceMs: number, untilMs: number): Promise<number>;
  /** Record a delivered notification and refresh the key's expiry (decision #8). Called ONLY after a
   *  successful delivery — a rate-limited or dropped event must never count towards its own window. */
  recordNotification(userId: string, eventId: string, deliveredAtMs: number): Promise<void>;
```

The Redis key is `user_notifications:{user_id}` (`rateLimiter.ts:23`), the call site passes only `event.userId` (`rateLimiter.ts:71`), and `InMemoryRateLimitStore` maps by user id alone (`rateLimiter.ts:84-99`). The window is 3-per-60s globally per user (`rateLimiter.ts:4-5`), matching `PLAN.md:222`.

This matters more than it looks for the stakes model. §3 at `:150` asserts "The rate limiter already keys by `(userId, gameId)`. Triggers from multiple stakes in the same game collapse into one notification." **That is false today**, and the collapse behavior it describes is a consequence the plan is relying on, not merely a detail. Adding `gameId` to the key would also *loosen* the global cap (3 per game rather than 3 overall), which is a product decision, not a refactor.

**4. Ceiling-on-silence timer — NOT MERGED.**

`RESUMPTION_CEILING_MS = 4 * 60 * 1000` exists (`services/engine/src/resumptionWatcher.ts:55`), but it is only evaluated **inside the loop over already-observed plays** (`resumptionWatcher.ts:93-106`) — the check at `:103` runs only when the next play arrives. If the feed goes silent, the loop simply exits and returns `{outcome: 'NO_MORE_PLAYS'}` (`resumptionWatcher.ts:109-112`). There is no wall-clock timer, no `setTimeout`, and no scheduler anywhere that fires on silence. The unit test for the ceiling supplies a synthetic play past the threshold to trigger it (`resumptionWatcher.test.ts:179-187`), which confirms it is play-driven, not time-driven. A true ceiling-on-silence needs a timer owned by whatever drives the watcher — which, per item 1, does not exist.

**Summary: 0 of 4 merged into production.** Items 1, 3 and 4 have the pure logic built but no wiring; item 2 works only in `experiments/live-sunday-harness.ts`.

---



## 3. Conflicts



### 3.1 The accent hex — plan and `UI-SPEC.md` vs. `theme.ts`

> `PIVOT-STAKES-PLAN.md:366`: "| `colors.accent` | `#FFB020` (existing) | Actionable or today: CTAs, stake markers, game-day kickoff times, selected segment |"

> `UI-SPEC.md:34`: "| `colors.accent`        | `#FFB020` |" — under the heading "**Already in** `app/lib/theme.ts`**, unchanged:**" (`UI-SPEC.md:29`)

versus

```14:14:app/lib/theme.ts
    accent: '#F5A018',
```

Both documents are wrong about a value they claim to be quoting. This is not cosmetic: §11.1 opens with "Additive only. Don't change existing hexes" (`:360`), yet its own table would change one. And `ember` (`:364`) and `flareGlow` (`:368`) are specified as tints of `#FFB020`, so implementing them literally seeds a *second* amber hue into a palette whose whole premise (`UI-SPEC.md:27`) is a single accent. Parker needs to decide whether the ladder is rebuilt around `#F5A018` or whether U1 is deliberately a palette migration — the plan currently reads as neither.

### 3.2 `#FFC94D` "flare" vs. the resolved "competing accent colors" decision

> `PIVOT-STAKES-PLAN.md:367`: "| `colors.flare` | `#FFC94D` | **Live only:** LIVE eyebrow dot, Now Active eyebrow, possession marker |"

> `UI-SPEC.md:27`: "`PLAN.md`'s Known Issues (the "competing accent colors" entry, resolved pre-Sprint-10) records `#FFB020` as the chosen accent specifically because no NFL team owns it as a primary — this pass doesn't change that decision"

Introducing a second amber for live states reopens, at least partially, an issue the project recorded as resolved. The plan does scope it tightly ("Live only", and §11.1's rule at `:376` "Flare and its glow appear only when something is live"), so this is a flag for a conscious decision rather than an outright contradiction — but it should be an explicit one.

### 3.3 "No fixed-delay fallback" vs. the shipped dispatcher

> `PIVOT-STAKES-PLAN.md:142`: "Every REVEAL goes through reveal timing via the resumption watcher. No exceptions and no fixed-delay fallback."

versus `services/dispatcher/src/scheduleFlagEvent.ts:37-39`, which computes `scheduledFireAt` as `clock() + lagSec * 1000` from a per-platform constant, and `PLAN.md:1121`: "What's missing is using a resumption watcher's detected trigger time as that queue's `scheduledFireAt`, in place of the fixed padding."

The fixed-delay path is the *only* path that exists. §0 guardrail 1 does gate on this being fixed, so the plan is internally consistent — but §3's rule is written in the present tense as though the watcher were already the timing source, and a reader could easily build against that assumption.

### 3.4 "The rate limiter already keys by `(userId, gameId)`"

> `PIVOT-STAKES-PLAN.md:150`: "The rate limiter already keys by `(userId, gameId)`. Triggers from multiple stakes in the same game collapse into one notification."

versus `services/dispatcher/src/rateLimiter.ts:23,29,71` — user-keyed only. Detailed in §2(g)(3). The word "already" is the problem: this is stated as an existing property the stakes design builds on, and it isn't one.

### 3.5 Stake-cap status code vs. every existing cap in the API

> `PIVOT-STAKES-PLAN.md:311`: "on the API (`POST /stakes` returns `402` with `{code: 'STAKE_CAP', limit: 3}`)"

versus the three shipped caps, all `403` with snake_case codes (`services/api/src/routes/leagues.ts:42-46`, `leagues.ts:397-401`, `services/api/src/routes/me.ts:185-189`), and a client handler that matches on code strings only (`app/lib/upgradePrompt.ts:12`). `402 Payment Required` is arguably more semantically correct, but it would make `POST /stakes` the only endpoint in the API using it, and `STAKE_CAP` the only SCREAMING_CASE error code. Worth an explicit convention decision at M2 rather than a silent divergence.

### 3.6 "Test notifications moves to Settings" — already done

> `PIVOT-STAKES-PLAN.md:430`: "The "Test notifications" link from State 3 moves to Settings."

The link is already Settings-only: rendered at `app/app/(app)/(tabs)/settings.tsx:472` calling `onSendTestNotification` (`settings.tsx:424`). State 3's component `app/components/HomePregameCard.tsx` (whole file, 49 lines) renders only an eyebrow, a countdown title, and `UpcomingStakeGameList` — no such link. `PLAN.md:1603` still describes the link as living on State 3, so `PLAN.md` is the stale side here. U2 has nothing to move; `PLAN.md` §10 State 3 needs a correction instead.

### 3.7 Pre-game hero selection depends on a score that doesn't exist yet

> `PIVOT-STAKES-PLAN.md:423`: "`FeaturedStakeCard` for the highest-`gameScore` upcoming game"

`gameScore` is defined in §4 (`:159-161`) as a sum over stake weights times *active trigger leverage*. Pre-game, by definition, there are no active triggers, so the formula evaluates to zero for every game. And the stakes model it depends on is Phase 1, which U2 explicitly does not depend on (`:524`). Meanwhile the shipped `priorityScore` (`services/engine/src/computeFlagState.ts`, surfaced as `priority_score` in `services/api/src/routes/flags.ts`) is also a live-state score — it requires possession, so it is equally unavailable pre-game. **U2 needs a pre-game ranking rule that the plan does not specify.** Starter count per game (available today via `countStakePlayersInGame`, `app/lib/homeState.ts:228`) is the obvious candidate, but that is an invention, not a spec.

---



## 4. Phase U1 readiness — file-by-file change list

U1 scope per `:522`: amber-ladder tokens (§11.1) + `Slip` refactor of the paywall (§11.2). **List only — nothing below has been implemented.**

### 4.0 Blocking decision before any code

Resolve the `#FFB020` vs. `#F5A018` conflict (§3.1). Until Parker rules, the `ember` and `flareGlow` values in §11.1 cannot be written. The other five tokens (`brass`, `flare`, `well`, `wellBorder`, `rowDivider`) are independent of the accent and could proceed, though shipping a half-ladder is probably not worth it.

### 4.1 `app/lib/theme.ts` — additive edits

- Add to `colors` (after `accentGlow`, `:26`): `ember`, `brass` `#A07C38`, `flare` `#FFC94D`, `well` `#070709`, `wellBorder` `#1E1E25`, `rowDivider` `#16161B`.
- Add to `effects` (after `panelGlow`, `:61`): `flareGlow` — `shadowColor` (pending 4.0), `shadowOffset {0,0}`, `shadowOpacity 0.25`, `shadowRadius 24`, plus an `elevation` value. **Note:** §11.1 (`:368`) omits `elevation`; `panelGlow` has `elevation: 8` (`theme.ts:60`) as the Android fallback. Pick a value or document the omission — the object is `as const` and consumed by spread, so an asymmetric shape is a typing inconsistency, not just a style one.
- `ember` is dual-valued in the plan (`:364`): `rgba(255,176,32,0.05)` *or* `#1A150C` solid. One token cannot be both. Needs either two keys (`ember` / `emberSolid`) or a decision.
- Touch no existing key.



### 4.2 `app/lib/theme.test.ts` — additive test edits

- Add one new `it` block (matching the existing convention at `:100`, `'adds the UI-SPEC.md §2 border/glow tokens'`) asserting each new color via `toBe` and `flareGlow` via `toEqual`.
- **Change nothing in the five existing blocks.** If any existing assertion needs editing, U1 has stopped being additive — treat that as a stop-and-ask signal.
- Verify with `pnpm test` (root), **not** `pnpm --filter app test` (§1.5).



### 4.3 `app/components/Slip.tsx` — new file

- Props at minimum: `children`, optional `style` override (for the paywall's `maxHeight: '80%'`, `UpgradeSheet.tsx:239`), optional `perforated` flag (§11.2 `:386`), optional `onPress` or a `Pressable`/`View` switch (see §2(a) note 1).
- Surface recipe lifted verbatim from `UpgradeSheet.tsx:234-244`: `backgroundColor: theme.colors.background`, `borderColor: theme.colors.accentBorder`, `borderRadius: theme.radii.lg`, `borderWidth: theme.effects.panelBorderWidth`, `...theme.effects.panelGlow`.
- The perforated divider (`:386`: dashed hairline + two half-circle notches in the `background` color) is **not built anywhere today** and is not exercised by the paywall. Building it in U1 means shipping untested, unused code; deferring it to U7/U5 (its actual consumers per `:387`) is the safer read of "no visual change."
- The plan's "plus a drop shadow" (`:386`) must default off — see §2(a).



### 4.4 `app/components/UpgradeSheet.tsx` — refactor

- Replace the `Pressable style={styles.card}` at `:165` with `<Slip>`, preserving the tap-blocking `onPress={() => {}}`.
- Delete the surface properties from the local `card` style (`:235-238`, `:243`), keeping the paywall-specific ones (`maxHeight`, `paddingBottom`, `paddingTop`, `width`) and passing them through `Slip`'s style override.
- Leave `cardWrap` (`:252`), `dim` (`:263`), and all content styles untouched.
- Do **not** touch the copy in this phase. §10.4's new headline and Season Pass block (`:330-341`) are M1 (`:526`), not U1.



### 4.5 Tests that need updating

- `app/lib/theme.test.ts` — the only file. One added block.
- **No component test exists or can exist** for the `Slip` refactor without new dependencies (§1.6). `vitest.config.ts:17` would need `.tsx` in `include`, `environment` would need jsdom or similar, and `@testing-library/react-native` would need adding — all out of U1 scope and all forbidden as unrequested additions under `.cursorrules`. Regression coverage for U1's second half is §11.5 step 2's manual screenshot diff, full stop.
- No API, engine, dispatcher, or shared test is touched by U1.



### 4.6 Verification sequence

1. Baseline: `pnpm test` at the repo root, save output.
2. Apply 4.1 + 4.2, re-run `pnpm test`, confirm the same tests pass plus the new block.
3. `git diff app/lib/theme.ts` — confirm additions only, no modified lines (§11.5 step 1's actual intent).
4. Screenshot the paywall on a simulator before 4.3/4.4, apply them, screenshot again, diff.
5. `pnpm typecheck` — `theme` is `as const` and widely consumed; additive keys are safe but the check is cheap.

---



## 5. Open risks



### 5.1 U1 — the token ladder is specified against a palette the app doesn't have

Covered in §3.1. The risk is not the work, it's that U1 looks like a 30-minute mechanical task and is actually blocked on a design decision. If someone implements §11.1 literally, `theme.test.ts:13` fails and the "purely additive" property — the entire premise of U1 — is lost. **Resolve before assigning.**

### 5.2 U1 — "no visual change" has no automated guard

No component tests exist and none can be added within U1's scope (§1.6, §4.5). The `Slip` refactor's correctness rests on one manual screenshot comparison. Low severity (the surface recipe is four properties), but it means U1 cannot honestly be called verified by CI.

### 5.3 U1/U2 — the plan's verify commands run zero tests

§1.5. Any phase whose gate is "run `pnpm --filter app test`" will report success without executing anything. This affects the gating model for every U phase, not just U1, and it is the kind of failure that is invisible until something breaks much later.

### 5.4 U2 — pre-game hero ranking is unspecified

§3.7. `gameScore` (§4) and the shipped `priority_score` are both live-state scores; neither produces a meaningful pre-game ordering. U2 cannot implement `:423` as written and will have to invent a rule.

### 5.5 U2 — State 3 and State 4 feed different data into a now-shared presentation

§2(d) note 2. `state3` passes `lineupGroups` (`index.tsx:444`) and `state4` passes `upcomingGames` (`index.tsx:451`); the latter is filtered to future kickoffs (`homeState.ts:313-326`), the former is not. §11.3 merges their presentation (`:423`) without saying which input survives. Picking `weekGames` (the full slate, already loaded at `index.tsx:231`) is probably right for a board, but the stake-row subset still needs one of the two.

### 5.6 U2 — "network" labels need a new mapping the plan treats as free

§2(c) condition 2. The board row (`:391`) wants a network string; the wire gives a subscription-ranked service enum. Small, but unscoped.

### 5.7 U2/U4 — Home's data layer is a single monolithic `loadHome`

`app/app/(app)/(tabs)/index.tsx:173-283` is one ~110-line callback that fetches, derives, and sets all 14 fields of `HomeData` in one shot, re-run on a 30s interval (`index.tsx:305-312`) and on every WebSocket reconcile (`index.tsx:285-293`). §11.3's claim that Home "keeps its existing state machine… This is a presentation change, not a data change" (`:407`) is true of `resolveHomeBranch` but not of the screen: adding a full-slate board, a live/upcoming split, and a per-second focused countdown (`:429`) all land inside this function. U2 is marked Opus/MAX (`:524`), which is the right call, but the plan under-describes the surface area.

### 5.8 U4 — its stated dependency does not exist, and neither does the pipeline it assumes

U4 depends on "production pipeline fixes merged" (`:525`). Per §2(g), **none of the four are merged**, and more fundamentally there is no production live-ingestion runner at all — `services/api/src/worker.ts` is lineup-sync only, and the sole path from ESPN to a notification lives in `experiments/live-sunday-harness.ts`. U4's verify step (`:456`, "replay the captured `plays-<date>.jsonl` through the local harness so a flag fires") is achievable via the harness, but "production pipeline fixes merged and verified on device" (`:12`) is a substantially larger body of work than four bullet points suggests. This also gates every stakes phase.

### 5.9 M1 — the offerings fallback can charge the wrong price

§2(f), first bullet. `getProMonthlyPackage()`'s `?? current.monthly ?? current.availablePackages[0]` chain (`app/lib/purchases.ts:49-52`) exists to be forgiving with one product in the offering. With two, the final fallback can return the Season Pass while the UI renders a monthly price label (`UpgradeSheet.tsx:60`, `:206`). This is a real-money bug, not a UI bug. M1 must split the resolver per product id and remove the positional fallback.

### 5.10 M1 — nobody recomputes tier at the expiry boundary

§2(e), final paragraph. `subscription_tier` is webhook-written only (`billing.ts:93`), and a time-based expiry emits no event at the moment it lapses. Either add a scheduled recompute or move the five gating reads onto a shared derived predicate. The plan's §10.3 specifies the predicate but not the cache-invalidation story.

### 5.11 M1 — non-renewing expiry behavior is unverifiable from this repo

§2(f). Whether RevenueCat emits `EXPIRATION` for `pivot_pro_season` depends on dashboard configuration not present here. Treat §10.5.1's sandbox purchase as a genuine discovery step, not a confirmation step.

### 5.12 Cross-cutting — two preference keys need three-file coordinated changes each

§1.10. `preferences.following` (U5) and `preferences.seenCoachMarks` (U5) each require `shared/src/types/preferences.ts`, `app/lib/me.ts`, and `services/api/src/routes/me.ts`'s PATCH allow-list. Writing either without the schema change fails silently — zod strips the key on read, so the bug presents as "the setting doesn't persist" with no error anywhere.

### 5.13 Cross-cutting — the referenced fixture name doesn't exist

§1.7. Four verify steps across §8, §11.5 and §12.2 reference `plays-<date>.jsonl`. The real artifacts are `experiments/logs/events-<ISO>.jsonl`. Whoever writes the U4/U6 harness steps needs to confirm those event logs actually contain replayable plays in the expected shape — this pass did not inspect their contents.

### 5.14 Cross-cutting — three specs now describe Home

`PLAN.md` §10 is declared the source of truth for States 1 and 2 (`UI-SPEC.md:5`, `:7`). `UI-SPEC.md` remains live for unshipped proposals. `PIVOT-STAKES-PLAN.md` §11 declares itself to supersede `UI-SPEC.md` for Home (`:355`). §3.6 is already an instance of the drift this produces — `PLAN.md:1603` describes a State 3 link that Home does not render. The fold-back convention at `:532` is the right mechanism; it just needs to actually happen at each phase boundary.

---



## Appendix — verification commands used

```
pnpm exec vitest run app/lib/theme.test.ts   # 1 file, 5 tests, passing
pnpm --filter app test                        # exit 0, zero tests run
pnpm -r test                                  # "Scope: 6 of 7 workspace projects", zero tests run
git log --oneline -25                         # HEAD = f1e0963, branch main
```

