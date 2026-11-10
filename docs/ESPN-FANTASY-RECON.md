# ESPN Fantasy (v2): recon and design

Issue #57. Research and design only: no application code, migration, dependency or probe was
written or run. Parker decides go / no-go (section 7). `CLAUDE.md` wins where this doc and an older
doc disagree. Date of research: 2026-11-10.

## How to read the evidence labels

- **VERIFIED**: read in this pass, from the URL cited next to the claim, or from this repo at the
  commit this branch was cut from.
- **SECONDARY**: reported by a third-party write-up or an unofficial client; it describes ESPN's
  behavior but ESPN does not document it, and the write-up may be old.
- **UNVERIFIED**: could not be confirmed from this environment (no ESPN account, shell network is
  allowlisted, and several GitHub source pages were refused by the fetch tool). Treat as a
  hypothesis to test, not a fact. Section 8 lists every UNVERIFIED claim in one place.

No ESPN request was made from a shell and no cookie, login or real person's data was touched. The
only ESPN endpoint fetched was the public, league-less `games/ffl` index (section 1.1).

## 0. Summary

- ESPN has no public fantasy API. Everything below is the undocumented endpoint family that
  `cwendt94/espn-api` and several R/Python/JS clients wrap. It can change or block us without
  notice, and ESPN's published terms very likely prohibit automated access (section 7.2).
- Private leagues (the default, SECONDARY) need two session cookies, `espn_s2` and `SWID`. Those are
  account credentials. Storing them breaks Pivot's current promise that no third-party credentials
  are kept, and changes the privacy policy and App Store label (section 4).
- **Recommendation: conditional no-go on shipping credential-based sync in v2.** Do the
  credential-free foundations first (provider seam, visible staleness), run one cheap probe, then
  decide. Details and the first slice worth shipping alone are in sections 6 and 7.

## 1. What ESPN exposes today

### 1.1 Base URLs

| Claim                                                                                                                                                                                                                                                             | Status                                                                    | Source                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| League endpoint, 2018 onward: `.../apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{league_id}`. Before 2018: `.../games/ffl/leagueHistory/{league_id}?seasonId={season}`.                                                                                  | SECONDARY (two independent clients agree)                                 | [stmorse](https://stmorse.github.io/journal/espn-fantasy-v3.html), [ffscrapr source](https://rdrr.io/cran/ffscrapr/src/R/espn_api.R)                                                                                                                           |
| Host moved to `lm-api-reads.fantasy.espn.com` (author's Sept 2024 edit: "the only change needed").                                                                                                                                                                | SECONDARY                                                                 | [stmorse](https://stmorse.github.io/journal/espn-fantasy-v3.html), [nntrn gist](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c)                                                                                                                |
| `GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl` returned HTTP-successful JSON with `abbrev: "FFL"`, `active: true`, `currentSeasonId: 2026`, `proSportAbbrev: "NFL"`. So the host and path family are alive today, for the games index, no cookies. | VERIFIED (fetched today)                                                  | [games index](https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl)                                                                                                                                                                                         |
| Anomaly: the same response reported `currentSeason.currentScoringPeriod.id = 2` on 2026-11-10, which is not the current NFL week. Do not derive the week from ESPN; keep using Pivot's own NFL state (`getLineupSyncContext`).                                    | VERIFIED as observed; cause UNVERIFIED (could be a stale or cached field) | [games index](https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl)                                                                                                                                                                                         |
| ESPN's own response field names (`id`, `scoringPeriodId`, `teams[].roster.entries[].lineupSlotId`) were not re-read from a live league response.                                                                                                                  | UNVERIFIED                                                                | `cwendt94/espn-api` source files (`espn_api/requests/espn_requests.py`, `espn_api/football/league.py`) were refused by the fetch tool (not on the allowlist), so request construction and field names below come from third-party docs plus memory of the repo |

### 1.2 Views needed for Pivot

Views are requested as repeated `?view=` query params and combined. Third-party notes warn that
combining views "can often return different results than calling them separately"
([ffscrapr vignette](https://search.r-project.org/CRAN/packages/ffscrapr/vignettes/espn_getendpoint.html)).
Filtering and limits go in an `X-Fantasy-Filter` JSON header, and un-filtered player lists cap at
50 ([nntrn gist](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c)).

| Pivot need                                                               | View(s)                                                                                                 | Status                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| League name, roster slot counts (starter/bench/IR/FLEX), scoring, season | `mSettings`                                                                                             | `mSettings` is named in the private-league example URLs; its fields are not described in any source read ([nntrn gist](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c)). Field names UNVERIFIED |
| Which team is the user's (owner match) and team names (opponent label)   | `mTeam`                                                                                                 | View name SECONDARY; the field that maps a team to the logged-in user (owner id matching `SWID`) is UNVERIFIED                                                                                                  |
| Static roster (offseason / `display_phase` `off` or `pre` fallback)      | `mRoster`                                                                                               | View name SECONDARY ([stmorse](https://stmorse.github.io/journal/espn-fantasy-v3.html)); contents UNVERIFIED                                                                                                    |
| Weekly matchup, who the user plays, both lineups with slot per player    | `mMatchup` and/or `mMatchupScore`, with `scoringPeriodId` = NFL week                                    | `mMatchup` "returns weekly matchup scores" and "also includes roster info" (SECONDARY, [stmorse](https://stmorse.github.io/journal/espn-fantasy-v3.html)). Slot semantics UNVERIFIED                            |
| Draft completion                                                         | `mDraftDetail` (struck through in one gist, possibly dead) and `status` in the league response          | UNVERIFIED; see 1.4                                                                                                                                                                                             |
| Player identity (ESPN player id to Pivot player)                         | Join on `players.espn_id` (already exists, see 1.5). Player names/positions via `kona_player_info` view | View name SECONDARY; the join column is VERIFIED in this repo                                                                                                                                                   |

Position ids documented by one source: 1 QB, 2 RB, 3 WR, 4 TE, 5 K, 16 DST
([nntrn gist](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c), SECONDARY).
**Lineup slot ids** (which slot a player occupies: starter by position, FLEX, bench, IR) are a
different id space. The values `espn-api` uses (for example 20 bench, 21 IR, 23 FLEX) are from
memory and are **UNVERIFIED**. The nntrn gist explicitly does not document lineup slot ids. The
mapping must be confirmed against a live response before any parser is written.

Mapping to our contract (`FetchedLineup` in
`services/api/src/providers/fantasy-provider.ts`): `slots` need `slotType`
(`starter | bench | flex | idp`, per `is_valid_slot_type`) and `positionInLineup`. ESPN FLEX and
Superflex both map to `flex`; IR and bench map to `bench`. `opponentSlots` and `opponentTeamName`
come from the other side of the same matchup entry.

### 1.3 Public vs private leagues

- **Private leagues** need cookies. The R-to-Python private-league write-up describes sending
  `SWID` and `espn_s2` against the same URL as public leagues, and a request without working
  cookies returning 401 ("the request has been blocked"), while with correct cookies Python got
  200 ([dusty-turner](https://dusty-turner.netlify.com/post/espn-fantasy-football-v3-api-for-private-leagues-python-through-r/),
  SECONDARY). The `espn-api` wiki says private leagues need `swid` and `espn_s2` in addition to
  league id and year ([wiki](https://github.com/cwendt94/espn-api/wiki), VERIFIED). The wiki also
  recommends logging in with credentials even for public leagues, to unlock the recent-activity
  feed (same page).
- **Public leagues** are readable without cookies in principle (ffscrapr only attaches cookies when
  both are supplied: [espn_connect source](https://rdrr.io/cran/ffscrapr/src/R/espn_connect.R)),
  but an R client documents "only supports public leagues" as a limitation, and no source says
  what share of real ESPN fantasy football leagues are public.
- ESPN's own help center says leagues in its League Manager product are private by default, and
  that "viewable" is a commissioner setting that does not make a league joinable
  ([ESPN support](https://support.espn.com/hc/en-us/articles/360000064451), VERIFIED, but it is
  about League Manager, not clearly the standard Fantasy Football game). **Whether standard ESPN
  Fantasy Football leagues are private by default, and which team data a "public" league exposes
  through the API, is UNVERIFIED.** Assume the large majority are private until the probe says
  otherwise.

### 1.4 Not-yet-drafted leagues

UNVERIFIED. No source read describes the response shape for an undrafted league (empty
`roster.entries`? missing `mMatchup` schedule? a draft-status field?). Pivot's design must not
depend on it: the existing off/pre path stores a roster-only fallback (`fetchRosterPlayers`) and
the provider should return an empty list, not an error, when ESPN returns an empty roster before
the draft. The probe in section 7.4 must capture this shape.

### 1.5 Player identity (a prerequisite problem)

- `players.espn_id` already exists (`supabase/migrations/20261109120000_picks_props_parlays.sql`),
  and `scripts/seed-players.ts` fills it from Sleeper's player dump (`espnIdOf`). Coverage is
  unmeasured (UNVERIFIED): any player Sleeper lists without an `espn_id` will not resolve.
- `syncLeagueLineup` resolves incoming ids only through `players.sleeper_id` (see
  `resolveSleeperIdsToPlayerIds` and the `players` select in `services/api/src/lib/lineup-sync.ts`,
  and `readOpponentForWrite`). `assertPlayersResolved` also hard-codes Sleeper in its error text. A
  second platform needs an id-kind concept on `NormalizedLineupSlot` (see slice 1 in section 6).
- `scripts/seed-players.ts` skips players whose only fantasy position is DEF, so team defenses are
  not in `players`. ESPN lineups include D/ST slots (position id 16, SECONDARY). Decide to drop
  them (as Sleeper's DEF is effectively dropped today) and log them as unresolved, not fail.

## 2. Auth options

All four options use the same read path once a request is authenticated or known to be public.
"Likelihood" is a judgment call, not measured data.

| Option                                       | UX                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Completion likelihood                                                                                                                                                                                                                                               | Cookie lifetime                                                                                                                                                                                                                                                                                                                              | What we store                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) User pastes `espn_s2` and `SWID`         | User must open ESPN in a desktop browser, open devtools or cookie storage, and copy two values (one contains braces). The library's own maintainers point users to a manual method plus an open-source Chrome extension ([discussion 150](https://github.com/cwendt94/espn-api/discussions/150)).                                                                                                                                                                           | Very low on a phone, low on desktop. Fine for power users. This is a developer flow.                                                                                                                                                                                | The maintainer says the values "remain the same through different sessions" ([discussion 150](https://github.com/cwendt94/espn-api/discussions/150), SECONDARY, written 2020 and edited Aug 2025 to say the manual method "still fully works"). No source states a duration or invalidation rules (password change, logout). **UNVERIFIED.** | Both cookie values, encrypted (section 4).                                                                                                    |
| (b) In-app web login that captures cookies   | A WebView to ESPN's login, then Pivot reads the cookies. The app has no WebView dependency today (`app/package.json`), so this needs a native package and an EAS build. On web (`app.pivot-sports.app`) the browser will not hand another origin's cookies to us, so web would need a browser extension, which is what FantasyPros does ([FantasyPros](https://support.fantasypros.com/hc/en-us/articles/360051313453-How-do-I-add-my-ESPN-fantasy-league-to-my-account-)). | Highest of the credentialed options on iOS, lowest friction. Login uses ESPN/Disney sign-in, with reCAPTCHA reported since 2020 ([discussion 150](https://github.com/cwendt94/espn-api/discussions/150)), which may break or flag an embedded WebView (UNVERIFIED). | Same cookies as (a), so same UNVERIFIED lifetime. Re-capture is a login again, so the failure UX is better than (a).                                                                                                                                                                                                                         | Both cookie values, encrypted. Highest review exposure: Apple's and ESPN's reaction to an app harvesting a third-party session is UNVERIFIED. |
| (c) Public leagues only, no credentials      | User enters a league id (and picks their team). Works only if the league is viewable without login.                                                                                                                                                                                                                                                                                                                                                                         | High for those who qualify, but the qualifying share is unknown (section 1.3). Everyone else hits a dead end and falls back to manual.                                                                                                                              | Not applicable.                                                                                                                                                                                                                                                                                                                              | League id, team id. Same shape as Sleeper today.                                                                                              |
| (d) League id entry, read only what's public | Same as (c) in practice. The distinction worth keeping: (c) is "league is public, read the roster and matchup"; (d) is "read only the public subset even when the league is private". Public pages of a private league (if any) are likely too thin to build a lineup (UNVERIFIED).                                                                                                                                                                                         | Low value on its own; not worth a separate build.                                                                                                                                                                                                                   | Not applicable.                                                                                                                                                                                                                                                                                                                              | League id.                                                                                                                                    |

Other precedent: FantasyPros stores "an encrypted copy of your ESPN cookie" on its servers for
periodic sync on web, uses username and password in its mobile app, and requires a Chrome
extension for web since July 2020
([FantasyPros](https://support.fantasypros.com/hc/en-us/articles/360051313453-How-do-I-add-my-ESPN-fantasy-league-to-my-account-)).
Footballguys' sync guide lists third-party cookies, VPNs and extensions as failure causes
([Footballguys](https://sportsguys.zendesk.com/hc/en-us/articles/38082296207003-ESPN-Sync-Issues)).
This shows credentialed ESPN sync exists in the market and also that it is operationally fragile.

A credential-free fifth path, outside the four options the issue asked about, is worth one line:
an import-from-screenshot flow (the repo already has a bet-slip photo import design in
`docs/PRIVACY-POLICY-DRAFT.md`). It avoids ESPN's endpoints and cookies entirely but does not
refresh automatically, so it is a manual-lineup accelerator, not a sync. Manual lineups stay the
permanent fallback regardless.

### Recommendation

1. **Ship (c) first, behind `FEATURE_ESPN`, only if the probe (section 7.4) shows a meaningful
   share of real leagues are readable without login.** It adds no stored secret, so the privacy
   promise and App Store label do not change. Do not build (d) separately.
2. **Do not ship (a) or (b) in v2 unless Parker accepts, in writing, the privacy-promise change
   and the terms exposure in section 7.** If one credentialed option is eventually shipped, prefer
   **(b) on iOS** for completion rate, and accept that it needs a build. (a) is a power-user
   escape hatch and should not be the primary path.
3. Cookie lifetime is UNVERIFIED and drives the cost of (a) and (b): if cookies last days, support
   load is high. The probe must observe lifetime with a throwaway account.

## 3. Where the logic runs

|                              | TypeScript client in `services/api`                                                                                                                                                                   | Python `espn-api` sidecar on Fly                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape                        | `espn-client.ts` beside `sleeper-client.ts` (plain `fetch` with two cookies and an optional `X-Fantasy-Filter`), `espn-provider.ts` implements `FantasyProvider`, registered in `providers/index.ts`. | A new Fly app (or a fourth process group on `pivot-sports-api`) running Python, exposing an internal HTTP API, called by `services/api` / worker.                                                                                                                                                                   |
| Cost                         | No new infrastructure. Our own parsing and tests (estimate: a few hundred lines plus fixtures; this is an estimate, not measured).                                                                    | New runtime, new Docker image, a second language to keep patched, and a new internal service. Fly machine cost is small but nonzero (not quoted here; pricing UNVERIFIED).                                                                                                                                          |
| Deploy surface               | Same `pivot-sports-api` processes (`api`, `worker`, `runner`; `fly.toml`). No `fly.toml` change.                                                                                                      | New app or new `[processes]` entry, a private network route, health checks, and a secret store. Touches `fly.toml` or a new one.                                                                                                                                                                                    |
| Credential exposure          | Cookies stay inside the process that already holds the service-role key.                                                                                                                              | Cookies cross a network boundary to a second service, which must also decrypt or receive plaintext. Larger attack surface.                                                                                                                                                                                          |
| Failure modes                | We own parsing. ESPN schema drift breaks us until we patch, but we see the raw response and can pin fixtures.                                                                                         | Library fixes come from upstream, but `espn-api` is a hobby project (README lists NHL/MLB/WNBA as "in development"; [PyPI](https://pypi.org/project/espn-api/): 1.0.1 on 2026-10-09). Upstream lag plus our own sidecar outage are two failure points. Its football parser has no guarantee of covering our fields. |
| Game-day rules (`CLAUDE.md`) | Backend deploys Tue/Wed/Fri/Sat only; anything touching iOS push or presence Tue-Wed only. A client-only change sits entirely inside this rule.                                                       | Same rules apply to every Fly deploy, plus a second deploy target to remember. A hotfix on a game day is blocked either way, so a schema-drift fix would wait for Tue/Wed.                                                                                                                                          |
| Redis note                   | Rate limiting can use the existing self-hosted Redis (`pivot-sports-redis`).                                                                                                                          | Needs its own rate limiting or a shared client.                                                                                                                                                                                                                                                                     |

**Recommendation: TypeScript client inside `services/api`.** The API surface we need is a handful
of GETs, so a sidecar buys a second language, a second deploy and a wider credential blast radius
for little. Use `espn-api` as a reference for field names and slot ids (once fetched), not as a
runtime dependency.

A caution that applies to both: **`runner` and `worker` share one Fly secret store**
(`fly secrets` is app-wide), so an encryption key set for `worker` is visible to the `runner`
process too. If we store credentials, the key lives in that shared store; call this out when
documenting who can read it (section 4).

## 4. Credential handling (only if we store `espn_s2` / `SWID`)

Today the database is service-role only and nothing is client-readable
(`docs/PRIVACY-INVENTORY.md`). Keep it that way.

### 4.1 Storage and encryption

- New table (name suggestion `espn_credentials`): `user_id uuid primary key references
public.users (id) on delete cascade`, `ciphertext bytea not null`, `nonce bytea not null`,
  `key_version int not null`, `status text not null` (`ok | needs_reauth`), `created_at`,
  `last_verified_at`, `last_failure_at`. **RLS enabled, no policies, all privileges revoked from
  `anon` and `authenticated`**, matching the "new tables default to RLS on and service-role-only"
  rule in `CLAUDE.md`. Store both cookies as one encrypted JSON blob, never as separate plaintext
  columns, and never in `leagues`.
- Encrypt at the application layer with AES-256-GCM before the write, so a database dump, a
  Supabase dashboard view, or a backup does not contain a usable cookie. Use `key_version` so the
  key can rotate (re-encrypt on next successful use). Supabase Vault is an alternative; its
  availability and long-term support on our plan are UNVERIFIED, and app-layer encryption has no
  such dependency, so prefer it.
- Key management: one 32-byte key in a Fly secret (for example `ESPN_CRED_KEY`, plus `_V2` during
  rotation), never in the repo, never in `.env` files we commit. Per `CLAUDE.md`, a session never
  runs `fly secrets`; Parker sets it. Caveat from section 3: every process group sees the secret.
- Never hand cookie values to the client after capture. The API accepts them once and returns only
  status (`connected`, `needs_reauth`).

### 4.2 Who can read

| Party                               | Can read plaintext?         | Notes                                                                                 |
| ----------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| User's own client                   | No                          | Table is service-role only; API never echoes cookies.                                 |
| `api` / `worker` processes          | Yes, transiently            | Decrypt in memory for one request, never persist, never log.                          |
| `runner` process                    | Key is present              | Shares the Fly secret store; the code path must not decrypt.                          |
| Parker via Supabase dashboard / SQL | Ciphertext only             | The key is not in Supabase.                                                           |
| Supabase, Fly                       | Ciphertext / key separately | Neither holds both, unless an operator exports the Fly secret and a DB dump together. |

### 4.3 Deletion

- `ON DELETE CASCADE` from `public.users` (which itself cascades from `auth.users`), per the
  `DELETE /me` design in `docs/PRIVACY-INVENTORY.md`. Add the new table to
  `services/api/src/lib/accountDeletionCascade.test.ts`, which already asserts every table is
  emptied.
- Hard-delete the row on "Disconnect ESPN", and purge `needs_reauth` rows after a fixed number of
  days (suggest 30) so dead credentials do not accumulate.
- Backups: ciphertext may persist in Supabase backups until they age out; say so in the policy
  (UNVERIFIED how long the hosted project retains backups).

### 4.4 Logging rules

- Never log a `Cookie` header, a cookie value, or the decrypted blob. Never include them in an
  `Error` message, a thrown `ApiError` payload, or a Sentry event. Sentry is only invoked from the
  ESPN ingestion adapter today with non-user data (`docs/PRIVACY-INVENTORY.md`); keep
  `sendDefaultPii` off and do not add the ESPN client to Sentry scopes without a scrubbing review.
- Log league id prefix and error code only, in the style of the existing
  `[lineup-sync] unresolved players league=${leagueId.slice(0, 8)}` line.
- Redact in the HTTP client wrapper (strip `cookie` and `set-cookie` before any logger sees the
  request or response object).
- Test: an automated test that makes a fake provider fail and asserts no cookie string appears in
  captured log output.

### 4.5 Exact edits to the privacy docs (to make in the slice that stores credentials, not now)

`docs/PRIVACY-INVENTORY.md`

- Add a data row: **ESPN session cookies (`espn_s2`, `SWID`)**. Purpose: read the user's private
  ESPN lineup. Storage: `public.espn_credentials` (encrypted `ciphertext`). Processor: Supabase
  (ciphertext) and Fly (key). Retention: until disconnect, `needs_reauth` purge, or account
  deletion. Deleted on account deletion: Yes (cascade).
- Edit the "Fantasy league link (Sleeper)" row so it no longer implies all platforms are
  credential-free, and add an "ESPN" row for `public.leagues` with `platform = 'espn'`.
- Add **ESPN (Disney)** to "Processors referenced above": a third-party platform queried with the
  user's own session cookies, unlike Sleeper.
- Update the open items list: key custody, backup retention of ciphertext, and a note that Fly
  secrets are shared by all process groups.

`docs/PRIVACY-POLICY-DRAFT.md`

- In "Fantasy league connection", keep "We never ask for or store your Sleeper password" but add:
  "If you connect an ESPN league that is private, we store the ESPN sign-in cookies you provide,
  encrypted, so we can read your lineup. We never see or store your ESPN password. You can
  disconnect at any time, which deletes them."
- In "Who else sees your data", extend the Sleeper bullet with an ESPN bullet that says we send
  ESPN your session cookies, unlike Sleeper.
- In "Deleting your account", add ESPN connection data to the list.
- Replace the line that says the connection "uses Sleeper's public roster data, not a login" with
  platform-specific wording.

`docs/APP-STORE-PRIVACY-LABELS.md`

- Add a row: ESPN session cookies. Suggested category **User Content → Other User Content** (linked
  to identity, not used for tracking, purpose App Functionality). **[confirm]**: Apple has no
  dedicated "third-party credentials" data type that this pass could verify, and whether this
  should be declared under another category is UNVERIFIED. Parker should confirm in App Store
  Connect, and consider asking App Review.
- The label must be updated **before the build that ships credential capture**, not after.

`CLAUDE.md` / `PIVOT-STAKES-PLAN.md` language that says Pivot holds no third-party credentials
should be updated in the same PR as the first credential-storing slice.

## 5. Sync and failure design

### 5.1 Current behavior (VERIFIED, this repo)

- `runWorkerCycle` (`services/api/src/lib/worker-cycle.ts`) polls every tick (5 minutes) in
  `regular`/`post`, at most daily in `off`/`pre`, and selects leagues with
  `.eq('platform', 'sleeper')`. A new platform is invisible to the worker until that filter
  changes.
- A failed league sync is counted and `console.error`'d, and the loop continues. **`leagues.
last_synced_at` is not touched on failure, and `lineup_slots` from the last good sync stay in
  place.** Nothing marks the league stale and the client only reads `last_synced_at` for one
  empty-state string (`app/lib/opponentLineup.ts`: "Syncing your matchup…"). So today a failing
  sync serves last week's or last hour's lineup silently. This is exactly the failure the issue
  warns about, and it already applies to Sleeper.
- Lineup source is already recorded (`leagues.lineup_source`: `matchup` or `roster_fallback`).
- Gating by tier uses `league_limit_free` 403s (`services/api/src/routes/leagues.ts`); ESPN leagues
  would count toward it with no new code.

### 5.2 Design

**When we sync** (unchanged cadence, reuse the worker):

- Scheduled: every 5 minutes in `regular`/`post`, daily otherwise (existing).
- On connect (like `POST /leagues/sleeper`), and via `POST /leagues/:id/sync` (existing).
- Highest-stakes windows (before Thu/Sun/Mon games): the cadence is already 5 minutes all week;
  add a **pre-kickoff verification**: if the next game for any of the user's rostered teams starts
  within 30 minutes and the league's last success is older than the stale threshold, retry now
  with a short budget. This is the moment a lineup lock matters.

**What "stale" means** (a derived value, computed server-side and sent to the client):

- `fresh`: last successful sync within 15 minutes (3 missed 5-minute cycles) during `regular`/`post`
  and a rostered game is within the next 3 hours or in progress; otherwise within 24 hours.
- `stale`: older than that threshold, but credentials not known-bad.
- `needs_reauth`: ESPN returned 401/403 for this league's credentials. Not retried more than once
  per hour, to avoid hammering ESPN or triggering an account lock (UNVERIFIED whether ESPN locks).
- `unavailable`: ESPN returned a non-auth error (5xx, non-JSON, schema we cannot parse) repeatedly.
  Distinguish "ESPN is down / changed" from "your cookies expired": the user fix is different.

These thresholds are proposals to tune with real data, not measured values.

**What the user sees** (copy follows `CLAUDE.md`: full sentences, "pick", never "stake"):

- `fresh`: nothing.
- `stale`: a small inline label on the lineup showing the age, for example "Lineup last updated 40
  minutes ago." Do not claim it is current.
- `needs_reauth`: a banner on the league: "Your ESPN connection expired. Reconnect to keep your
  lineup up to date." with a one-tap action. Optionally one push per expiry (not a routing nudge
  or reveal; it is an account notice, so rate-limit it and do not send on quiet hours). The league
  keeps showing the last lineup, clearly labelled with its age.
- `unavailable`: "We couldn't refresh your ESPN lineup. Your last lineup is shown." Offer manual
  edit. Never silently swap data.

**Composition with the worker and flags**

- Replace `.eq('platform', 'sleeper')` with a supported-platform list and let
  `getFantasyProvider(...).supportsSync()` decide. Keep a per-league try/catch so ESPN failures
  never block Sleeper leagues.
- New columns on `leagues` (migration): `sync_status text`, `last_sync_attempt_at timestamptz`,
  `last_sync_error_code text` (snake_case code, never a raw ESPN body). Extend the leagues response
  in `routes/leagues.ts` and `app/lib/leagues.ts` with a derived `sync_state`.
- Feature flag: follow the existing `FEATURE_BETS` pattern in `services/api/src/lib/features.ts`
  (`off | all | allowlist of user ids`, parsed once at startup, defaults to off). Add
  `FEATURE_ESPN` the same way. Server enforces it on connect and in the worker; the client hides
  the option from `/me` data, never from a client-only constant.
- Preferences: avoid adding a key. If one is needed (for example an ESPN reauth push opt-out), it
  needs the three coordinated edits in `CLAUDE.md` (`shared/src/types/preferences.ts`,
  `app/lib/me.ts`, `services/api/src/routes/me.ts` allow-list).
- Rate limiting: one shared limiter in Redis (the self-hosted app) keyed by platform so many users
  syncing at once cannot become a burst to ESPN. Sleeper's public API gets one request pattern
  per league today; ESPN deserves a stricter, explicit budget. Limits are UNVERIFIED because ESPN
  publishes none; ffscrapr warns on HTTP 429
  ([source](https://rdrr.io/cran/ffscrapr/src/R/espn_api.R)).
- Do not touch `demo`: `is_demo` users are pinned to fixtures and refuse writes
  (`demo_account_fixed`). ESPN connect must refuse for them with that code.

## 6. Slice plan

Each slice is an independent issue. "Build vs update" uses the `CLAUDE.md` definitions: **update**
= JS/copy/assets only (EAS Update); **build** = native package, `app.json` native field,
`app/eas.json` or SDK bump. Backend deploys follow the game-day rules: Tue/Wed/Fri/Sat only, push
or presence changes Tue-Wed only.

| #   | Slice                                                                                                                                                                                                                                           | Size | Migration                                                           | Client                                                               | Safe on a game day to ship?                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | **Make sync staleness visible for existing leagues**: `sync_status`/`last_sync_attempt_at`/`last_sync_error_code` on `leagues`, derived `sync_state` in the API, lineup label and banner in the app. Works today for Sleeper with no ESPN code. | M    | Yes (additive columns, regen types)                                 | Update-safe                                                          | Web: yes. Backend: no (Tue/Wed/Fri/Sat). Client JS: update-safe, but not during live games. |
| 2   | **Provider seam generalization**: `externalIdKind` on slots so lineup-sync resolves `sleeper_id` or `espn_id`; worker selects supported platforms; generic unresolved-player errors; handle missing DEF. No ESPN code.                          | M    | No                                                                  | None                                                                 | No (backend deploy, Tue/Wed/Fri/Sat). Easy to test with a fake provider.                    |
| 3   | **Probe (experiment)**: `experiments/espn-probe/` that records the real response shapes for a public league and an own throwaway account, redacts secrets, and measures slot ids, pre-draft shape and cookie lifetime. Not shipped.             | S    | No                                                                  | None                                                                 | N/A (not deployed). Run only by Parker with his own throwaway account.                      |
| 4   | **`espn-client.ts` + `espn-provider.ts`, public leagues only (option c)** behind `FEATURE_ESPN` allowlist, with recorded-fixture tests (no live calls in CI). Connect route `POST /leagues/espn` (league id + team).                            | L    | No (platform `espn` is already valid in `is_valid_league_platform`) | Update-safe (connect UI), unless a native dep is added               | Backend: Tue/Wed/Fri/Sat. Keep flag off or allowlisted.                                     |
| 5   | **Decision gate: credential storage** (not code). Parker decides; privacy/label edits drafted (4.5); ESPN terms position recorded; App Store label updated in App Store Connect first.                                                          | S    | No                                                                  | None                                                                 | N/A                                                                                         |
| 6   | **`espn_credentials` + encrypted storage + deletion cascade test** and the privacy-doc edits from 4.5. No client capture yet.                                                                                                                   | M    | Yes (new table, RLS on, service-role only)                          | None                                                                 | Backend: Tue/Wed/Fri/Sat. Nothing user-visible, so low risk.                                |
| 7   | **Credentialed connect UX**: pasted cookies (a) for a power-user path, or in-app login (b) via a WebView package.                                                                                                                               | L    | No                                                                  | (a) update-safe; **(b) needs a build** (no WebView dependency today) | (a) per update rules; (b) EAS build any day but not during live games.                      |
| 8   | **Reauth and failure flows**: `needs_reauth` handling, one-per-expiry push, reconnect action, purge of dead credentials.                                                                                                                        | M    | Maybe (purge job)                                                   | Update-safe                                                          | Push changes ship Tue-Wed only.                                                             |

**First slice worth shipping on its own: slice 1.** It fixes a real, present problem (silent stale
data) for Sleeper and manual-sync users, needs no ESPN decision, and is a prerequisite for every
later slice. Slice 2 is the second cheapest and is pure refactor. Slices 1 and 2 are the only ones
that should be scheduled before the go / no-go decision.

## 7. Risks and go / no-go

### 7.1 Technical risk

- **Endpoint drift or blocking without notice.** The host already moved once
  (`fantasy.espn.com` to `lm-api-reads.fantasy.espn.com`, author's Sept 2024 edit:
  [stmorse](https://stmorse.github.io/journal/espn-fantasy-v3.html)). Login hardened in Nov 2020
  with reCAPTCHA ([discussion 150](https://github.com/cwendt94/espn-api/discussions/150)).
- **Season rollover.** ESPN reports `currentSeasonId` 2026 today (VERIFIED), but a scoring-period
  field in the same response looked wrong (section 1.1). Do not trust ESPN for the week.
- **Unmeasured identity coverage** (`players.espn_id`, DEF) and **unverified slot ids** (sections
  1.2 and 1.5).
- **2026 migration wave.** ESPN is now the "Official Fantasy Game of the NFL" and NFL Fantasy is
  being retired, with commissioners importing leagues into ESPN
  ([Cord Cutters News, Aug 2026](https://cordcuttersnews.com/the-nfl-is-phasing-out-its-fantasy-app-and-handing-fantasy-football-to-espn-heres-what-players-need-to-know/),
  secondary news source). That raises demand and also means ESPN may change the platform and
  endpoints during the same season we build against it. "More than 24 million fantasy players
  annually" is ESPN's claim as reported there.

### 7.2 Terms-of-use exposure

- ESPN's own `terms2.html` page I could fetch is a Starwave-style agreement with no
  automated-access language, so it did not answer the question
  ([ESPN terms](https://www.espn.com/sitetools/s/terms2.html), VERIFIED as read).
- Disney's general terms (the family ESPN sits under) prohibit accessing or copying services
  "using a robot, spider, script or other automated means": the 2014 text cited was
  "robots, arañas, scrapers u otros medios automatizados o procesos manuales ... sin nuestro
  consentimiento expreso y por escrito"
  ([Disney GTOU 2014, Spanish PDF](https://disneytermsofuse.com/app/uploads/gtou/parent/disney_gtou_20160331_Spanish-TOU.pdf)),
  and a third-party capture of the current Disney+, ESPN and Hulu terms lists a "Prohibition on
  Automated Access and AI Scraping" clause, with the quoted text "access, monitor, copy, or extract
  the Services using a robot, spider, script or other automated means"
  ([ConductAtlas excerpt](https://conductatlas.com/platform/disney/disney-terms-of-use/provision/CA-P-022520/prohibition-on-automated-access-and-ai-scraping/),
  captured 2026-04-22; the site notes later captures failed).
- **UNVERIFIED:** that those terms govern the fantasy API specifically, the current live wording,
  and whether ESPN enforces against third-party apps. Not legal advice: have a lawyer read the
  live ESPN/Disney terms before shipping anything that logs in for users. Pivot's own risk
  posture is stricter than a hobby project's: it is on the App Store with real users, and a cease
  and desist or blocked IP would be a visible outage.
- Competitors operate credentialed ESPN sync (FantasyPros, Footballguys; sources in section 2),
  which shows practice exists, not that it is permitted.
- Storing user session cookies for an app that wraps a third-party login is a sensitive pattern.
  If cookies leak, an attacker could act as the user inside ESPN. That is a security and
  reputational risk beyond terms, covered by section 4.

### 7.3 Go / no-go

**Recommendation: NO-GO on shipping credential-based ESPN sync in v2 as scoped; GO on the
credential-free groundwork and one probe.** Concretely:

- **Go now:** slice 1 (visible staleness) and slice 2 (provider seam). They are independently
  valuable and unblock any platform.
- **Go after a cheap probe:** slice 4 (public leagues only, behind a flag), if the probe shows
  enough public leagues to matter.
- **No-go until Parker decides:** slices 5-8 (any stored credential). Conditions to revisit:
  (1) a written read of ESPN's live terms by someone qualified, (2) Parker accepting the privacy
  promise change and the labeled App Store update, (3) probe evidence on cookie lifetime and
  schema stability, and (4) a measured completion rate on a small allowlist.
- Keep manual lineups as the permanent fallback regardless of what ships.

### 7.4 Cheapest experiment to reduce the biggest unknown

The biggest unknown is not engineering, it is **whether enough real ESPN leagues are readable
without credentials, and what the response looks like.** Everything else (cookie lifetime, ToS)
is gated on that or on legal review.

Proposed probe, to live at `experiments/espn-probe/` (never `services/`), written and run in a
later task:

1. Read-only GETs against the league endpoint (`mSettings`, `mTeam`, `mRoster`, `mMatchup`) for
   (a) public leagues Parker or volunteers consent to name, and (b) one league owned by a
   throwaway ESPN account created for the test. No real user's cookies. A cookie for the throwaway
   account lives only in the shell env var for the run, is never written to a file, a log or the
   PR, and the account is discarded afterward.
2. Record, with all identifiers redacted: top-level keys, the shape of `roster.entries`, observed
   `lineupSlotId` values by slot, the pre-draft response for an undrafted league, the unauthenticated
   response for a private league (status and body), and the `Set-Cookie` attributes for cookie
   lifetime.
3. Output fixtures the later provider tests can replay, so CI makes no live calls.
4. Acceptance: answers the UNVERIFIED rows in sections 1.2-1.5 and section 8, and gives a measured
   (n small but real) readable-without-login rate.

Not run in this task: no throwaway ESPN session or consented public league id was available, and
the shell network allowlist would not have reached ESPN.

## 8. Things I could not verify

1. Current request construction and field names in `cwendt94/espn-api` (`espn_requests.py`,
   `football/league.py`): fetch tool refused those source URLs. Views, slot ids and error mapping
   come from third-party docs and memory.
2. Lineup slot id values (starter by position, FLEX, bench, IR) and the DST player id convention.
3. Response shape for a league that has not drafted yet.
4. Whether standard ESPN Fantasy Football leagues are private by default, what a public league
   exposes through the API, and what share of leagues are public. ESPN's support page read was
   about League Manager.
5. The unauthenticated response (status and body) for a private league in 2026. A 401 is reported
   in an old write-up only.
6. `espn_s2` and `SWID` lifetime, rotation, and what invalidates them (password change, logout,
   device limit). The maintainer says they "remain the same through different sessions" (2020,
   edited 2025), with no duration.
7. Current live wording of ESPN/Disney terms and whether they cover the fantasy API. Only a 2014
   Disney text and a third-party excerpt (April 2026) were read.
8. ESPN rate limits and blocking behavior; whether repeated 401s lock an account.
9. Whether an embedded WebView login works against ESPN/Disney sign-in with reCAPTCHA, and how
   Apple App Review treats capturing a third-party session cookie.
10. Which Apple privacy-label category best fits ESPN session cookies.
11. `players.espn_id` coverage and whether Sleeper's dump `espn_id` matches ESPN's own ids for
    fantasy-relevant players.
12. Supabase Vault availability and backup-retention duration (hosted project).
13. Fly machine pricing for a sidecar (not quoted).
14. Why the `games/ffl` index reports `currentScoringPeriod.id = 2` on 2026-11-10.

## Sources

- [cwendt94/espn-api README](https://www.github.com/cwendt94/espn-api) and [wiki](https://github.com/cwendt94/espn-api/wiki)
- [PyPI espn-api](https://pypi.org/project/espn-api/) (1.0.1, 2026-10-09)
- [Discussion 150: ESPN_2 and SWID credentials](https://github.com/cwendt94/espn-api/discussions/150)
- [Discussion 499](https://github.com/cwendt94/espn-api/discussions/499) (constructor shape with `espn_s2` and `swid`)
- [stmorse: ESPN fantasy v3](https://stmorse.github.io/journal/espn-fantasy-v3.html)
- [nntrn endpoint gist](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c)
- [ffscrapr: espn_getendpoint vignette](https://search.r-project.org/CRAN/packages/ffscrapr/vignettes/espn_getendpoint.html),
  [espn_api.R](https://rdrr.io/cran/ffscrapr/src/R/espn_api.R),
  [espn_connect.R](https://rdrr.io/cran/ffscrapr/src/R/espn_connect.R)
- [dusty-turner: private leagues](https://dusty-turner.netlify.com/post/espn-fantasy-football-v3-api-for-private-leagues-python-through-r/)
- [ESPN games index](https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl) (fetched 2026-11-10)
- [ESPN support: League Manager viewable setting](https://support.espn.com/hc/en-us/articles/360000064451)
- [ESPN terms page](https://www.espn.com/sitetools/s/terms2.html)
- [Disney GTOU 2014 (Spanish PDF)](https://disneytermsofuse.com/app/uploads/gtou/parent/disney_gtou_20160331_Spanish-TOU.pdf)
- [ConductAtlas: Disney+ / ESPN / Hulu terms excerpt](https://conductatlas.com/platform/disney/disney-terms-of-use/provision/CA-P-022520/prohibition-on-automated-access-and-ai-scraping/)
- [FantasyPros ESPN sync](https://support.fantasypros.com/hc/en-us/articles/360051313453-How-do-I-add-my-ESPN-fantasy-league-to-my-account-)
- [Footballguys ESPN sync issues](https://sportsguys.zendesk.com/hc/en-us/articles/38082296207003-ESPN-Sync-Issues)
- [Cord Cutters News: NFL Fantasy to ESPN](https://cordcuttersnews.com/the-nfl-is-phasing-out-its-fantasy-app-and-handing-fantasy-football-to-espn-heres-what-players-need-to-know/)
