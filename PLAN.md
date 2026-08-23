# Pivot — Build Plan

A spec for building a fantasy-aware NFL viewing app. v1 ships as a fantasy command center that routes users to the right games (via deep-link or TV cast) based on real-time fantasy lineup activity. Architecture is designed to swap into native streaming when partnership deals are landed in Phase 2.

This document is the source of truth for the build. Sections are organized so each can be referenced independently by Cursor when working on a given module.

**Rename (Aug 21, 2026).** Product name changed from Fantasy Focus / FantasyFocus to
**RosterRemote**. Rationale: the original name conflicted with ESPN's "Fantasy Focus"
podcast/show branding; ESPN Fantasy Football becoming the NFL's official fantasy platform
for 2026 raised the profile of that conflict. "RosterRemote" was chosen to reflect the
app's actual function — the user's fantasy roster driving which broadcast to watch —
rather than reusing "Focus," which is what caused the original conflict.

**Code-level rename pass (Aug 21, 2026).** The rename ran as three gated commits after the
documentation pass above: (1) pnpm workspace packages `@fantasy-focus/*` → `@roster-remote/*`
plus the root package, (2) README / RUNBOOK / TRACK-B docs, (3) `app.json` `name` and
`scheme`, the in-app UI strings, and the clean `expo prebuild` the `name` change forces.
Commit 3 is last on purpose: it is the only one that invalidates a working device build.

Device-verified on a physical iPhone after the clean prebuild: the app installs in place
under the unchanged bundle ID and reports as `RosterRemote / com.fantasyfocus.app`, signed
against the existing `iOS Team Provisioning Profile: com.fantasyfocus.app` with
`aps-environment: development` intact — so B1's push credentials survived. The dormant
AirPlay native module re-autolinked and re-linked (verified in the regenerated
`ExpoModulesProvider.swift` and by symbol inspection of the device binary, not assumed —
`requireOptionalNativeModule` would have returned `null` silently on failure). Two
operational gaps this exposed are recorded in RUNBOOK: a clean prebuild discards
`DEVELOPMENT_TEAM`, and a running API dev server must be restarted after a workspace
scope rename.

**Deliberately kept on the old name — do not "fix" these:**

- **Bundle ID `com.fantasyfocus.app`.** Not user-visible (the name under the icon is
  `CFBundleDisplayName`, from `app.json` `name`), and nothing in the repo derives behavior
  from the string — the dispatcher reaches APNs through Expo's push service, so no APNs
  topic is hardcoded anywhere. Changing it would mean a new Apple App ID, new provisioning,
  reassigning the APNs key, and a new APNs device token — staling the `device_tokens` rows
  B1 was verified against, for zero user-visible gain.
- **Expo project slug `fantasy-focus` / `@parkertjones/fantasy-focus`.** The slug is the
  identity EAS resolves against `extra.eas.projectId`, so renaming it requires a matching
  rename on expo.dev — the only remote-state change in the whole rename, against the
  project holding B1's verified push credentials. Deferred until after TestFlight is green.
  Push is unaffected either way: tokens are issued against `projectId`, not the slug.
- **`supabase/config.toml` `project_id = "FantasyFocusApp"`.** That string names the local
  Docker containers. Renaming it makes `supabase start` build a fresh empty stack and orphan
  the current volume — seeded players, the corrected deep-link URLs from the Open Question #2
  audit, the test user, and the verified push token — silently, with no error.
- **`scripts/seed-test-user.ts` defaults** (`test@fantasyfocus.dev`). Env-overridable;
  renaming orphans the existing local auth user for no benefit.
- **The repo directory** `.../projects/fantasyfocus` (the GitHub repo is `roster-remote`).

Still outstanding: the `fantasyfocus.app` support/terms/privacy URLs in Settings — see Open
Question #5, which is a B3 submission blocker independent of the rename. Historical Known
Issues that cite these technical IDs as they existed at the time of the events are left
unchanged on purpose.

Trademark clearance on "Pivot" has **not** been formally done (e.g. USPTO TESS
search or legal counsel). Informal web searches turned up nothing conflicting; that is
not the same as clearance. See Open Question #4.

**Rename (Aug 23, 2026).** Product name changed again, RosterRemote → **Pivot** —
in-app/display branding only: the home-screen name, in-app UI copy, splash/onboarding
text, docs, and comments. Explicitly out of scope for this pass: the future App Store
Connect listing name and trademark clearance/filing — those are a separate, later step,
not part of an in-app display-name change.

Ran as three gated commits, same discipline as Aug 21: (1) `app.json` `name`/`scheme`,
the in-app UI strings, and the pnpm workspace scope `@roster-remote/*` → `@pivot/*` (the
Aug 21 pass's package rename, redone since the brand moved again — confirmed with the
requester before touching it, since the preserved-identifier list as given no longer
matched the repo); (2) docs — this file, README, RUNBOOK, TRACK-B, B3-HANDOFF; (3) a
final grep sweep, confirmation that the four items below are still untouched, and the
`expo prebuild --clean` the `name` change forces. Same four preserved identifiers as the
Aug 21 note above — untouched again this pass.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Strategic Approach](#2-strategic-approach)
3. [Product Specification](#3-product-specification)
4. [v1 Scope](#4-v1-scope)
5. [Tech Stack](#5-tech-stack)
6. [Architecture Overview](#6-architecture-overview)
7. [Data Model](#7-data-model)
8. [Switching Engine Specification](#8-switching-engine-specification)
9. [API Contracts](#9-api-contracts)
10. [UX Specification](#10-ux-specification)
11. [Build Order](#11-build-order)
12. [External Dependencies](#12-external-dependencies)
13. [Open Questions](#13-open-questions)
14. [v1.5 Roadmap](#14-v15-roadmap)
15. [Phase 2 Strategy](#15-phase-2-strategy)
- [Known Issues](#known-issues)

---

## 1. Executive Summary

**Product.** Pivot — a mobile app that monitors live NFL games and the user's fantasy football lineup, then surfaces real-time notifications when their fantasy players become active on the field. The user can switch their viewing (on phone or TV) to the relevant game in one tap.

**Core value proposition.** Stop missing your fantasy plays. The app does what NFL RedZone does (showing you the most important action) but personalized to *your* fantasy team.

**v1 strategy.** Bridge model. Users bring their own streaming subscriptions (Sunday Ticket, ESPN+, Paramount+, etc.); the app routes them via deep-link or controls their TV via AirPlay/Chromecast. No streaming rights required.

**North star.** Native streaming inside the app via partnerships with sportsbooks, NFL+, or major rights holders. The v1 architecture is designed so this swap is additive, not a rebuild.

**Audience.** Engaged fantasy football players in 1–2 leagues. Initial focus: US iOS users.

**Build constraints.** Solo founder using AI-assisted development (Cursor). v1 targets launch for the start of the next NFL season (early September).

---

## 2. Strategic Approach

### The streaming rights problem

NFL streaming rights are fragmented across YouTube/Sunday Ticket, ESPN, CBS, FOX, NBC, Amazon Prime, and NFL Network. No startup acquires these directly. Four viable models exist:

1. **Companion/overlay app** — pure data layer, doesn't touch video.
2. **Aggregator with deep-linking** — routes users into existing apps. ← **v1 shipping mode** (originally scoped as the fallback)
3. **Phone-as-remote** — controls TV streaming via AirPlay/Chromecast. ← **not achievable in v1**, see below
4. **Native streaming via partnership** — Phase 2 destination

**Model 3 does not work without rights, and that is a consequence of this very
section rather than an implementation gap.** AirPlay and Chromecast route video
belonging to *the app doing the casting*. With no owned or licensed rights, v1
has no video of its own, so there is nothing for it to route: iOS offers only an
audio route, and a route selected in our app does not transfer into the separate
streaming app we hand off to. Casting a third-party app's video is that app's
decision, not ours. Verified on hardware in Sprint 10 Track B — see Section 11
Sprint 8 and Known Issues. This makes model 2 the actual v1 mode and moves
"phone-as-remote" from a v1 feature to a Phase 2 unlock that arrives with the
rights, alongside `EmbeddedStreamPlaybackSource`.

### Three-phase roadmap

**Phase 1 (Year 1) — bridge.** Ship v1 with deep-link routing. (Originally scoped as phone-as-remote + deep-link fallback; see the rights constraint above — deep-link is the mode that survives without rights.) Prove the engagement hypothesis.

**Phase 2 (Year 2) — unlock.** Land a partnership with a sportsbook, NFL+, or rights holder. Replace the deep-link/cast layer with native embedded streaming. Engine, lineup logic, notifications, and UI all unchanged.

**Phase 3 (Year 3+) — expand.** Multi-sport, deeper analytics, original content.

### Swap-ready architecture principle

Every external boundary in v1 is hidden behind an interface so Phase 2 swaps are local changes:

- `PlaybackSource` interface — `DeepLinkPlaybackSource` is the only source registered in v1; `AirPlayPlaybackSource` is implemented but dormant and `ChromecastPlaybackSource` stays a stub (see the rights constraint above); `EmbeddedStreamPlaybackSource` added in Phase 2. The boundary still earned its keep: retiring a source turned out to be a one-line registry change.
- `FantasyProvider` interface — `SleeperProvider` and `ManualProvider` in v1; ESPN, Yahoo, NFL Fantasy added later (see Section 14 → Multi-platform fantasy for per-provider integration feasibility).
- `BroadcastResolver` interface — which streaming service is airing a given game.

When new implementations are added, the rest of the codebase doesn't change.

---

## 3. Product Specification

### Target user

Engaged fantasy football player in 1–2 leagues. Watches multiple games on Sundays. Currently juggles between fantasy apps (to check status) and streaming apps (to watch games). Frustrated by missing plays from their fantasy team because they were watching the wrong game.

### Core mechanic — "active player" rule

A game is **flagged** for a user when either condition is true:
- The user has any **offensive starter** (QB, RB, WR, TE, K, FLEX) on the team currently in possession with offense on the field.
- The user has the **defense** of the team currently defending while the opposing offense is on the field.

When a game is flagged, the engine fires a notification with action buttons.

### Notification behavior

**Default mode:** prompt-based switching. User receives a notification with `Switch` and `Dismiss` buttons; tap to switch primary game.

**Auto-switch mode (v1.5):** toggleable preference. Engine automatically switches the primary game when a higher-priority flag fires.

**Stream lag handling:** notifications fire on a delay calibrated to the user's broadcast source (typically 30–90 seconds) so the notification arrives when the play is about to start on their actual stream.

**Rate limiting:** maximum 3 notifications per minute per user. Configurable quiet hours.

### Multi-flag priority

When multiple games are flagged simultaneously, priority score determines the primary:

```
priority = (active_players × 2) 
        + (red_zone_bonus: +3 if possessing team in red zone)
        + (close_game_bonus: +2 if Q4+ and score within 7)
        + (star_player_bonus: +5 per star player active)
```

### Monetization

**v1:** Free tier only. Single-game viewing. No billing infrastructure.

**v1.5:** Subscription tier (target $9.99–14.99/month) unlocks split-screen multi-stream, auto-switch, unlimited leagues, star players, ad-free.

---

## 4. v1 Scope

### In scope

- iOS only (React Native + Expo)
- NFL only
- Email + Apple Sign In auth
- Sleeper API lineup integration
- Manual lineup entry
- One league per user
- Real-time Sportradar play-by-play ingestion
- Switching engine with possession-level flag detection
- Priority scoring with red-zone and close-game bonuses
- Push notifications via Expo Push
- In-app notification banners
- Deep-link routing to streaming services (Sunday Ticket, ESPN+, Paramount+, Peacock, Prime, NFL+, broadcast TV)
- ~~AirPlay control to Apple TV~~ — **cut**, not achievable without video rights (Section 2, Section 11 Sprint 8)
- ~~Chromecast control to Google/Android TV~~ — **cut**, same root cause
- Lineup management screen with live fantasy points
- Settings (notification preferences, quiet hours, app presence)
- Star player flagging (stored, not yet surfaced in switching)
- Stream-lag-aware deferred notification firing
- Dark mode (default)

### Explicitly out of scope for v1

- Multi-stream / split-screen viewing
- Auto-switch primary (toggle stored but disabled)
- Star players in priority scoring (UI exists, engine doesn't use yet)
- Multiple leagues per user
- ESPN, Yahoo, NFL Fantasy, CBS lineup integrations
- Android, web, TV apps
- Stat overlays, projections, advanced analytics
- Social features, league chat
- IDP / individual defensive players
- Special handling for kickers (they inherit team offense)
- Other sports (NBA, MLB, NHL, soccer)
- Sportsbook or DFS integration
- Subscription tier / billing
- Notification batching

---

## 5. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Client | React Native + Expo + TypeScript | Cross-platform, AI-friendly, fast iteration, ships Android in v1.5 |
| Backend | Node.js + Fastify + TypeScript | Same language as client, excellent WebSocket support |
| Database | Supabase (Postgres + Auth) | Managed Postgres + auth + storage + realtime in one service |
| Hot state | Upstash Redis | Serverless Redis, minimal ops, ideal for game state cache |
| Push | Expo Notifications | Wraps APNs (and FCM for v1.5), free tier sufficient |
| Hosting | Fly.io | Strong WebSocket support, global edge presence |
| Data | Sportradar NFL Real-Time API | Sub-second play-by-play push feed |
| Fantasy | Sleeper API | Free, well-documented, no auth ceremony |
| Cast | ~~react-native-google-cast~~ + native AirPlay (local Expo module) | Cast cut in v1 — no video rights (Section 2). `react-native-google-cast` was never added; the AirPlay module exists but is dormant |
| Monitoring | Sentry + Axiom | Errors + structured logs |

---

## 6. Architecture Overview

### Data flow

```
Sportradar push feed
      ↓
[Ingestion Service]  ← writes game state to Redis
      ↓
[Switching Engine]   ← reads game state + user lineup cache, computes flag deltas
      ↓
[Event Dispatcher]   ← deferred firing for stream lag, rate limiting
      ↓
   ┌──────────┬──────────┐
   ↓          ↓          ↓
[WebSocket] [Expo Push] [Postgres flag_events log]
   ↓          ↓
[iOS Client]
   ↓
   ┌─────────────┬───────────────┬──────────────┐
   ↓             ↓               ↓              ↓
[AirPlay]    [Chromecast]    [Deep-link]   [Embedded — Phase 2]
```

### Services

- **Ingestion service** — persistent connection to Sportradar push feed. Writes game state to Redis on every play. Mirrors to `game_state_history` table every 30s.
- **Switching engine** — subscribes to game state changes via Redis pub/sub. Recomputes flag states per user, emits flag events to dispatcher.
- **Event dispatcher** — manages the deferred-firing queue (Redis sorted set). Pops due events, applies rate limiting, delivers via WebSocket and/or Expo Push.
- **API server** — REST endpoints (Fastify). Authenticated via Supabase JWT.
- **Realtime server** — WebSocket connections. Same process as API server in v1 for simplicity.
- **Lineup sync worker** — background job, syncs Sleeper lineups every 5 minutes during active game windows.

### Deployment topology

Single Fly.io app for v1. Three processes: API server (handles REST + WebSocket), ingestion service (1 instance), engine + dispatcher (1 instance). Scales horizontally on stake-based sharding when needed.

---

## 7. Data Model

### Core user entities

#### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email` | text | unique, indexed |
| `preferences` | jsonb | notification mode, quiet hours, auto-switch |
| `subscription_tier` | text | `'free' \| 'pro'`, default `'free'` |
| `expo_push_token` | text | nullable |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

> **Sprint 5 addition:** `preferences` — jsonb, parsed via `preferencesSchema` in `shared/src/types/preferences.ts`. Shape: `{ notificationMode: 'all' | 'high_leverage_only' | 'off', quietHours: { enabled, startHour, endHour, timezone }, autoSwitch: boolean }`. All fields default; existing `'{}'` rows parse to defaults.

#### `user_app_presence`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users, indexed |
| `service` | text | enum (see below) |
| `has_subscription` | boolean | |
| `detected_at` | timestamptz | default `now()` |

`service` enum: `'sunday_ticket' \| 'espn_plus' \| 'paramount_plus' \| 'peacock' \| 'amazon_prime' \| 'nfl_plus' \| 'nfl_network' \| 'fox' \| 'cbs' \| 'nbc' \| 'abc'`

Unique constraint: `(user_id, service)`.

#### `viewing_sessions`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | PK, FK → users |
| `primary_game_id` | uuid | FK → games, nullable |
| `primary_source` | text | `'deeplink' \| 'airplay' \| 'chromecast' \| 'embedded'`, nullable |
| `primary_priority_score` | numeric | nullable |
| `thumbnail_game_ids` | uuid[] | reserved for v1.5 |
| `device_info` | jsonb | device model, OS version, etc. |
| `started_at` | timestamptz | |
| `last_updated_at` | timestamptz | |

One row per user, upserted as session changes.

### Fantasy entities

#### `leagues`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users, indexed |
| `platform` | text | `'sleeper' \| 'manual' \| 'espn' \| 'yahoo' \| 'nfl_fantasy' \| 'cbs'` |
| `external_league_id` | text | nullable (Sleeper league ID, etc.) |
| `external_owner_id` | text | nullable; Sleeper `user_id` of the league owner/roster (Sprint 3 addition — needed to resolve which roster in a Sleeper league belongs to this user) |
| `external_roster_id` | text | nullable; Sleeper numeric roster ID within the league (Sprint 3 addition — needed so subsequent lineup syncs know which roster to fetch) |
| `name` | text | |
| `sport` | text | `'nfl'` for v1 |
| `season_year` | int | |
| `last_synced_at` | timestamptz | nullable |
| `lineup_source` | text | nullable; `'matchup' \| 'roster_fallback'` — which source `GET /leagues/:id/lineup` composes from |
| `fallback_roster` | jsonb | nullable; UUID `player_id[]` when `lineup_source = 'roster_fallback'` (off/pre — not written to `lineup_slots`) |
| `created_at` | timestamptz | |

> **Sprint 3 divergence:** `external_owner_id` and `external_roster_id` were added during Sprint 3 implementation. They weren't in the original spec but are required to map a connected Sleeper account to the correct roster within a league (a league has many rosters; only one belongs to the connecting user). Both are `NULL` for `platform = 'manual'` leagues.

> **Offseason roster fallback:** `lineup_source` / `fallback_roster` store a static roster when `display_phase` is `'off'`/`'pre'` so we never invent week-scoped starter/bench rows in `lineup_slots` before matchups exist. Cleared when sync flips to `'matchup'`.

#### `lineup_slots`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `league_id` | uuid | FK → leagues, indexed |
| `week` | int | |
| `player_id` | uuid | FK → players |
| `slot_type` | text | `'starter' \| 'bench' \| 'flex' \| 'idp'` |
| `position_in_lineup` | text | `'QB' \| 'RB1' \| 'WR2' \| 'FLEX' \| 'DEF'` etc. |
| `is_star` | boolean | default `false` |
| `created_at` | timestamptz | |

Composite index: `(league_id, week)`.

> **Sprint 3 divergence:** added `UNIQUE (league_id, week, player_id)`. The lineup sync worker upserts on this key rather than delete-and-reinsert, so `is_star` (set independently via `POST /leagues/:id/stars`) survives repeated syncs instead of being clobbered every 5 minutes.

### NFL reference entities

#### `teams`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `sportradar_id` | text | unique, indexed |
| `abbreviation` | text | unique, e.g. `'IND'` |
| `name` | text | |
| `city` | text | |
| `conference` | text | `'AFC' \| 'NFC'` |
| `division` | text | |
| `primary_color` | text | hex |
| `secondary_color` | text | hex |

Seeded once. 32 rows.

#### `players`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `sportradar_id` | text | unique, indexed |
| `sleeper_id` | text | unique, indexed, nullable |
| `first_name` | text | |
| `last_name` | text | |
| `position` | text | `'QB' \| 'RB' \| 'WR' \| 'TE' \| 'K' \| 'DEF'` |
| `team_id` | uuid | FK → teams |
| `active` | boolean | default `true` |
| `jersey_number` | int | nullable |

Composite index: `(team_id, position)`.

#### `games`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `sportradar_id` | text | unique, indexed |
| `season_year` | int | |
| `season_type` | text | `'pre' \| 'regular' \| 'post'` — disambiguates week N across phases (Sprint 10 Phase 2.5) |
| `week` | int | indexed |
| `scheduled_start` | timestamptz | indexed |
| `home_team_id` | uuid | FK → teams |
| `away_team_id` | uuid | FK → teams |
| `status` | text | `'scheduled' \| 'in_progress' \| 'final' \| 'postponed'` |
| `venue` | text | nullable |

Composite index: `(season_type, scheduled_start)` — covers opener `MIN(scheduled_start)` queries per phase.

#### `game_broadcasts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `game_id` | uuid | FK → games, indexed |
| `service` | text | same enum as `user_app_presence.service` |
| `deep_link_url` | text | |
| `requires_subscription` | boolean | |

Multiple rows per game (e.g., FOX broadcast + Sunday Ticket simulcast).

### Event entities

#### `flag_events`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `game_id` | uuid | FK → games |
| `event_type` | text | `'flag_added' \| 'flag_removed' \| 'priority_increased' \| 'priority_decreased'` |
| `triggering_play_id` | text | nullable, Sportradar play ID |
| `priority_score` | numeric | |
| `reasons` | jsonb | array of reason objects |
| `fired_at` | timestamptz | |
| `delivered_at` | timestamptz | nullable |
| `user_action` | text | `'switched' \| 'added_to_split' \| 'dismissed' \| 'ignored' \| null` |

Composite index: `(user_id, fired_at DESC)`.

#### `game_state_history`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `game_id` | uuid | FK → games |
| `possession_team_id` | uuid | nullable |
| `unit_on_field` | text | `'offense' \| 'defense' \| 'special_teams' \| 'none'` |
| `score_home` | int | |
| `score_away` | int | |
| `quarter` | int | |
| `time_remaining_sec` | int | |
| `in_red_zone` | boolean | |
| `recorded_at` | timestamptz | |

Snapshot every 30 seconds from Redis. Used for replay/debugging.

### Redis schemas (hot path)

```
game_state:{game_id}              hash → { game_id, home_team_id, away_team_id,
                                            possession_team_id, unit_on_field,
                                            score_home, score_away, quarter,
                                            time_remaining_sec, in_red_zone,
                                            status, updated_at }

user_flagged_games:{user_id}      sorted set → { game_id : priority_score }
                                  (highest score = current primary)

user_flag_state:{user_id}:{game_id} hash → { flagged, priority_score, reasons_json, computed_at }
                                  Change log for diffing; NOT authoritative state.
                                  /flags/current and cold-start MUST recompute fresh, not read this.

user_lineup_cache:{user_id}:{week} hash → { team_id : [position_categories] }
                                  e.g., { "IND": ["offense"], "BAL": ["offense", "defense"] }

users_with_stake:{team_id}        set → user_ids with any player on this team

active_users                      sorted set → { user_id : expiry_ms }
                                  Membership = score >= now; heartbeat scores now + 300_000ms.
                                  Expired members swept lazily.

flag_event_queue                  sorted set → { event_json : fire_at_timestamp }
                                  (deferred firing queue)

user_notifications:{user_id}      sorted set → { event_id : delivered_at_timestamp }
                                  (sliding 60s window for rate limiting)
```

### Required indexes

- `users(email)` unique
- `leagues(user_id)`
- `players(sportradar_id)` unique
- `players(sleeper_id)` unique
- `players(team_id, position)` composite
- `teams(abbreviation)` unique
- `lineup_slots(league_id, week)` composite
- `games(sportradar_id)` unique
- `games(week, scheduled_start)` composite
- `games(season_type, scheduled_start)` composite
- `game_broadcasts(game_id)`
- `flag_events(user_id, fired_at DESC)` composite
- `user_app_presence(user_id, service)` composite unique

---

## 8. Switching Engine Specification

### Overview

The engine is a stateful event processor: Sportradar play events in, flag events out. It maintains game state in Redis, cross-references it against cached user lineups, and emits flag deltas with priority scores. A dispatcher layer defers notifications to align with stream lag and applies rate limiting.

### Core types

```typescript
type UnitOnField = 'offense' | 'defense' | 'special_teams' | 'none';
type FlagReasonType = 
  | 'offense_active' 
  | 'defense_active' 
  | 'red_zone' 
  | 'close_game' 
  | 'star_player_active';

interface GameState {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  possessionTeamId: string | null;
  unitOnField: UnitOnField;
  scoreHome: number;
  scoreAway: number;
  quarter: number;          // 1-5 (5 = OT)
  timeRemainingSec: number;
  inRedZone: boolean;
  status: 'scheduled' | 'in_progress' | 'final';
  updatedAt: number;        // unix ms
}

interface UserLineupCache {
  userId: string;
  week: number;
  teamPositions: Map<string, Set<'offense' | 'defense'>>;
  playerToTeam: Map<string, string>;
  starPlayerIds: Set<string>;
}

interface FlagReason {
  type: FlagReasonType;
  triggeringPlayerIds: string[];
}

interface FlagState {
  gameId: string;
  flagged: boolean;
  priorityScore: number;
  reasons: FlagReason[];
  computedAt: number;
}

interface FlagEvent {
  id: string;
  userId: string;
  gameId: string;
  type: 'flag_added' | 'flag_removed' | 'priority_increased' | 'priority_decreased';
  oldState: FlagState | null;
  newState: FlagState;
  scheduledFireAt: number;
}
```

### Play event handler (entry point)

```typescript
async function onPlayEvent(play: SportradarPlay): Promise<void> {
  // 1. Update game state in Redis
  const oldState = await redis.getGameState(play.gameId);
  const newState = applyPlayToState(oldState, play);
  await redis.setGameState(play.gameId, newState);

  // 2. Filter out non-interesting plays
  if (!isInterestingStateChange(oldState, newState)) {
    return;
  }

  // 3. Find users with stake in this game who are active
  const candidateUsers = await getActiveUsersWithStakeIn(newState);
  
  // 4. Recompute flag state for each candidate user
  await Promise.all(candidateUsers.map(async userId => {
    const lineup = await redis.getLineupCache(userId, currentWeek());
    if (!lineup) return;
    
    const oldFlagState = await redis.getUserFlagState(userId, play.gameId);
    const newFlagState = computeFlagState(lineup, newState);
    
    const event = diffFlagStates(userId, oldFlagState, newFlagState);
    if (!event) return;
    
    await redis.setUserFlagState(userId, play.gameId, newFlagState);
    await scheduleFlagEvent(event, newState);
  }));
}
```

### Interesting state change filter

```typescript
function isInterestingStateChange(old: GameState | null, neu: GameState): boolean {
  if (!old) return true;
  return (
    old.possessionTeamId !== neu.possessionTeamId ||
    old.unitOnField !== neu.unitOnField ||
    old.inRedZone !== neu.inRedZone ||
    old.scoreHome !== neu.scoreHome ||
    old.scoreAway !== neu.scoreAway ||
    old.quarter !== neu.quarter ||
    old.status !== neu.status
  );
}
```

### User candidate selection

```typescript
async function getActiveUsersWithStakeIn(state: GameState): Promise<string[]> {
  const [homeStakes, awayStakes, active] = await Promise.all([
    redis.smembers(`users_with_stake:${state.homeTeamId}`),
    redis.smembers(`users_with_stake:${state.awayTeamId}`),
    redis.smembers(`active_users`),
  ]);
  const stakeholders = new Set([...homeStakes, ...awayStakes]);
  return [...stakeholders].filter(u => active.includes(u));
}
```

### Flag state computation (pure function)

```typescript
function computeFlagState(lineup: UserLineupCache, state: GameState): FlagState {
  const reasons: FlagReason[] = [];
  let priority = 0;

  if (state.status !== 'in_progress' || state.possessionTeamId === null) {
    return { 
      gameId: state.gameId, 
      flagged: false, 
      priorityScore: 0, 
      reasons: [], 
      computedAt: Date.now() 
    };
  }

  const offTeam = state.possessionTeamId;
  const defTeam = offTeam === state.homeTeamId ? state.awayTeamId : state.homeTeamId;

  // Offense rule
  if (state.unitOnField === 'offense' && lineup.teamPositions.get(offTeam)?.has('offense')) {
    const triggers = playerIdsOnTeamWithPosition(lineup, offTeam, 'offense');
    reasons.push({ type: 'offense_active', triggeringPlayerIds: triggers });
    priority += 2 * triggers.length;
  }

  // Defense rule
  if (state.unitOnField === 'offense' && lineup.teamPositions.get(defTeam)?.has('defense')) {
    const triggers = playerIdsOnTeamWithPosition(lineup, defTeam, 'defense');
    reasons.push({ type: 'defense_active', triggeringPlayerIds: triggers });
    priority += 2;
  }

  // Bonuses only apply if game is already flagged
  if (reasons.length > 0) {
    if (state.inRedZone) {
      reasons.push({ type: 'red_zone', triggeringPlayerIds: [] });
      priority += 3;
    }
    if (isCloseLateGame(state)) {
      reasons.push({ type: 'close_game', triggeringPlayerIds: [] });
      priority += 2;
    }
    const activeStars = activeStarsInThisFlag(lineup, reasons);
    if (activeStars.length > 0) {
      reasons.push({ type: 'star_player_active', triggeringPlayerIds: activeStars });
      priority += 5 * activeStars.length;
    }
  }

  return {
    gameId: state.gameId,
    flagged: reasons.length > 0,
    priorityScore: priority,
    reasons,
    computedAt: Date.now(),
  };
}

function isCloseLateGame(s: GameState): boolean {
  return s.quarter >= 4 && Math.abs(s.scoreHome - s.scoreAway) <= 7;
}
```

### Diff to event

```typescript
function diffFlagStates(
  userId: string,
  oldState: FlagState | null,
  newState: FlagState
): FlagEvent | null {
  const wasFlagged = oldState?.flagged ?? false;
  const isFlagged = newState.flagged;
  
  if (!wasFlagged && !isFlagged) return null;
  if (!wasFlagged && isFlagged) return makeEvent(userId, oldState, newState, 'flag_added');
  if (wasFlagged && !isFlagged) return makeEvent(userId, oldState, newState, 'flag_removed');
  
  const delta = newState.priorityScore - (oldState?.priorityScore ?? 0);
  if (delta >= 3) return makeEvent(userId, oldState, newState, 'priority_increased');
  if (delta <= -3) return makeEvent(userId, oldState, newState, 'priority_decreased');
  
  return null;
}
```

### Deferred event scheduling

```typescript
async function scheduleFlagEvent(event: FlagEvent, gameState: GameState): Promise<void> {
  const user = await getUser(event.userId);
  const broadcastSource = await resolveLikelyBroadcastSource(event.gameId, user);
  
  const lagSec = BROADCAST_LAG_SECONDS[broadcastSource] ?? 60;
  event.scheduledFireAt = Date.now() + (lagSec * 1000);
  
  await redis.zadd('flag_event_queue', event.scheduledFireAt, JSON.stringify(event));
}

const BROADCAST_LAG_SECONDS: Record<string, number> = {
  'sunday_ticket': 75,
  'espn_plus': 60,
  'paramount_plus': 50,
  'peacock': 45,
  'amazon_prime': 40,
  'nfl_plus': 60,
  'nfl_network': 20,
  'fox': 8,
  'cbs': 8,
  'nbc': 8,
  'abc': 8,
};
```

### Dispatcher worker

```typescript
async function flagEventDispatcher(): Promise<void> {
  while (true) {
    const now = Date.now();
    const due = await redis.zrangebyscore('flag_event_queue', 0, now, { limit: 100 });
    
    for (const eventJson of due) {
      const event: FlagEvent = JSON.parse(eventJson);
      
      // Re-validate before firing — state may have changed during the wait
      const currentState = await redis.getUserFlagState(event.userId, event.gameId);
      if (!isStillRelevant(event, currentState)) {
        await redis.zrem('flag_event_queue', eventJson);
        continue;
      }
      
      if (await shouldRateLimit(event)) {
        await redis.zrem('flag_event_queue', eventJson);
        continue;
      }
      
      await deliverFlagEvent(event);
      await redis.zrem('flag_event_queue', eventJson);
    }
    
    await sleep(500);
  }
}
```

### Rate limiting

```typescript
async function shouldRateLimit(event: FlagEvent): Promise<boolean> {
  const recentCount = await redis.zcount(
    `user_notifications:${event.userId}`,
    Date.now() - 60_000,
    Date.now()
  );
  
  if (recentCount >= 3) return true;
  
  const prefs = await getUserPrefs(event.userId);
  if (isInQuietHours(prefs)) return true;
  
  if (prefs.notificationMode === 'high_leverage_only') {
    const isHighLeverage = event.newState.reasons.some(
      r => r.type === 'red_zone' || 
           r.type === 'star_player_active' || 
           r.type === 'close_game'
    );
    if (!isHighLeverage) return true;
  }
  
  return false;
}
```

### Delivery & action decision

```typescript
async function deliverFlagEvent(event: FlagEvent): Promise<void> {
  const user = await getUser(event.userId);
  const game = await getGame(event.gameId);
  const session = await getViewingSession(user.userId);
  
  const action = decideAction(user, session, event);
  
  await persistFlagEvent({ ...event, deliveredAt: Date.now(), action });
  
  await Promise.all([
    realtime.publish(`user:${user.userId}`, { type: 'flag_event', event, action }),
    user.expoPushToken && expoPush.send({
      to: user.expoPushToken,
      title: notificationTitle(event, game),
      body: notificationBody(event, game),
      data: { eventId: event.id, gameId: event.gameId, action },
    }),
  ]);
}

function decideAction(user: User, session: ViewingSession, event: FlagEvent): Action {
  const currentPrimaryPriority = session.primaryGameId === event.gameId
    ? Infinity
    : (session.primaryPriorityScore ?? 0);
  
  if (event.type === 'flag_removed') {
    return { type: 'notify_only', cta: 'dismiss' };
  }
  
  if (currentPrimaryPriority === Infinity) {
    return { type: 'in_app_indicator', cta: null };
  }
  
  if (event.newState.priorityScore > currentPrimaryPriority) {
    if (user.preferences.autoSwitch) {
      return { type: 'auto_switch', cta: null };
    }
    return { type: 'prompt', cta: 'switch_primary' };
  }
  
  if (user.subscriptionTier === 'pro') {
    return { type: 'prompt', cta: 'add_to_split' };
  }
  return { type: 'prompt_low_priority', cta: 'switch_primary' };
}
```

### Cold start resolver

```typescript
async function resolveColdStartView(userId: string): Promise<ColdStartView> {
  const lineup = await redis.getLineupCache(userId, currentWeek());
  if (!lineup) {
    return { state: 'no_lineup', primary: null, secondary: [] };
  }
  
  const liveGames = await redis.getLiveGames();
  const flagStates = await Promise.all(
    liveGames.map(g => computeFlagState(lineup, g))
  );
  
  const flagged = flagStates
    .filter(f => f.flagged)
    .sort((a, b) => b.priorityScore - a.priorityScore);
  
  if (flagged.length === 0) {
    return resolveUpcomingView(lineup, liveGames);
  }
  
  return {
    state: 'active',
    primary: flagged[0],
    secondary: flagged.slice(1, 3),
  };
}
```

### Edge cases

- **Special teams plays.** v1 treats `'special_teams'` as not triggering flags. Kickers inherit team offense flag.
- **Overtime.** Quarter 5 always triggers `close_game` bonus regardless of score margin. `isCloseLateGame` should be extended.
- **User has players on both teams.** Both offense and defense reasons can be active simultaneously. Priority scores accumulate.
- **Lineup changes mid-game.** On `lineup_slots` update, invalidate `user_lineup_cache:{user_id}:{week}` and `users_with_stake:*` indexes. Schedule a recomputation.
- **Sportradar feed disconnect.** Mark game states older than 90s as stale. Engine stops flagging from stale state. Reconnect re-syncs.
- **Game ends.** On `status → 'final'`, fire `flag_removed` for every user flagged on this game.

---

## 9. API Contracts

### Conventions

- **Base URL:** `https://api.{domain}.com/v1`
- **Auth:** `Authorization: Bearer <supabase_jwt>` on every authenticated request
- **Error format:** `{ error: { code, message, details? } }`
- **Idempotency:** Optional `Idempotency-Key` header for mutations, cached 24h
- **Pagination:** Cursor-based: `{ data: [...], next_cursor: string | null }`

### REST endpoints

#### Auth & user

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/me` | Get current user + preferences |
| `PATCH` | `/me/preferences` | Update notification mode, quiet hours, etc. |
| `POST` | `/me/push-token` | Register/update Expo push token |
| `DELETE` | `/me/push-token` | Unregister push token |
| `POST` | `/me/app-presence` | Set which streaming services user has |
| `DELETE` | `/me` | Account deletion |

**`POST /me/app-presence` body:**
```typescript
{
  services: Array<{ service: string, has_subscription: boolean }>
}
```

#### Leagues & lineups

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/sleeper/leagues?username={u}` | Fetch Sleeper user's leagues (no persist) |
| `GET` | `/leagues` | List user's leagues |
| `POST` | `/leagues/sleeper` | Connect Sleeper league |
| `POST` | `/leagues/manual` | Create manual league |
| `DELETE` | `/leagues/:id` | Delete league |
| `PATCH` | `/leagues/:id` | Rename manual league (`{ name }`; `manual_league_only` for Sleeper) |
| `POST` | `/leagues/:id/sync` | Force refresh from Sleeper |
| `GET` | `/leagues/:id/lineup?week={w}` | Get lineup for week |
| `PUT` | `/leagues/:id/lineup` | Replace lineup for week |
| `GET` | `/players/search?q={q}&position={p}` | Player autocomplete via `search_players` RPC (word-prefix AND across tokens; team city/name/abbrev only on `DEF` rows) |
| `POST` | `/leagues/:id/stars` | Set star players |

**`GET /leagues/:id/lineup` response:**
```typescript
{
  league_id: string,
  week: number,
  last_synced_at: string | null,
  lineup_source: 'matchup' | 'roster_fallback' | null, // null for never-synced / manual with no source tag
  regular_season_start: string | null,                 // date-only YYYY-MM-DD (ET); for fallback copy
  slots: Array<{
    slot_id: string,           // lineup_slots.id for matchup; player_id for roster_fallback (no slot row)
    slot_type: 'starter' | 'bench' | 'flex' | 'idp', // roster_fallback: all 'starter' (startable, no bench signal)
    position_in_lineup: string,
    player: {
      player_id: string,
      first_name: string,
      last_name: string,
      position: string,
      team: { team_id: string, abbreviation: string, name: string }
    },
    is_star: boolean           // always false for roster_fallback (stars live on lineup_slots)
  }>
}
```

#### Games & state

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/state/nfl` | Current NFL calendar (season / week / season_type) |
| `GET` | `/games?week={w}` | This week's schedule with broadcasts |
| `GET` | `/games/:id` | One game with current state |
| `GET` | `/games/live` | All games in progress |
| `GET` | `/games/:id/broadcasts` | Broadcast sources filtered by user's app presence |

**`GET /state/nfl` response (Sprint 10):**
```typescript
{
  season: string,                              // e.g. "2026"
  week: number,                                // 0 when season_type is 'off' (and often 'pre')
  season_type: 'off' | 'pre' | 'regular' | 'post', // Sleeper — NOT for Home display phase
  season_start_date: string | null,            // Sleeper passthrough — UNTRUSTWORTHY FOR DISPLAY
  preseason_start: string | null,              // date-only YYYY-MM-DD (America/New_York) from games
  regular_season_start: string | null,         // date-only YYYY-MM-DD (America/New_York) from games
  display_phase: 'off' | 'pre' | 'regular' | 'post'  // schedule-derived; Home keys off this
}
```

League/NFL-scoped calendar metadata for Home's state machine (especially State 4a). Deliberately
separate from the `/games` endpoints so Home can short-circuit in the offseason without a games
fetch. Sleeper fields via `getCurrentNflState` (`current_nfl_state`); phase openers derived as
`MIN(scheduled_start)` per `games.season_type`, calendar day in **America/New_York** (not UTC).
`display_phase` compares ET "today" to those openers (falls back to `season_type` if either opener
is null). Home keys off `display_phase`, not `season_type`. No `postseason_start` — postseason is
not seeded in v1. Home supplies `week` from this response into `GET /games?week=`.

**`GET /games?week={w}` response (Sprint 10):**
```typescript
{
  week: number,                                // echoed from the required query param
  games: Array<{
    game_id: string,
    status: 'scheduled' | 'in_progress' | 'final' | 'postponed',
    scheduled_start: string,                   // ISO timestamptz
    home_team: string,                         // abbreviation
    away_team: string,
    home_team_name: string,
    away_team_name: string,
    home_team_primary_color: string,           // "" if missing — same convention as game_summary
    home_team_secondary_color: string,
    away_team_primary_color: string,
    away_team_secondary_color: string,
    broadcasts: Array<{                        // same entry shape as GET /games/:id/broadcasts
      service: string,
      deep_link_url: string,
      requires_subscription: boolean,
      user_has_subscription: boolean,
      typical_lag_seconds: number,
      preferred: boolean
    }>
  }>
}
```

`week` is required; Home supplies it from `GET /state/nfl`. Schedule catalog only — no live
score/clock (those live on `GET /games/live`). Broadcasts are ranked via eligibility-first
`rankBroadcasts` (Section 2 `BroadcastResolver`), with **one** `user_app_presence` load reused
across the whole slate — not `pickBroadcastSource` (timing / lag-only among subscribed services).

**`GET /games/live` response (Sprint 10):**
```typescript
{
  games: Array<{
    game_id: string,
    status: 'in_progress',
    scheduled_start: string,
    home_team: string,
    away_team: string,
    home_team_name: string,
    away_team_name: string,
    home_team_primary_color: string,
    home_team_secondary_color: string,
    away_team_primary_color: string,
    away_team_secondary_color: string,
    score: { home: number, away: number },
    quarter: number,
    time_remaining_sec: number,
    possession_team: string | null             // abbreviation; null if none — same idea as flag_event
  }>
}
```

DB rows with `status = 'in_progress'` hydrated from Redis `game_state`. **Omit** (do not degrade to
zeros) any in-progress row with no Redis live-state — a wrong score claim is worse than absence in a
spoiler-safe app. No `broadcasts` list (use `GET /games/:id/broadcasts` when switching). No
`season_type` — that lives on `GET /state/nfl`.

**`GET /games/:id/broadcasts` response:**
```typescript
{
  game_id: string,
  broadcasts: Array<{
    service: string,
    deep_link_url: string,
    requires_subscription: boolean,
    user_has_subscription: boolean,
    typical_lag_seconds: number,
    preferred: boolean
  }>
}
```

#### Viewing session

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/session` | Current viewing session |
| `PUT` | `/session/primary` | Set primary game |
| `DELETE` | `/session/primary` | Clear primary |
| `POST` | `/session/start` | Begin session (app foreground) |
| `POST` | `/session/heartbeat` | Keep-alive every 30s |

**`PUT /session/primary` body:**
```typescript
{
  game_id: string,
  source: 'deeplink' | 'airplay' | 'chromecast'
}
```

#### Flag events

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/flags/current` | Currently flagged games ordered by priority |
| `POST` | `/flags/:event_id/action` | Record user's response to notification |
| `GET` | `/flags/history?since={ts}` | Recent flag events |

**`GET /flags/current` response:**
```typescript
{
  flags: Array<{
    game_id: string,
    priority_score: number,
    reasons: string[],
    // Sprint 9 Phase 1: full player objects, not just ids — same shape as the WebSocket flag_event
    // payload's flagged_players (below), so the client renders identically from either channel.
    // Populated via a batch `players` lookup over the flag's deduplicated triggeringPlayerIds.
    flagged_players: Array<{
      player_id: string,
      first_name: string,
      last_name: string,
      position: string
    }>,
    game: { /* abbreviated game_summary shape — see WebSocket flag_event payload below */ },
    recommended_action: 'switch_primary' | 'add_to_split' | 'notify_only'
  }>,
  generated_at: string
}
```

**`POST /flags/:event_id/action` body:**
```typescript
{
  action: 'switched' | 'added_to_split' | 'dismissed' | 'ignored'
}
```

**`POST /flags/:event_id/action` response (200):**
```typescript
{
  event_id: string,
  user_action: 'switched' | 'added_to_split' | 'dismissed' | 'ignored'
}
```

Auth required, same as every endpoint in this section. Ownership is enforced server-side via a
manual `user_id` check against the authenticated caller (service-role Supabase client + explicit
check in the route handler, not an RLS policy) — the same service-role-plus-check pattern used by
`POST /me/push-token` and the league-ownership routes (`/leagues/:id/*`).

### WebSocket protocol

**Connection:** `wss://api.{domain}.com/v1/realtime?token=<jwt>`

**Message envelope (both directions):**
```typescript
{
  id: string,
  type: string,
  timestamp: number,
  payload: object
}
```

#### Server → client

| Type | Payload | When |
|---|---|---|
| `flag_event` | `{ user_id, game_id, event_type, old_state, new_state, action, game_summary, flagged_players }` | Engine dispatcher fires after deferral |
| `game_state_update` | `{ game_state }` | State change for subscribed game, throttled 1/2s |
| `lineup_synced` | `{ league_id, week, slot_count }` | After background Sleeper sync |
| `session_invalidated` | `{ reason }` | Session changed elsewhere |
| `pong` | `{}` | Reply to client ping |
| `error` | `{ code, message }` | Recoverable error |

#### Client → server

| Type | Payload | Purpose |
|---|---|---|
| `ping` | `{}` | Every 25s; client reconnects if no pong within 10s |
| `subscribe_game` | `{ game_id }` | Subscribe to state updates for this game |
| `unsubscribe_game` | `{ game_id }` | Stop receiving state updates |

**Full `flag_event` payload shape:**
```typescript
{
  id: string,
  type: 'flag_event',
  timestamp: number,
  payload: {
    event_id: string,
    user_id: string,
    game_id: string,
    event_type: 'flag_added' | 'flag_removed' | 'priority_increased' | 'priority_decreased',
    // Sprint 9 Phase 1: both carry `possession_team` — the team abbreviation with the ball, or null
    // — layered onto the frozen Section 8 FlagState shape at the envelope level (NOT a FlagState
    // field itself; services/engine and Section 8 are untouched). new_state.possession_team is
    // resolved from the CURRENT GameState the dispatcher already reads (possessionTeamId -> the
    // matching team's abbreviation; null with no possession — special teams/between plays/kickoff,
    // or no live GameState). old_state.possession_team is UNCONDITIONALLY null, by deliberate
    // choice, not a gap: the dispatcher has no historical GameState as of when old_state was
    // actually computed, and populating it from the same current snapshot used for new_state would
    // make old_state.possession_team == new_state.possession_team on every event — a structured
    // field the client renders/compares against directly silently lying about "possession before"
    // vs. "possession now" being distinct facts. Do not backfill old_state.possession_team with a
    // best-effort current value without revisiting this ruling.
    old_state: (FlagState & { possession_team: string | null }) | null,
    new_state: FlagState & { possession_team: string | null },
    action: {
      type: 'prompt' | 'auto_switch' | 'in_app_indicator' | 'notify_only' | 'prompt_low_priority',
      cta: 'switch_primary' | 'add_to_split' | 'dismiss' | null,
      recommended_source: string,
      deep_link_url: string
    },
    game_summary: {
      home_team: string,
      away_team: string,
      home_team_name: string,
      away_team_name: string,
      // Sprint 9 Phase 1: teams.primary_color/secondary_color (Section 7, NOT NULL hex), closing the
      // "team color flash not implemented" Known Issue (Section 13). Empty string, not null, when
      // the game catalog has no entry — matches this shape's existing name/abbreviation fallback.
      home_team_primary_color: string,
      home_team_secondary_color: string,
      away_team_primary_color: string,
      away_team_secondary_color: string,
      score: { home: number, away: number },
      quarter: number,
      time_remaining_sec: number
    },
    flagged_players: Array<{
      player_id: string,
      first_name: string,
      last_name: string,
      position: string
    }>
  }
}
```

### Key design notes

- `/flags/current` is the cold-start endpoint, not the streaming one. Use the WebSocket for deltas.
- `/session/heartbeat` updates Redis `active_users`. WebSocket `ping` keeps socket alive. Separate concerns.
- Broadcast resolution lives server-side; client just renders the recommendation.
- No GraphQL — REST + WebSocket is simpler and AI-friendlier.

---

## 10. UX Specification

### Navigation

Three-tab bottom navigation (spec):
1. **Home** — live games dashboard (opens here on launch)
2. **Lineup** — fantasy team and live points
3. **Settings** — preferences, leagues, account

**Shipped Expo Router screens** (`app/app/(app)/`, headerless stack; Settings is modal):
- `index` — Home
- `settings` — Settings (modal)
- `connect-team` — Connect Sleeper / Add manually (create). Manual create uses shared `PlayerPicker` (`app/components/PlayerPicker.tsx`) after `POST /leagues/manual`.
- `edit-manual-lineup?leagueId=` — Edit lineup for an existing `platform: 'manual'` league (Settings entry). Same shared `PlayerPicker`, pre-filled from `GET /leagues/:id/lineup`; saves via `PUT /leagues/:id/lineup`. Not the create flow — does not `POST /leagues/manual`.
- `onboarding-streaming`, `notifications-permission`, `onboarding-all-set` — post-connect onboarding chain

`PlayerPicker` is create+edit shared, not create-only.

### Onboarding (6 screens, ~2 min total)

**1. Welcome.** Value prop sentence + "Get started" button.

**2. Sign up / sign in.** Email + password + Sign in with Apple.

**3. Connect fantasy team.** Two options:
- *Connect Sleeper* — username input → league picker → persist
- *Add manually* — name league → `PlayerPicker` (shared with Settings edit-lineup) → `PUT` lineup

**4. Streaming services.** Multi-select grid of services (Sunday Ticket, ESPN+, Paramount+, Peacock, Prime, NFL+, broadcast TV). Writes to `user_app_presence`.

**5. Notifications.** Pre-permission screen explaining why before triggering iOS prompt.

**6. All set.** Confirmation with CTA to today's games or weekly schedule.

### Home screen — five states

#### State 1: Active games with flags (Sunday afternoon)

Top to bottom:

- **"Now active" card** (large, dominant): teams + score, game state strip, possession indicator, reason chip ("Jonathan Taylor active — RB — Colts offense"), primary CTA button ("Watch on Sunday Ticket" — the "Cast to Apple TV" variant is cut in v1, see Section 2), secondary "Or use..." link
- **"Also flagged" row**: horizontal scroll of smaller cards for other flagged games, each with a "Switch" button
- **"Other live games"**: list of live games with user stake but no current flag
- **"Today's other games"** (collapsible): rest of the slate

#### State 2: Live games, no flags right now

- Top hero: "Possession changing — your next flag is incoming"
- Below: user's stake games with live scores
- Auto-updates via WebSocket when next flag fires

#### State 3: Pre-game (Sunday morning, Thursday afternoon)

- Top: "First flag in 2h 14m" countdown
- Below: user's lineup grouped by game, sorted by kickoff
- Subtle "Test notifications" link

#### State 4: Off-day (Tue–Thu morning)

- Top: this week's matchup preview
- Mid: "Next game: Thursday 8:20pm ET — your players in it: 2"
- Bottom: optional content area (v2)

##### State 4a: Offseason / preseason idle (three-way `display_phase` branch).
Home branches on `GET /state/nfl`'s `display_phase` (schedule-derived) — **not** Sleeper
`season_type` (which runs ahead of actual games). Do **not** collapse `'pre'` into `'off'`:

- `'off'` → Offseason panel: "Preseason begins {preseason_start}" when `preseason_start` is present;
  otherwise date-free fallback. Connected-league status. No sync-on-renewal promise.
- `'pre'` → Preseason panel (same structure, distinct copy): "Regular season begins
  {regular_season_start}" when present; otherwise date-free fallback. Idle-by-design in v1 (no
  fantasy preseason lineup / betting — Section 14). Distinct from `'off'` so a future stake source
  can promote `'pre'` into the live machine without a Home rewrite.
- `'regular'` | `'post'` → live state machine (States 1–4).

Opener dates are schedule-derived (`preseason_start` / `regular_season_start` on `/state/nfl`),
formatted timezone-safely from date-only strings. Never render Sleeper's `season_start_date`.
For `'off'`/`'pre'`, Home short-circuits — skips `/games` and `/flags/current`.


#### State 5: No setup yet

- Centered prompt: "Connect your fantasy team to get started"
- Two buttons: "Connect Sleeper" / "Add manually"

### Lineup screen

- **Top:** league selector (static label in v1, dropdown in v1.5)
- **Body:** lineup grouped by position
  - Player name + team + opponent
  - Live fantasy points
  - Game state indicator (team color dot + offense/defense icon)
  - Star toggle (small star icon, tappable)
- **Pull-to-refresh** triggers Sleeper sync
- **Tap player** opens detail sheet with recent game logs

### Settings screen

iOS grouped list:

- **Account** — email, sign out, delete account
- **Notifications** — master toggle, mode picker, quiet hours, auto-switch toggle (disabled "Coming soon" in v1)
- **Streaming services** — re-edit `user_app_presence`
- **Leagues** — list of connected leagues with refresh/rename/disconnect
- **Star players** — grid view with toggles
- **About** — version, terms, privacy, support, feedback

### Notification UX

**Push notification format:**
- Title: `Jonathan Taylor active`
- Body: `Colts have the ball — Q2, 7:14. Tap to watch.`
- Action buttons: `Switch` and `Dismiss`
- Tap → opens app to "ready to launch" state
- `Switch` quick-action skips app, triggers deep-link/cast directly from notification handler

**In-app banner (foregrounded):**
- Slides down from top
- Same content as push
- Auto-dismisses after 12s if no action (records `ignored`)
- Tap outside actions → dismiss (records `dismissed`)
- Medium haptic on appearance

**Sound:** distinctive short notification sound (stadium horn style), respects iOS mute.

**Switching transition:** brief (under 1s) overlay "Switching to Colts game..." with team color flash, then trigger deep-link or cast.

### Empty / loading / error states

**Empty:**
- Lineup with no players: "Add your starting lineup"
- Home with no leagues: see State 5
- Star list when none set: "Tap any player to mark them as a star"

**Loading:**
- Cold start: splash with "Pulling up today's games..." (max 1.5s before partial render)
- Pull-to-refresh: standard iOS animation
- Deep-link in flight: "Switching to..." overlay
- WebSocket reconnecting: 2px colored bar at top of Home with "Reconnecting..." text

**Error:**
- No internet: persistent top banner with retry, cached lineup visible
- Sleeper sync failed: inline message with retry, last lineup preserved
- Deep-link target not installed: sheet with alternate broadcast or "Get [app]" App Store link
- ~~Cast target unreachable: "Couldn't reach your Apple TV..." with retry~~ — moot in v1, no cast flow (Section 2)
- Sportradar feed stale: grey indicator on game card + "Live data delayed"
- Catastrophic backend: maintenance screen with "Try again"

### Interaction patterns

- **Haptics on state changes** — medium impact on flag arrival, success on switch confirmed, warning on error
- **Animations are purposeful** — banner slides, flag cards scale-in, score number-roll on changes
- **Real-time updates everywhere** — live scores, possession, fantasy points all update via WebSocket
- **Optimistic UI** — update before network confirms; roll back on failure
- **Dark mode default** — sports viewing is often in dim rooms

---

## 11. Build Order

Nine sprints, each ~2–3 weeks for a solo dev with AI assistance. Total target: 4–6 months. Launch target: early September (start of NFL season).

### Sprint 1: Skeleton
- Initialize Supabase project, set up auth
- Create core data model migrations (users, teams, players, games)
- Initialize Expo client, scaffold home screen
- Sign-in flow working end-to-end
- Goal: empty app you can log into

### Sprint 2: Data ingestion in isolation
- Stand up ingestion service
- Connect to Sportradar sandbox feed
- Implement `applyPlayToState` and Redis game state writer
- Add structured logging
- Goal: backend logs possession changes in real time from a recorded game

### Sprint 3: Fantasy lineup ingestion
- Sleeper API client + persistence
- Manual lineup entry endpoint and validation
- Player search endpoint
- Lineup sync worker (every 5 min during games)
- Goal: lineups in DB, materialized to `user_lineup_cache` in Redis

### Sprint 4: The switching engine
- Implement `computeFlagState` as pure function with unit tests
- Implement `onPlayEvent`, `getActiveUsersWithStakeIn`, `diffFlagStates`
- Implement priority scoring with all bonuses
- Test against recorded game data + test lineups
- Goal: engine fires correct flag events for known scenarios

### Sprint 5: Realtime delivery
- Build event dispatcher with deferred firing queue
- Implement WebSocket server (Fastify + websockets plugin)
- Build client WebSocket connection with auto-reconnect
- Minimal client debug screen showing incoming events
- Goal: events stream from engine to client

### Sprint 6: Notifications
- Expo Push integration on backend
- Push token registration + storage
- iOS notification handling (foreground + background)
- In-app notification banner component
- Rate limiting + quiet hours
- Goal: real notifications surface to user

### Sprint 7: Playback abstraction + deep-link
Shipped:
- `PlaybackSource` interface + `DeepLinkPlaybackSource` (`app/playback/`); `AirPlayPlaybackSource`/`ChromecastPlaybackSource` ship as `canPlay: false` stubs (real implementations are Sprint 8), and the `'embedded'` id is carried ahead of Phase 2
- `resolvePlaybackSource` registry (pure) + the `resolveSwitch` client helper (`app/lib/switching.ts`)
- `BroadcastResolver` server-side logic — `rankBroadcasts`/`resolveBroadcasts` (`services/dispatcher/src/broadcastResolver.ts`), kept independent of the lag-timing `pickBroadcastSource` and sharing only the `lagSecondsFor` primitive
- `GET /games/:id/broadcasts` endpoint (Section 9), powered by `rankBroadcasts`
- `delivery.ts` populates `action.recommended_source`/`action.deep_link_url` on the `flag_event` payload, kept lag-consistent with the dispatcher's timing source (falls back to the ranker's `preferred` only when there is no timing source)
- `scripts/seed-broadcasts.ts` fixture seeder for `game_broadcasts` — ⚠️ deep-link URLs are UNVERIFIED placeholders (Open Question #2 audit still pending)
- Home State 1 "Now active" card + "Watch on {service}" CTA; Switch (in-app banner + Home CTA) → `resolvePlaybackSource` → deep link, with the sub-1s "Switching to…" overlay and a deep-link error state, and a best-effort `PUT /session/primary` so the dispatcher's `decideAction` treats the switched game as primary (closes the Sprint 6 loop)
- Goal met: tapping "Switch" opens the correct streaming app at the correct game via deep link (cast handoff is Sprint 8)

Deferred:
- Real AirPlay/Chromecast sources → Sprint 8
- Section 10 fidelity gaps (reason-chip player names, team-color flash, possessing-team overlay label, alternate-broadcast/"Get app" error sheet, live Home WebSocket updates) → Sprint 9 polish (see Known Issues)

### Sprint 8: AirPlay + Chromecast sources — NOT ACHIEVABLE AS SCOPED (Sprint 10 Track B)

Every bullet below assumed v1 could cast video it does not own. It cannot — the
root cause is Section 2's rights constraint, not a missing implementation. See
Known Issues for the hardware verification.

- ~~`AirPlayPlaybackSource` via native iOS APIs~~ → **built, then made dormant.** The native module (`app/modules/airplay-route/`, `AVRouteDetector` + `AVRoutePickerView`) and the source both work and are tested; the source is deliberately left out of `createPlaybackSources()` rather than deleted, so it becomes useful the moment Phase 2 rights land.
- ~~`ChromecastPlaybackSource` via react-native-google-cast~~ → **not built.** Same wall, so the `canPlay: false` stub stays and `react-native-google-cast` is not added as a dependency. No point proving the same constraint twice.
- ~~Cast target detection on app launch~~ → works (this part was never the problem — a Mac AirPlay receiver was detected reliably on device).
- ~~"Cast to TV" CTA on Home when target detected~~ → **not shipped.** The CTA would have been dishonest copy: the picker offers only an audio route, and nothing about that route follows the user into the streaming app.
- ~~Goal: phone-as-remote experience works~~ → **goal retired for v1.** Phase 2 destination; see Section 14 for the Screen Mirroring reframe, which is a different product idea rather than this one rescheduled.

### Sprint 9: Polish & shipping
Shipped:
- Server-side enrichment closing three Section 10 fidelity gaps (Section 9): `flagged_players` (full `{ player_id, first_name, last_name, position }` objects, replacing `flagged_player_ids`) on `GET /flags/current`; team colors (`home_team_primary_color`/`home_team_secondary_color`/`away_team_primary_color`/`away_team_secondary_color`) on `game_summary`, in both `GET /flags/current` and the `flag_event` payload; `possession_team` on the `flag_event` payload's `new_state` (`old_state.possession_team` is unconditionally `null` by design — see Section 9)
- The four Section 10 fidelity fixes consuming the above: reason chip with player names (`app/lib/teamDisplay.ts`'s `reasonChipCopy`), the switching-transition team-color flash, the possessing-team overlay label, and a deep-link error state with an alternate-broadcast picker + "Get app" App Store links (see Known Issues for the multi-player reason chip copy convention this needed and didn't have a spec to follow)
- `GET /me`, `PATCH /me/preferences`, `POST /me/app-presence`, `DELETE /me` — not originally scoped as Phase 2 "client-side" work, added as necessary infrastructure once Settings/onboarding needed them
- Home State 5 (no connected league) and a consolidated idle state standing in for States 2–4 (see Known Issues — States 2–4 need a schedule endpoint that doesn't exist yet)
- Settings screen: account, notifications (mode + quiet hours), streaming services, leagues, star players, about
- Onboarding polish: Welcome screen, streaming-services step, all-set step, wired into sign-up and the `connect-team` flow
- Star player UI, data layer only — real toggle wired to `POST /leagues/:id/stars`, flat list rather than Section 10's grid view (see Known Issues)
- Empty/loading/error state pass across the app (`EmptyState`/`LoadingState`/`ErrorState` shared components)
- Infra hygiene: `pnpm seed:test-user` fixture script, and the `services/dispatcher` → `services/api` `dist/` source-mode fix (TypeScript project references + `tsc -b` — see Known Issues, resolved)

Deferred:
- Home States 2–4 (live score/countdown) plus the State 4a offseason variant → Sprint 10, alongside `GET /state/nfl`, schedule endpoints (`GET /games?week=`/`GET /games/live`), and the Home WebSocket subscription work
- Star player grid view → a later sprint, alongside making star players functional in the switching engine's priority scoring (both currently stored/toggleable but not yet visually or functionally "real")
- Real-world Sunday preseason testing and App Store submission → Sprint 10, pending Apple Developer Program enrollment

---

## 12. External Dependencies

### Procurement required before launch

1. **Sportradar NFL Real-Time API contract**
   - Largest cost line item, estimate $3K–25K+/month depending on tier
   - Push feed (not polling) required for sub-second latency
   - Start procurement immediately

2. **Apple Developer account** — $99/year, instant

3. **Streaming service deep-link audit**
   - Confirm deep-link schemes for each: Sunday Ticket (YouTube TV), ESPN+, Paramount+, Peacock, Prime Video, NFL+, NBC Sports, FOX, CBS
   - Some will support game-level deep links; some only app-level
   - Build for graceful degradation when deep-link fails

### Managed services (sign-up needed)

| Service | Purpose | Cost estimate |
|---|---|---|
| Supabase | DB + auth + storage | $25/mo Pro tier |
| Upstash Redis | Hot state | $0–10/mo low volume |
| Fly.io | Backend hosting | $20–50/mo |
| Expo / EAS | Build + push | $99/mo Production tier |
| Sentry | Error monitoring | Free tier |
| Axiom | Logs | Free tier |

Total managed services: ~$150/mo. Sportradar dominates the budget.

### Free / no-cost integrations

- Sleeper API (free, public)
- Apple Sign In, Apple Push (covered by Developer account)
- iOS AirPlay APIs (native)

---

## 13. Open Questions

Issues that need resolution but don't block the build:

1. **Sportradar pricing tier.** Final contract determines real cost structure.
2. **Deep-link availability per service.** Partly answered in Sprint 10 Track B; the remaining
   unknown is narrower and different in kind from what this question originally assumed. Two
   sub-questions, and conflating them is what let broken links ship for three sprints:

   **(a) Will a URL open the provider's app at all?** Audited for all 11 services against their live
   `apple-app-site-association` files, matching production app IDs only (dev/QA builds claim paths the
   shipping app does not). Nine work; `cbs` and `nbc` serve no usable AASA and can never open an app
   (see Known Issues). Cheap to re-check — one `curl` per domain — and worth re-running periodically,
   since providers change these files without notice.

   **(b) Can we deep-link to a specific game, not just the app?** For YouTube TV: **yes, and it works
   well** — verified on a physical iPhone in Track B. `https://tv.youtube.com/watch/<videoId>` opened
   the YouTube TV app directly into the live game, already playing. The hand-off mechanism is not the
   obstacle; it is genuinely excellent, and it means the deep-link mode this product actually ships
   (see Section 2) has a strong best case rather than a compromised one.

   The obstacle is purely **content-ID acquisition**. That `videoId` is an opaque 11-character
   YouTube identifier, unique per broadcast, and is not derivable from a matchup, team, date, or
   anything else in our schema. Getting it requires a provider-side source — a partner API, an
   authenticated listing endpoint, or scraping — per service, and scraping in particular is fragile
   and legally uncertain. Until then `game_broadcasts.deep_link_url` stays app-level, which lands the
   user in the right app on a generic screen and leaves them to find the game.

   So the real open question is no longer "is game-level deep linking possible?" but "how do we
   obtain per-broadcast content IDs at scale, per provider?" — a data-sourcing and possibly
   partnership problem, not a client-engineering one. Section 15's partnership work is the most
   plausible unlock; it would also make this moot for any partner whose video we embed directly.
3. **v1.5 subscription price point.** Suggested range $9.99–14.99/month, defer to market research.
4. **Pivot trademark clearance.** Informal web searches turned up nothing conflicting with
   the name, but that is not formal clearance. A real search (e.g. USPTO TESS) and/or legal counsel
   review is still outstanding before App Store Connect listing and any trademark filing. Do not
   treat the PLAN.md rename note (Aug 21, 2026) as having closed this.
5. **Rename items still outstanding after the Aug 21 and Aug 23, 2026 code-level passes.** The
   packages, docs, `app.json` `name`/`scheme`, and in-app UI strings are done for both renames;
   see the rename notes at the top for what is deliberately kept on the old name. Three items
   remain:
   - **A real domain with live `/terms` and `/privacy`.** Settings still links
     `support@fantasyfocus.app`, `https://fantasyfocus.app/terms`, and `.../privacy`. This is a
     **B3 submission blocker regardless of the rename** — App Store Connect requires a reachable
     privacy policy URL — and it needs a registered domain serving two real pages, not a string
     swap. Left pointing at the old name on purpose: an honestly-outdated URL is better than a
     renamed one that 404s during review, which would fail silently until rejection. Overlaps
     Open Question #8 (lawyer review of the policy text itself); this is the hosting half.
   - **The EAS project slug** (`fantasy-focus` → `pivot`, plus the matching rename on
     expo.dev). Deferred until after TestFlight is verified green — rationale in the rename notes.
     Low urgency, but record it rather than letting the mismatch become permanent by default.
   - **Trademark clearance**, still open as Open Question #4 above.
6. **Launch marketing strategy.** Out of scope for this plan.
7. **TestFlight beta cohort.** Likely 50–100 users for August preseason testing.
8. **Terms of service & privacy policy.** Lawyer review needed before App Store submission.
9. **Whether to soft-pitch a sportsbook partner pre-launch.** Could compress Phase 2 timeline.

---

## Known Issues

### Disconnect league returned 500 (empty JSON body + Content-Type) — RESOLVED Aug 16, 2026

**Symptom:** Settings → Disconnect on any league failed with a client-visible 500. Not FK-related (synced vs unsynced both failed before the delete handler ran).

**Root cause:** `apiClient` always set `Content-Type: application/json`, including `DELETE` with no body. Fastify 5 rejects that with `FST_ERR_CTP_EMPTY_JSON_BODY` (400 on the error object). The API error handler only special-cased Zod + `ApiError`, so the FastifyError was flattened to opaque `500 internal_error`.

**Resolution:** Omit `Content-Type` when no body is sent (`app/lib/apiClient.ts`). Shared `apiErrorHandler` honors FastifyError `statusCode` for 4xx instead of collapsing to 500 (`services/api/src/lib/errors.ts`). Same empty-body risk also covered for other no-body calls (`DELETE /me`, `DELETE /me/push-token`, `POST …/sync`, GETs).

### Player search broke on multi-word queries; defenses only matched "Defense" — RESOLVED Aug 16, 2026

**Symptom:** Typing "David" found David Montgomery; "David M" returned nothing. Searching "Lions" / "Detroit" / "DET" never found the Lions defense (only the literal last name "Defense" worked).

**Root cause:** `GET /players/search` used `.or(first_name.ilike.%q%,last_name.ilike.%q%)` — whole-string substring against name columns only. No tokenization; team fields were joined for the response but not searched. DEF rows are seeded as `first_name: ''`, `last_name: 'Defense'` with team identity only on `teams`.

**Resolution:** `search_players(q, filter_position)` RPC — combined search text, whitespace tokens, word-prefix match, AND across tokens. Route calls the RPC instead of the old `.or()` filter. (Team-field scoping refined in the next entry.)

### Team-name search returned every player on that roster, not just the defense — RESOLVED Aug 16, 2026

**Symptom:** After the search RPC landed, "Lions" / "Detroit" returned the DET defense **and** all DET skill players (e.g. Jared Goff).

**Root cause:** Combined `search_text` included team city/name/abbreviation for every player, so skill players matched team tokens.

**Resolution:** Append team city/name/abbreviation to `search_text` only when `position = 'DEF'`. Non-DEF rows stay name-only (multi-word "David M" unchanged). Literal "Defense" still matches via last_name.

### Manual leagues had no edit/rename path after create — RESOLVED Aug 16, 2026

**Symptom:** Fully manual leagues (`platform: 'manual'`) could only be disconnected after creation — no way to change the roster or rename. Not a regression; the create flow (`connect-team` → Add manually) never gained an edit entry point. PLAN Settings already listed rename as intended.

**Root cause / gap:** Settings showed Sync (Sleeper) + Disconnect only. `ConnectManual` always `POST /leagues/manual` first (create-only). Backend already had `PUT /leagues/:id/lineup` for manual rosters; no rename endpoint yet.

**Resolution:** Settings manual rows: Edit lineup / Rename / Disconnect. Dedicated `edit-manual-lineup?leagueId=` screen (shared `PlayerPicker`, pre-fill from GET lineup, save via PUT). `PATCH /leagues/:id` `{ name }` for manual-only rename (`manual_league_only` for Sleeper — reconnect would overwrite a local Sleeper name anyway). Section 9 API table updated; Settings "refresh/rename/disconnect" wording left as-is (now accurate for rename).

### Sleeper sync fails during the offseason/preseason — must fix before v1 launch — RESOLVED

**Symptom (historical):** Connect (`POST /leagues/sleeper`) and `POST /leagues/:id/sync` could not populate a usable lineup while matchups were unpublished (offseason/preseason). Early versions threw `sleeper_matchup_not_found` on `/matchups/0`; a later opportunistic matchup→roster fallback inside `SleeperProvider.fetchLineup` avoided the throw but still wrote week-scoped `lineup_slots` (including week `0`), left connect vs `/sync` inconsistent, and gave the client no signal that the data was a pre-season roster dump rather than real starters.

**Root cause:** Sync treated Sleeper week/matchups as always available and keyed phase-sensitive behavior on raw `season_type` (unreliable for calendar truth — same class of bug as Home's pre–Sprint-10 State 4a). Roster lists are not week-scoped starter/bench data; stuffing them into `lineup_slots` created the week-0 landmine and broke `refreshLineupCache`'s starter/flex-only assumption.

**Resolution:** Gate sync + the lineup worker on schedule-derived `display_phase` (not `season_type`). When `display_phase` is `'off'` or `'pre'`: skip matchups; fetch `GET /league/{id}/rosters`; persist league-level `leagues.fallback_roster` (player UUID list) + `leagues.lineup_source = 'roster_fallback'`; do **not** write `lineup_slots`. When `'regular'`/`'post'`: sync via matchups into `lineup_slots`, set `lineup_source = 'matchup'`, clear `fallback_roster`. `GET /leagues/:id/lineup` composes from the active source and returns `lineup_source` + `regular_season_start` for clients. `refreshLineupCache` treats every fallback player as startable. Connect and `/sync` share this path (success-with-fallback). Once `display_phase` flips to `'regular'`, the 5-min worker re-syncs via matchups and overwrites the fallback (it does not gate on stored `lineup_source`). Opportunistic matchup→roster fallback inside `fetchLineup` remains only as a safety net if Sleeper and `display_phase` briefly disagree during the active season.

**Out of scope / related:** offseason-connected leagues going stale on Sleeper season renewal (new `league_id`) — separate Known Issue below; do not conflate.

### Stale flag state when a user goes inactive mid-game (Sprint 4 discovery) — RESOLVED Sprint 5

**Symptom:** `onPlayEvent` (`services/engine`) only recomputes flag state for users in `getActiveUsers()`. The Section 8 "game ends → fire `flag_removed` for every flagged user" behavior therefore fires only for users still active at the whistle. A user who was flagged but went inactive before the game ended keeps a `flagged: true` `FlagState` in the store and never receives the `flag_removed`.

**Fix (Sprint 5):** the deferred-firing dispatcher's `isStillRelevant` re-validation must gate on liveness — drop/expire events for users who are no longer active, and don't trust a stored `flagged` state without confirming the user is live. Acceptable for v1 in isolation (an inactive user has no session to switch), but the dispatcher and cold-start resolver must not treat stale flagged state as truth.

**Resolution (Sprint 5):** `isStillRelevant` (`services/dispatcher/src/isStillRelevant.ts`) requires both state freshness and `userIsActive`. Inactive users drop from the deferred queue; cold-start does not treat stored `flagged` as truth (see next entry).

### Stored `FlagState` is not ground truth — `/flags/current` must recompute (Sprint 4 discovery) — RESOLVED Sprint 5

**Symptom:** Per Section 8, `onPlayEvent` persists a user's `FlagState` only when a diff crosses the event threshold (flag added/removed, or priority delta ≥ ±3). Sub-threshold priority drift is intentionally *not* persisted, so the stored `priorityScore` can lag the true current value by up to ±2, and the stored `reasons` can be slightly stale.

**Fix (Sprint 5+):** `GET /flags/current` (the cold-start endpoint) must recompute fresh from `(lineup, gameState)` via `computeFlagState` rather than reading the stored `FlagState`. Only the WebSocket delta stream should rely on the diff-persisted state. Don't let any consumer treat the stored score as authoritative.

**Resolution (Sprint 5):** `GET /flags/current` (`services/api/src/routes/flags.ts`) recomputes via `computeFlagState` and never reads `user_flag_state:{user}:{game}`.

### `scheduledFireAt` is a placeholder (Sprint 4) — RESOLVED Sprint 5

**Symptom:** The engine sets `FlagEvent.scheduledFireAt = newState.computedAt` as a placeholder. Real deferred firing (stream-lag calibration per `BROADCAST_LAG_SECONDS`, Section 8) is out of scope for Sprint 4.

**Fix (Sprint 5):** the dispatcher's `scheduleFlagEvent` overwrites `scheduledFireAt` with `Date.now() + lag`. Nothing downstream should treat the engine-emitted value as authoritative timing.

**Resolution (Sprint 5):** `QueueingEventDispatcher` (`scheduleFlagEvent.ts`) overwrites the engine placeholder with `clock() + lagSec * 1000` from `BROADCAST_LAG_SECONDS` / unresolved fallback.

### IDP support (v1.5+) requires per-player position categories in the lineup cache (Sprint 4 note)

**Symptom:** `UserLineupCache` tracks offense/defense position categories at the *team* level (`teamPositions`), not per player. `computeFlagState`'s `playerIdsOnTeam` therefore returns all of a user's players on a team and relies on `teamPositions` gating to enforce the offense-vs-defense distinction. This is exact for v1 (a team is either the user's offense stake or defense stake), but breaks with IDP, where a single team can have both offensive and individual defensive players the engine must distinguish per player.

**Fix (v1.5+, when IDP lands):** grow `UserLineupCache` to carry per-player position categories and update `playerIdsOnTeam` to filter a team's players by the requested category. IDP is explicitly out of scope for v1 (Section 4).

### Push receipt polling is not implemented (Sprint 6 discovery) — fix in v1.5

**Symptom:** v1's `ExpoPushNotifier` (`services/dispatcher/src/pushNotifier.ts`) handles ticket-level errors synchronously (e.g. a malformed token, rejected immediately by `sendPushNotificationsAsync`) but does not poll Expo's receipt endpoint for delayed failures — most notably `DeviceNotRegistered`, which Expo only reports 15+ minutes after send, via a separate `getPushNotificationReceiptsAsync` call keyed on the ticket ids from the original send.

**Fix (v1.5):** add a receipt-polling worker, persist ticket ids returned from `sendPushNotificationsAsync` to Postgres (new state — deliberately not introduced in v1 per Sprint 6 constraints), poll receipts on a delay, and clear `expo_push_token` on a confirmed `DeviceNotRegistered`.

**Impact if unfixed:** a user with a stale/uninstalled-app token silently misses pushes — there's no signal back to `expo_push_token` to clear it — until they next open the app and the token re-registers (Phase 5's registration flow overwrites the stale value). Acceptable for v1 since the WebSocket channel is the primary delivery path whenever the app is open; push is the secondary channel for a backgrounded/closed app.

### `viewing_sessions.primary_priority_score` can go stale between heartbeats (Sprint 5 Phase 6)

**Symptom:** `PUT /session/primary` computes `primary_priority_score` fresh via `computeFlagState` at the moment the primary game is set, but nothing recomputes it afterward — `POST /session/heartbeat` only refreshes Redis `active_users` liveness, not this stored score. As the game progresses, the stored value drifts from the game's true current priority.

**Fix:** any consumer needing the *current* priority score (e.g. `decideAction`'s primary-game comparison) must recompute from `(lineup, gameState)` fresh via `computeFlagState`, not read the stored `viewing_sessions.primary_priority_score`. Same class of staleness as Sprint 4 closeout #2 (`FlagState` is a change log, not ground truth) — this is the `viewing_sessions` analogue of that same rule.

### `services/dispatcher` → `services/api` type propagation requires a manual `dist/` rebuild (Sprint 6 discovery) — RESOLVED Sprint 9 Phase 3

**Symptom:** `services/api` consumes `@fantasy-focus/dispatcher` as a built workspace dependency (`main`/`types` point at `dist/`, per its `package.json`). When a Sprint 6 Phase 3 change added fields to `catalogs.ts`'s `GameSummaryInfo` (a dispatcher-side type `services/api/src/routes/flags.ts` constructs literals against), `pnpm --filter services/api typecheck` kept failing with a stale "does not exist in type" error until `services/dispatcher`'s own `pnpm run build` was run first to regenerate `dist/*.d.ts`. `pnpm -w run typecheck`/`pnpm -w run test` (which build nothing, just run `tsc --noEmit`/`vitest` per package) don't surface this — they happened to pass in CI order today, but any dispatcher-side type change consumed by the API is one dist rebuild away from a false-negative typecheck (stale dist silently type-checks against the *old* shape instead of failing) or a false-positive failure (stale dist hasn't caught up yet), depending on which package's task runs first.

**Root cause:** the dispatcher-to-API relationship is build-mode (compiled `dist/` + `.d.ts`) rather than source-mode. Nothing in the workspace's typecheck/test scripts declares the dependency between "dispatcher's `dist/` is fresh" and "api's typecheck is meaningful," so it's silently on whoever last remembered to rebuild.

**Resolution (Sprint 9 Phase 3):** moved every backend package (`shared`, `services/engine`, `services/dispatcher`, `services/api`, `services/ingestion`) to TypeScript project references — `composite: true` + a `references` array mirroring the real dependency graph in each `tsconfig.json`, each package's `typecheck` script changed from `tsc --noEmit` to `tsc -b tsconfig.json`, and a new root `tsconfig.build.json` solution file plus a `pnpm run build` (`tsc -b`) that the root `typecheck` script now runs first. `tsc -b` checks each referenced project's `.tsbuildinfo` against its inputs and transparently rebuilds anything stale, in dependency order, before checking the requesting project — that rebuild-on-demand behavior is what actually closes the gap, not `composite`/`references`/`declarationMap` alone (verified empirically: with only those three added and no `-b`, a plain `tsc --noEmit` in `services/api` still resolved `@fantasy-focus/dispatcher` against stale `dist/*.d.ts`, passing when it should have failed). Confirmed against the original repro exactly: renamed a field in `services/dispatcher/src/catalogs.ts` without rebuilding, and `pnpm --filter @fantasy-focus/api run typecheck` — run standalone, the same command named in the Symptom above — now fails immediately with the correct cross-package error instead of passing against stale types. `shared`/`engine` turned out not to have the equivalent latent issue on the Vitest path (their `vitest.config.ts` aliases already resolved straight to source); only the `tsc`/`tsx` consumers needed this fix.

**Impact while open:** cross-package type errors could go undetected (stale dist) or block on a rebuild step that wasn't part of the documented workflow (`README.md` doesn't mention it) — a real footgun through Sprint 7–9 as dispatcher-side types kept changing underneath the API. No longer reachable as of the resolution above.

### Native quick-action buttons on notifications are not registered (Sprint 6 Phase 7) — fix in v1.5

**Symptom:** The client's foreground in-app banner (`FlagEventBanner`) and the background default-tap notification response (`NotificationResponseHandler`) are both wired and record a `flag_events.user_action`, but no OS-level notification category (`Notifications.setNotificationCategoryAsync`) is registered, and the dispatcher's outgoing Expo push message never sets a `categoryId`. iOS therefore never offers "Switch"/"Dismiss" as long-press quick-action buttons on the notification itself, in the notification tray, or on the lock screen — only a body tap (which opens the app) is available.

**Fix (v1.5):** register a `flag_event` notification category client-side (`Notifications.setNotificationCategoryAsync`) with `switch`/`dismiss` action identifiers, and set a matching `categoryId` on the Expo push message in `services/dispatcher/src/pushNotifier.ts`. `app/components/NotificationResponseHandler.tsx` already maps `switch`/`dismiss` action identifiers defensively, so this is a two-file addition with no change to the response-handling logic itself.

**Impact if unfixed:** users must open the notification (tap the body) to interact with it at all — there's no shortcut from the pull-down notification tray or lock screen the way Section 10's push format spec ("Action buttons: Switch and Dismiss") implies. Deferred to v1.5 pending actual usage data on how often users interact from the tray vs. the in-app banner, which already covers the foregrounded case.

### Push notification hardware verification deferred (Sprint 6) — RESOLVED Sprint 10 Track B (B1)

**Symptom:** The full push pipeline (dispatcher → Expo → client) is verified end-to-end in iOS Simulator only — the foreground banner, backgrounded notification delivery, and the `POST /flags/:event_id/action` endpoint wiring all check out there. A real APNs round-trip and real device token registration (`POST /me/push-token` populated from an actual `Notifications.getExpoPushTokenAsync()` call) are not yet verified.

**Root cause:** Simulator cannot receive real push tokens (`getExpoPushTokenAsync` has no APNs device token to hand Expo), and a free personal-team signing identity lacks the push notification entitlement a physical-device build would need to actually register with APNs.

**Fix:** defer real-device push verification to Sprint 8 — a physical device is already required by then for AirPlay/Chromecast testing, so it's a natural point to also confirm the push pipeline against real hardware. Enroll in the Apple Developer Program earlier than Sprint 8 if device verification is needed sooner.

**Impact if unfixed:** the push pipeline's Simulator-verified behavior (banner rendering, action recording, endpoint wiring) is a strong signal but not proof the real APNs path works — token format, delivery latency, and background wake behavior on a real device remain unverified until Sprint 8 or an earlier enrollment.

**Resolution (Sprint 10 Track B / B1):** Paid team + device build with `aps-environment: development`; real `ExponentPushToken[…]` registered via `POST /me/push-token` from hardware; Apple Push Key (Developer Portal ID `82JW379P4C`) created via `eas credentials -p ios` and assigned to `@parkertjones/fantasy-focus` / `com.fantasyfocus.app`. Manual Expo Push send returned ticket + receipt `ok`; notification confirmed visible on the physical iPhone. Still Expo-indirected (not a raw APNs driver); receipt-polling worker and native Switch/Dismiss categories remain v1.5 Known Issues.

### Phone-as-remote (AirPlay/Chromecast) is not achievable without video rights (Sprint 10 Track B / B2a discovery) — Sprint 8 scope cut

**Symptom:** On a physical iPhone with a Mac AirPlay Receiver as the target, the implemented `AirPlayPlaybackSource` behaved correctly by its own contract — the target was detected, the source won resolution over deep-link, `viewing_sessions.primary_source` recorded `airplay`, and the system route picker presented. But the picker offered only an **audio** output route, never a video or app-level route, and the selection had no effect on the YouTube TV app that the subsequent deep-link hand-off opened. There is no combination of these APIs that produces "the TV is now playing the game while the phone stays a remote."

**Root cause:** Section 2's rights constraint, surfacing at the API layer. `AVRoutePickerView` routes media belonging to *the process presenting it*. v1 owns no video, so there is no `AVPlayer` in our process and iOS correctly offers only the audio session as routable. Routes are also per-app: a route chosen in our app does not transfer to a different app, and whether a third-party streaming app casts its own video is that app's decision. The only cross-app mechanism is system-wide Screen Mirroring, which the user invokes from Control Center and an app cannot trigger on the user's behalf. This was a specification error, not an implementation defect — the plan treated "phone-as-remote" as independent of rights when it is downstream of them.

**Fix (applied):** Cut from v1 rather than worked around, because there is nothing to work around.
1. `createPlaybackSources()` is deep-link only, so production behaviour matches what shipped before Sprint 8's sources existed.
2. `AirPlayPlaybackSource` and its native module are kept implemented, tested and dormant — not deleted. They are correct code sitting behind a wrong assumption, and they become useful unchanged if Phase 2 lands rights. A test asserts a discoverable target cannot pull the source back into the default registry, and a second asserts re-adding it restores cast-first priority.
3. Chromecast was not built. The Cast SDK would hit the identical wall, so the stub stays honest and `react-native-google-cast` is not added.
4. No "Cast to TV" CTA shipped — with only an audio route available, that copy would promise something the app cannot do.

**Impact:** v1 is a deep-link aggregator (Section 2 model 2), not a phone-as-remote app (model 3). This is a real product-scope reduction and it weakens the headline positioning, so it should be reflected in App Store copy and any pitch material rather than quietly dropped. Two things partly offset it: the `PlaybackSource` boundary meant retiring a source cost one line in the registry, and the deep-link path — the mode that actually ships — was already the better-tested one. Two genuine iOS bugs found while building it are fixed and committed independently of whether AirPlay ever ships (a route picker hosted at `alpha = 0` is treated by UIKit as not visible and its sheet is silently dropped; resolving `presentRoutePicker` before `routePickerViewDidEndPresentingRoutes` lets a deep-link hand-off race the sheet and dismiss it under the user).

**Related but distinct:** Screen Mirroring as a deliberate, user-driven flow is a different product idea, not this one rescheduled — see Section 14. It is unbuilt and needs its own UX design.

### Every seeded deep link opened Safari instead of the provider's app (Sprint 10 Track B discovery) — RESOLVED Sprint 10 Track B

**Symptom:** Tapping "Switch" on a real device opened `tv.youtube.com` in Safari rather than the installed YouTube TV app. Not specific to YouTube TV: of the 11 `BROADCAST_TEMPLATES` entries, exactly one (`paramount_plus`) would have opened its app, and `paramount_plus` is never seeded into any game by `buildBroadcastRows`. Every broadcast row in the database landed in Safari.

**Root cause:** Ours, and it was the seed data. Not `Linking.openURL` — that reaches `UIApplication.open`, which honors universal links correctly. Not a missing provider AASA either; the providers' files are mostly fine. The seeded URLs were bare marketing homepages, and providers deliberately exclude those from universal links so signup/marketing stays on the web. YouTube TV's AASA claims `*` after 102 deny rules, one of which is a literal `NOT /` — so `https://tv.youtube.com/` was the single worst path we could have chosen, while `/watch/*` and `/live` open the app. Other services were near-misses of the same kind: Fox claims `/live/*` and we sent `/live`; Prime Video's AASA is on `primevideo.com`, not `amazon.com/gp/video`. This was placeholder fixture data (flagged `⚠️ UNVERIFIED` in `seed-broadcasts.ts` since Sprint 7) finally being exercised on hardware, not a regression.

**Fix (applied):** Every fixable template now uses a path verified as claimed by the provider's **production** app ID. Matching on production specifically matters — dev/QA/dogfood builds routinely claim paths the shipping app does not, and ESPN is a live example: `com.espn.ScoreCenterDogfood` claims `/nfl/scoreboard` while shipping `com.espn.ScoreCenter` does not. `sunday_ticket` was additionally confirmed on a physical iPhone: `/library` opened the YouTube TV app through the same code path that had sent `/` to Safari minutes earlier.

**Impact:** Deep-linking — the one playback mode v1 actually ships (see the phone-as-remote entry above) — was broken for every game, and had been since Sprint 7. Worth being precise about what is and isn't fixed: these URLs now open the right *app*, not the right *game*. Open Question #2 remains open, because an AASA file states which paths open an app and never which paths are valid content; per-game links need each provider's internal content IDs. Two Known Issues below cover what this exposed.

### CBS Sports and NBC Sports can never open their apps from a link (Sprint 10 Track B discovery) — not fixable by us

**Symptom:** `cbs` and `nbc` broadcasts open Safari no matter what URL we use.

**Root cause:** Entirely outside our control. `cbssports.com` serves an AASA with zero `applinks` detail entries, and `nbcsports.com` serves none at all (404). With no association file claiming any path, iOS has nothing to resolve against, so no URL on those domains can ever open an app. Both are left pointing at sensible web pages deliberately rather than being made to look fixed.

**Impact:** Two of the four rotating over-the-air networks in the fixture set degrade to a browser. In production these are real broadcasters for a large share of Sunday afternoon games, so this is not an edge case. The honest handling is product copy that does not promise an app hand-off for every service, plus the app-level fallback we already have. Worth re-checking periodically — a provider can add an AASA at any time, and this costs one `curl` to confirm. App-specific URL schemes were considered and rejected: for these two the schemes are undocumented, each would need declaring in `LSApplicationQueriesSchemes` (not currently configured at all), and they break silently on any provider update.

### A Safari fallback is indistinguishable from success, so the deep-link error state can never fire (Sprint 10 Track B discovery) — fix in v1.5

**Symptom:** `openBroadcast` (`app/contexts/SwitchingContext.tsx`) treats "`Linking.openURL` did not throw" as "the app opened". For an `https` URL iOS always succeeds, because Safari handles it — so `opened` is unconditionally `true` and Section 10's "That app doesn't seem to be installed" error state, with its alternate-broadcast picker and "Get app" links, is unreachable for every URL we ship.

**Root cause:** iOS exposes no signal for "did a universal link reach the app". `canOpenURL` is no help either: it returns true for any `https` URL because Safari can always open it.

**Impact:** This is the reason a completely broken deep-link table looked healthy from Sprint 7 through Sprint 9 and survived to a device test — the failure mode renders as success. The Sprint 9 error-state work is real but currently dead code on this path. No behaviour change made in this pass: any detection is necessarily a heuristic (typically inferring failure when the app never backgrounds within a short window), which interacts with the switching overlay's own timing and deserves its own scoped change with its own device verification rather than riding along on a data fix.

### A notification tapped from a killed app opens Home and silently drops the switch (Sprint 10 Track B discovery) — RESOLVED Sprint 10 Track B

**Symptom:** Tapping a `flag_event` push while the app is fully terminated launches the app to Home and nothing else happens — no switching overlay, no deep-link hand-off. Tapping the same notification while the app is merely backgrounded works correctly.

**Root cause:** `NotificationResponseHandler` used `Notifications.addNotificationResponseReceivedListener`, which only delivers responses arriving *after* subscription and never replays the tap that launched the app. The component mounts inside `AppGroupLayout`, behind `PushPermissionProvider`, `LeaguesGateProvider`, `SwitchingProvider` and the `(app)` route group's auth gate — so on a cold start the launching response is delivered before the listener exists and is dropped.

**Fix (applied):** `NotificationResponseHandler` now consumes `Notifications.useLastNotificationResponse()`, which reads the native last-response on mount *and* listens for subsequent ones, then clears the slot via `clearLastNotificationResponse()` after handling so a remount cannot re-fire the same tap. Response application logic lives in `app/lib/notificationResponse.ts` so the cold-start / dismiss / switch paths are unit-tested without mounting Expo's emitter.

**Resolution (Sprint 10 Track B):** Device-verified on a physical iPhone across all three app states — killed (force-quit), backgrounded, and foregrounded (OS notification tap, not the in-app banner). Each produced the switching overlay and deep-link hand-off to YouTube TV. The killed case is the one that previously failed silently.

### 25 push-notification-content tests silently never ran (Sprint 6 regression) — RESOLVED Aug 21, 2026

**Symptom:** `services/dispatcher/src/notificationContent.test.ts` failed to load with `Error: Vitest cannot be imported in a CommonJS module using require()`, collecting **0 tests**. Carried as "one pre-existing, unrelated test failure" in the Sprint 10 Track B handoff and diagnosed there as a CommonJS/ESM config issue, confirmed via `git stash` to predate Track A. It stayed open across all of B0–B2 as a known-but-not-blocking item.

**Root cause:** Not an ESM/CJS configuration problem at all — a single corrupted import. An editor auto-import had rewritten line 2's `vitest` specifier into a path through pnpm's internal content-addressed store, pointing at the CJS build: `../../../node_modules/.pnpm/vitest@4.1.10_@types+node@26.1.1_.../node_modules/vitest/index.cjs`. Vitest rejects that entrypoint by design, so the suite threw during load. Because the failure happened at import time, the 25 cases inside were never collected, and the file reported as one red suite among sixty rather than as missing coverage. Introduced in Sprint 6 (`5259553`); verified isolated — no other file in the repo imports through the store path.

**Impact:** `notificationTitle` / `notificationBody` — the user-visible text of every push this product sends — had **zero executing test coverage from Sprint 6 through Sprint 10 Track B**, including the entire B1 real-device APNs verification and the cold-start fix above. Nothing was silently broken (all 25 pass unmodified once collected), but the guarantee everyone assumed was in place was not.

**Resolution:** Restored the bare `'vitest'` specifier, matching every sibling test in the package. Suite total went 565 → 590 tests, 62 → 63 files, all green. Committed standalone, ahead of the rename commits it was found by.

**Process note — how it was found:** not by looking for it. It surfaced from running the full suite to capture an attributable baseline *before* starting the code-level rename, specifically so any post-rename failure could be told apart from a pre-existing one. The bug had been visible in every test run for four sprints and read as background noise. Two things generalize: a suite that fails to *load* hides an unbounded number of tests while looking like a single failure, and "pre-existing, unrelated" is a label that stops investigation — this one survived four sprints of being technically known and never examined. Establishing a clean baseline before mechanical work is what made it legible.

### Broadcast timing source is a guess, not knowledge — spoiler-safety only holds for exclusive-window games (Sprint 5/7 discovery) — fix in v1.5

**Symptom:** For games with a single broadcast (Thursday Night Football on Amazon, Sunday Night on NBC, Monday Night on ESPN/ABC), resolveLikelyBroadcastSource correctly identifies the service the user is watching and offsets scheduledFireAt accordingly — the stream-lag-aware deferred firing behavior works as intended and notifications arrive spoiler-safe. For games with multiple broadcasts (Sunday afternoon 1pm/4pm ET windows, which are always simulcast across a broadcast network + Sunday Ticket + often NFL+; Thanksgiving's three-game slate; select international games), the resolver picks the lowest-lag service among the user's user_app_presence entries. This is a heuristic that silently spoils plays for a specific and important cohort: users subscribed to both Sunday Ticket and a broadcast network who are actually watching on Sunday Ticket. The resolver picks broadcast (8s lag), the fire time is calibrated 67 seconds earlier than the user's actual stream, and the notification arrives before the play appears on their screen.

**Root cause:** The timing resolver has no information about which broadcast the user is actively watching for a given game — only which services they're subscribed to in aggregate. Sunday afternoon simulcasts are the modal case for this app's usage (every 1pm and 4pm ET game, every week), and Sunday Ticket subscribers are the engaged fantasy power users the product is built for, so the failure mode disproportionately hits the target audience. The exclusive-window games (Thursday/Sunday/Monday night, most international slots) are unaffected because there's no ambiguity to guess wrong about.

**Fix (v1.5):** Combine a user-declared preference with per-session recorded intent:
1. Add a "preferred streaming service" field to users.preferences (single default sufficient for v1.5; per-broadcast-window granularity — Thursday / Sunday afternoon / Sunday night / Monday — as an eventual refinement). Surface it in Settings alongside the existing "Streaming services" list. resolveLikelyBroadcastSource uses it as a strong tiebreak: if the user's preferred service carries the game, pick it regardless of lag.
2. When the user taps "Switch" on a game with multiple eligible broadcasts, GET /games/:id/broadcasts already returns the full ranked menu — present a picker instead of dispatching immediately. Record the chosen service via PUT /session/primary (source field already exists). For the remainder of that viewing session, the timing resolver reads the recorded choice for this specific game rather than falling back to preference or heuristic.
The recorded choice is authoritative because it reflects what the user is watching, not what they might watch — which is exactly the input the spoiler-safety guarantee needs.
**Impact if unfixed:** Sprint 7's recommended_source is being made lag-consistent with the timing calculation (both driven by resolveLikelyBroadcastSource), so the app's internal recommendation and timing are self-consistent — but "self-consistent" doesn't mean "correct." For a Sunday Ticket subscriber watching a Sunday afternoon simulcast, both the fire time and the "Watch on CBS" recommendation will be wrong in the same direction: the notification arrives 60+ seconds before the play on their actual stream, and the CTA points at a broadcast they weren't watching. Exclusive-window games are unaffected. Also relevant to the fourth patent novelty point (stream-lag-aware deferred firing as spoiler-safe): the claim is architecturally sound — the mechanism does what it says — but the input the mechanism operates on is currently a guess for the multi-broadcast case, which is worth being precise about in the specification. Deferred to v1.5 rather than v1 because (a) the fix touches Settings UI, a new preferences field, session-recording semantics, and the timing resolver simultaneously, and (b) exclusive-window games (which are unaffected) are still the majority of prime-time viewing, so the failure mode, while pointed, isn't universal.

**Sprint 7 addendum:** the Home-screen "Now active" CTA resolves its target from `GET /games/:id/broadcasts`'s `preferred` (the eligibility-first `rankBroadcasts` ranker), while the notification banner's Switch uses the dispatcher's timing-consistent `action.deep_link_url` — so for a multi-broadcast game the two entry points can name different services; this is the same underlying guess surfacing in two code paths (presentation vs. timing-critical), not a separate defect, and it resolves with the recorded-choice fix above.

### Home "Now active" reason chip lacks player-name fidelity (Sprint 7 Phase 5) — RESOLVED Sprint 9

**Symptom:** Section 10's State 1 reason chip specs player-level copy ("Jonathan Taylor active — RB — Colts offense"). The shipped `NowActiveCard` chip instead shows a reason-*type* label ("Your offense is on the field") with no player name, position, or possessing-team detail.

**Root cause:** Home's cold-start path reads `GET /flags/current`, which returns reason *types* (`reasons: string[]`) and player *ids* (`flagged_player_ids`) but no player names or team context. The names exist on the WebSocket `flag_event` payload (`flagged_players`), but Home doesn't consume that stream (see the Home-not-WebSocket-subscribed entry below), and there is no batch player-by-id lookup endpoint (only `GET /players/search`).

**Fix (Sprint 9):** either enrich `GET /flags/current`'s flag entries with resolved `flagged_players` (name/position) — a Section 9 response addition — or add a batch player-by-id read the client can call with `flagged_player_ids`; possessing-team context for the chip needs the same treatment.

**Resolution (Sprint 9):** `/flags/current` and `flag_event` carry full `flagged_players`; `NowActiveCard` uses `reasonChipCopy` (`app/lib/teamDisplay.ts`). Multi-player copy convention remains a separate open note below.

### Switching-transition "team color flash" not implemented (Sprint 7 Phase 6) — RESOLVED Sprint 9

**Symptom:** Section 10's "Switching transition" specs a brief overlay with a "team color flash." The shipped overlay (`SwitchingContext`) is a neutral dark scrim with a spinner and "Switching to…" copy — no team-colored flash.

**Root cause:** no team color reaches the client. `teams.primary_color`/`secondary_color` exist in the schema (Section 7), but neither `GET /flags/current`'s game summary nor the `flag_event` payload carries them, and no endpoint surfaces team colors to the app.

**Fix (Sprint 9):** expose team colors (via the game-summary payloads or a small teams lookup) and drive an accent animation in the overlay from the possessing team's color.

**Resolution (Sprint 9):** `game_summary` carries team primary/secondary colors; `SwitchingContext` renders `TeamColorFlash` from the resolved possessing/flagged team colors.

### Switching overlay label uses the matchup, not the possessing team (Sprint 7 Phase 6) — RESOLVED Sprint 9

**Symptom:** Section 10's transition copy reads "Switching to [Team] game…" (the possessing team). The shipped overlay reads the matchup instead ("DEN @ IND").

**Root cause:** neither `GET /flags/current` nor the `flag_event` payload identifies which team currently has possession — `new_state` carries no team id and `game_summary` carries both team codes symmetrically — so the client can't name the possessing team from what it receives.

**Fix (Sprint 9):** add possessing-team identity to the relevant payload(s) (or derive it client-side once live game state is available to the app), then label the overlay with that team's name.

**Resolution (Sprint 9):** `flag_event` `new_state.possession_team` plus `resolvePossessingTeamDisplay` / `resolveFlaggedTeamDisplay` drive the overlay team name (and Home chip team context).

### Deep-link error state is partial — no alternate-broadcast sheet or "Get app" link (Sprint 7 Phase 6) — RESOLVED Sprint 9

**Symptom:** Section 10's deep-link error spec is a "sheet with alternate broadcast or 'Get [app]' App Store link." The shipped error state (`SwitchingContext`) is a generic modal — a message ("that app doesn't seem to be installed — try another broadcast") plus a Close button — with no in-place alternate-broadcast picker and no App Store install link.

**Root cause:** the overlay is handed only the single resolved deep link for the switch, not the full ranked broadcast menu, and there is no per-service App Store ID map to build a "Get [app]" link from — both are needed to offer an actionable alternate/install path in place.

**Fix (Sprint 9):** pass the full `GET /games/:id/broadcasts` ranked list into the overlay so the user can pick an alternate broadcast, and add a per-service App Store ID map for the "Get [app]" link. (Also depends on the deep-link audit — Open Question #2 — to know which schemes can even fail this way.)

**Resolution (Sprint 9):** `SwitchingContext` error path shows the ranked alternate-broadcast picker and per-service "Get app" links (`app/lib/streamingServices.ts`).

### Home screen is not subscribed to the WebSocket flag stream (Sprint 7 Phase 5) — RESOLVED Sprint 10 Phase 3

**Symptom:** Section 10's State 1/State 2 describe the Home dashboard auto-updating "via WebSocket when the next flag fires." The shipped Home screen is cold-start only: it fetches `GET /flags/current` + `GET /games/:id/broadcasts` on mount and on pull-to-refresh, and does not update live as flag events arrive.

**Root cause:** there is no client-side WebSocket consumer yet — the realtime `flag_event` stream (Section 9) reaches the app only as push notifications (which drive the banner), not as an in-app subscription Home reads from. Building that client socket is out of Sprint 7's scope.

**Fix (Sprint 9, or whenever the client realtime consumer lands):** subscribe Home to the `realtime:user:{id}` `flag_event` stream and update the "Now active" card (and future "Also flagged" row) in place, keeping the cold-start fetch as the initial/refresh path.

**Resolution (Sprint 10 Phase 3):** Home binds via `useHomeRealtime` / `RealtimeClient` to `/v1/realtime`, gated on `display_phase` live phases; applies `flag_event` deltas and reconciles `/flags/current` after reconnect. Device-live flag traffic still awaits regular-season games.

### Unpaginated `players` fetches silently truncate at PostgREST's `max_rows` cap (Sprint 9 Phase 3 discovery)

**Symptom:** the new `scripts/seed-test-user.ts`'s roster-assignment query (`select(...).in('position', [...])`, no pagination) returned exactly 1000 of the 1033 seeded `players` rows in local testing — silently dropping all 32 synthesized `DEF` rows, since `scripts/seed-players.ts` appends them last. The roster builder came up one spot short (whichever position ran out first) with no error surfaced.

**Root cause:** `supabase/config.toml`'s `[api] max_rows = 1000` hard-caps every PostgREST response at 1000 rows, server-side. A client-side `.limit()` above that value is silently clamped back down rather than erroring — confirmed directly: requesting `.limit(5000)` still returned exactly 1000 rows. Any unpaginated `select()` against a table that can exceed 1000 rows is at risk the same way, with nothing in the response indicating truncation happened.

**Fix:** `scripts/seed-test-user.ts` now paginates with `.range(offset, offset + 999)` in a loop until a page returns fewer than 1000 rows. Audited the rest of the codebase for other unpaginated `players` reads while fixing this: `services/api/src/routes/players.ts` (search) uses an explicit `.limit(20)`; `services/api/src/lib/lineup-sync.ts`, `services/api/src/routes/leagues.ts`, and `services/api/src/routes/flags.ts` all filter `players` via `.in('id'/'sleeper_id', [...])` against a caller-bounded id list (a single user's lineup or flagged players — never close to 1000 in practice). None of the current production call sites are affected; `scripts/seed-players.ts` itself only ever reads from `teams` (32 rows), not `players`.

**Impact if unfixed elsewhere:** the currently-shipped call sites are all safe today, but this is a footgun for the next unpaginated (or loosely-filtered) table read someone adds — no test or lint rule catches it, only manual audit against `supabase/config.toml`'s `max_rows`.

### Home States 2–4 (live score / countdown) have no backing endpoint (Sprint 9 Phase 2 discovery) — RESOLVED Sprint 10

**Symptom:** Section 10 specs Home States 2–4 (upcoming-game countdown, live score for games the user isn't flagged in, etc.) as part of the dashboard's cold-start view. Sprint 9 Phase 2 collapsed these into a single "no active flags" idle state that shows an honest lineup summary instead of live scores or countdowns.

**Root cause:** States 2–4 need schedule/live-score data — "what's my next game and when," "what's the score of games I'm not flagged in right now" — that no existing endpoint provides. `GET /flags/current` only returns *flagged* games; there is no `GET /games?week=` (schedule) or `GET /games/live` (live scores) endpoint. Building either was out of Sprint 9 Phase 2's client-side scope, and fabricating countdown/score data client-side against a nonexistent endpoint was rejected in favor of shipping something true.

**Fix (Sprint 10):** add `GET /state/nfl` (calendar / `season_type` for State 4a) plus schedule endpoints (`GET /games?week=` / `GET /games/live`) — needed anyway for real-world Sunday preseason testing (kickoff times matter for actually exercising the app on Sundays) — and implement Home States 2–4 against them. Naturally clusters with the Home WebSocket subscription work (see "Home screen is not subscribed to the WebSocket flag stream" above), since both land on Home in the same pass.

**Resolution (Sprint 10):** `GET /state/nfl` (with schedule-derived `display_phase` / openers), `GET /games?week=`, `GET /games/live`, and Home States 2–4 plus State 4a (`HomeLiveIdleCard` / `HomePregameCard` / `HomeOffDayCard` / `IdleHomeCard`) are shipped.

### Star players ship as a flat toggle list, not Section 10's grid view (Sprint 9 Phase 2)

**Symptom:** Section 10's Settings spec calls for star players as a "grid view with toggles." The shipped Settings screen (`app/app/(app)/settings.tsx`'s `StarPlayersSection`) is a flat list — one row per lineup slot across all connected leagues, each with a `Switch` — backed by the real `POST /leagues/:id/stars` (already implemented server-side, previously unused by the client).

**Root cause:** Sprint 9 Phase 2's instructions scoped star players as "data layer only" — wiring the toggle to the real endpoint so the data model and API path are exercised — not a visual redesign to match Section 10's grid treatment.

**Fix:** a later sprint should replace the flat list with the specified grid view once star players are functional in the switching engine's priority scoring (currently stored but not used — see Section 4's "Star player flagging (stored, not yet surfaced in switching)" and the `star_player_bonus` term in Section 8's priority formula) — the two are natural to land together rather than redesigning the visual treatment twice.

**Impact if unfixed:** cosmetic only — the data is real and functional (toggling persists via `POST /leagues/:id/stars`), it just isn't presented as a grid.

### Multi-player reason chip copy convention (Sprint 9 Phase 2) — undocumented in Section 10

**Symptom:** Section 10's reason chip example only covers the single-player case ("Jonathan Taylor active — RB — Colts offense"). There's no spec'd copy for when more than one flagged player triggers the same flag.

**Root cause:** the four Section 10 fidelity fixes shipped this sprint needed a rule for `reasonChipCopy` (`app/lib/teamDisplay.ts`) to render something for the multi-player case, and none existed to follow.

**Convention chosen:** lead with the first flagged player's full name, append "+N more" for the remainder, and drop the position segment (which only makes sense for a single named player) — e.g. "Jonathan Taylor +2 more active — Colts offense." This is a *different* convention from the dispatcher's existing push-notification copy (`notificationContent.ts`'s `describeSubject`), which uses a count-only "3 of your players active" with no name at all for the multi-player case — the two weren't reconciled, since the chip (persistent, more screen space) and the push title (terse, glanceable) have different constraints. `flaggedPlayers` isn't ordered by relevance from either `/flags/current` or the WebSocket payload, so "first" is arbitrary but stable within a render.

**Fix:** worth a real product decision on whether the chip and push-notification multi-player conventions should converge, and whether "first" should become "highest-priority player" once the payload carries per-player priority — neither exists as of Sprint 9. Not blocking; both conventions render correctly today, just inconsistently with each other.

**Impact if unfixed:** cosmetic inconsistency between the in-app chip and push notification copy for the (currently rare) multi-player-per-flag case; no functional impact.

### Settings is a modal stack push, not a tab (Sprint 9 Phase 2) — fix once a Lineup tab exists

**Symptom:** Settings (`app/app/(app)/settings.tsx`) is reached via a header button on Home and rendered as a modal-presentation stack screen (`app/app/(app)/_layout.tsx`'s `<Stack.Screen name="settings" options={{ presentation: 'modal' }} />`), not a tab.

**Root cause:** there is no tab bar in the app at all yet — Home is the only primary destination, reached directly off the root stack. A proper Settings tab implies a tab bar, which implies at least one sibling tab worth tabbing to; the v1.5 Roadmap's "Multi-league support (lineup tab gets league selector)" is the first planned candidate for that sibling, and it isn't built yet.

**Fix:** once a Lineup tab (or equivalent second primary destination) exists, promote Settings from a modal stack push to a proper tab alongside it, and remove the Home header button in favor of the tab bar.

**Impact if unfixed:** none functionally — modal presentation is a reasonable pattern for a single-destination app; it just isn't the tab-based IA a two-tab (or more) app would eventually want.

### Offseason-connected Sleeper leagues go stale on renewal (pre-Sprint-10 discovery) — fix in Sprint 10 or v1.5

**Symptom:** A Sleeper league connected during the offseason is pinned to the prior season's `league_id` and will silently never receive current-season lineups once the new season begins.

**Root cause:** The `/sleeper/leagues` previous-season fallback (added pre-Sprint-10, `services/api/src/routes/sleeper.ts`) lets users discover and connect leagues in the offseason by returning the prior season's leagues when the current season is empty. But Sleeper issues a *new* `league_id` when a league renews for the new season — the prior-season league object is a different record, not the same league at an earlier point in time. `resolveLeagueConnection` (`services/api/src/providers/sleeper-provider.ts`) stores `seasonYear: Number(league.season)`, so the connection is permanently bound to the stale season and ID.

**Fix (Sprint 10 or v1.5):** on a season transition (`season_type` → `'pre'`/`'regular'`), detect leagues whose stored `season_year` is behind the current NFL state and either (a) prompt the user to reconnect, or (b) auto-re-resolve via the user's Sleeper `user_id`, which is stable across seasons — `leagues` already stores `external_owner_id` (Sprint 3), so re-resolving by owner rather than league ID is viable without re-prompting for a username.

**Impact if unfixed:** Every league connected between now and the new-season renewal window becomes stale in August and requires a manual disconnect/reconnect. Related to (but distinct from) the resolved offseason roster-fallback sync issue — renewal is a different mechanism (`league_id` / `season_year`), not matchup availability.

### Sleeper `season_start_date` / `season_type` are unreliable for display (Sprint 10 Phase 2 / 2.5) — RESOLVED Sprint 10 Phase 2.5

**Symptom:** State 4a copy asserted the regular season begins on `season_start_date`; during `'pre'` that field returns the **preseason** opener (e.g. 2026-08-06 vs. the actual Sept 9 regular-season start), making the copy false. Separately, Sleeper's `season_type` runs **ahead of actual games** — e.g. on Aug 3 2026 it already reports `'pre'` while the first preseason kickoff is Aug 6 — so keying Home's eyebrow off `season_type` showed PRESEASON too early.

**Root cause:** Sleeper's `/state/nfl` calendar fields track Sleeper's internal phase labels, not schedule ground truth. `season_start_date` appears phase-relative; `season_type` flips before the corresponding games begin. Both also change annually.

**Fix:** Home keys off schedule-derived `display_phase` + `preseason_start` / `regular_season_start` on `GET /state/nfl` (MIN kickoffs from seeded `games`, ET calendar day). `season_type` and `season_start_date` remain as Sleeper passthrough for engine/ingestion / metadata — never for Home display. When Sportradar ingestion lands, openers (and eventually season end) come from that schedule source instead of the ESPN seed.

**Resolution (Sprint 10 Phase 2.5):** Home and `/games?week=` key off `display_phase`; State 4a copy uses opener date-only fields. Remaining gap: `display_phase` has no season-end bound (separate open entry below).

### display_phase has no season-end bound — 2027 offseason will render as 'regular'

**Symptom:** `display_phase` is derived as `'regular'` whenever today >= `regular_season_start`, with no upper bound. After the 2026 season ends, the phase remains `'regular'` through the 2027 offseason, so Home runs the live state machine against an empty schedule instead of showing the offseason panel.

**Root cause:** the derivation bounds the season's start (from seeded openers) but not its end.

**Fix (with the annual reseed workflow / Sportradar ingestion):** derive a season end from schedule data — either the last seeded game's date, or the NEXT season's `preseason_start` once the schedule is reseeded — and treat today > season_end as `'off'`. Deferred because the correct fix depends on the annual reseed workflow, which doesn't exist yet.

**Trigger date:** first surfaces after the 2026 season concludes (~Jan 2027).

### NFL schedule seed must be refreshed each season (Sprint 10 Phase 2.5)

**Symptom:** Phase openers and Home States 3–4 kickoffs come from `data/nfl-schedule-YYYY.json` seeded into `games`. A stale file silently serves last year's dates.

**Root cause:** Until Sportradar ingestion (Sprint 2) owns the schedule, the committed ESPN-derived JSON + `pnpm seed:schedule` is the schedule source. Kickoffs and openers change annually.

**Fix:** each season, run `pnpm fetch:nfl-schedule` (regenerates the JSON from ESPN's public scoreboard), commit the new `data/nfl-schedule-YYYY.json`, and re-run `pnpm seed:schedule`. Sportradar ingestion eventually replaces this seed as the schedule source.

**Impact if unfixed:** State 4a shows wrong opener dates; States 3–4 show wrong kickoffs after the calendar rolls.

### App had competing accent colors and unthemed auth screens — RESOLVED (pre-Sprint-10, Phases 2a/2b)

**Symptom:** The (auth) screens rendered on a white background with dark text while the (app) screens were hand-rolled dark mode, causing a jarring white flash on sign-in → Home. Three different blues (#1f6feb, #5aa2ff, #0A66FF) were all used as "the" accent across 20 files, with no shared theme layer.

**Root cause:** No design-token module existed; each screen hardcoded its own hex literals (~134 across the app).

**Fix (RESOLVED):** Introduced app/lib/theme.ts — a single dark-only token layer (colors, spacing, radii, type scale) with one amber accent (#FFB020) that no NFL team owns as a primary. Migrated every (auth), (app), component, and context file onto the tokens; the only remaining hex literals are team colors flowing from server data. Auth screens now share the dark base (no white flash) and the type scale is honest across all screens.

### Connecting a league from Settings leaves the Settings screen mounted under Home — RESOLVED Sprint 10 Phase 4

**Symptom:** Using "Connect another team" from Settings → connect → on success, the new Home renders on top of a still-mounted Settings screen (previous screen visible at top edge). Cosmetic; resolves on next navigation.

**Root cause:** connect-team's onConnected does router.replace('/(app)'), which swaps only the current (pushed) connect-team screen for Home but does not dismiss the Settings screen beneath it on the stack.

**Fix (Phase 3 navigation restructure):** on connect success, reset navigation to Home as root (dismiss the full Settings→connect stack) rather than replace() the top screen. Belongs with the deferred onboarding/routing work, not a standalone patch.

**Resolution (Sprint 10 Phase 4):** non-onboarding connect uses `navigateAfterConnect` → `dismissTo('/(app)')`; onboarding continues the chain then `resetToHomeRoot` from all-set.

---

## 14. v1.5 Roadmap

Target: 3 months after v1 ships (mid-season).
 
### Features
 
- **Multi-stream split-screen view** (1 + 2 thumbnails on mobile)
- **Subscription billing** (StoreKit integration, Pro tier)
- **Multi-league support** (lineup tab gets league selector)
- **Multi-platform fantasy providers** (Yahoo, ESPN) — see the "Multi-platform
  fantasy" subsection below for the per-provider integration reality and the
  Yahoo-vs-ESPN priority discussion; these are NOT equal-difficulty and each
  is effectively its own sprint, prioritized by v1 user demand.
- **Auto-switch toggle** (functional in settings)
- **Star players** (functional in switching engine, not just stored)
- **Notification batching** (collapse multiple events in 10s window)
- **Push receipt polling** (clears stale tokens automatically — see Known Issues)
- **Android version** (same React Native codebase)
- **Missed plays screen** (replay history of flag events)
- **Screen Mirroring reframe** (idea only — not committed, needs UX design first).
  See below.

### Screen Mirroring reframe (unbuilt idea, needs its own UX design)

Recorded so the Sprint 8 cast finding leaves behind an idea rather than just a
cut. **This is not a scheduled v1.5 feature** — it is a sketch with an unproven
premise, listed here to be designed or discarded on purpose rather than
rediscovered.

The Sprint 8 goal was for the *app* to cast, which requires rights we do not
have (Section 2, Known Issues). The reframe inverts it: the **user** turns on
Screen Mirroring from Control Center, and the phone becomes a mirrored surface
we are then free to compose, since we are only ever routing our own UI. The app
would stop trying to control the TV and instead be worth looking at on one.

Why it is unproven, and what would need designing:
- It rests on the user having already enabled mirroring. An app cannot start it,
  so the whole flow depends on an instruction step outside our control — the
  most likely place for it to fail as a product.
- Mirroring shows our UI, so this only pays off if there is something worth
  showing on a TV. That is a new screen design (a lean-back multi-game board?),
  not a setting.
- Interaction model is unresolved: mirrored means the phone shows exactly what
  the TV shows, so the "remote" and the "display" are the same surface. Making
  the phone a distinct controller needs a second output path, which is a
  materially larger piece of work.
- Deep-linking into a streaming app ends the mirrored experience — that app
  takes over the screen. So this idea and the shipping deep-link flow may be
  mutually exclusive modes rather than complementary, which is a product
  decision before it is an engineering one.

### Architecture changes
 
- New `PlaybackSource` modes for split-screen rendering
- Billing integration via Supabase Edge Functions or RevenueCat
- WebSocket message: `flag_batch` for combined events
- Multi-league lineup cache: `user_lineup_cache:{user_id}:{week}:{league_id}`
- Push receipt-polling worker + a persisted-ticket-id table (new state, `expo_push_token` cleared on confirmed `DeviceNotRegistered`)
### Multi-platform fantasy
 
v1 ships Sleeper + manual entry only. Sleeper was chosen first because its API
is public, keyless, and username-addressable (`/v1/user/{username}/leagues/...`)
— a new provider like that is trivial behind the existing `FantasyProvider`
interface (Section 6). The other two platforms are NOT like Sleeper, and are
listed here in rough order of integration feasibility:
 
- **Yahoo Fantasy** — official API, but requires full OAuth 2.0 three-legged
  auth (registered app credentials, per-user token storage + refresh). Real
  infrastructure, but a sanctioned and stable path.
- **ESPN Fantasy** — no official public API. Integration relies on undocumented
  endpoints (via the `cwendt94/espn-api` wrapper) and cookie-based auth
  (`espn_s2` / `SWID` cookies the user extracts from their browser). Brittle
  (breaks on ESPN changes without notice, has been observed deleting
  historical league data) and a rough onboarding UX (asking users to paste
  browser cookies). Higher risk, higher maintenance than Yahoo per-integration.
  **Additional cost not shared with Yahoo/Sleeper:** the wrapper is Python-only
  with no Node equivalent, so this provider can't be pure "another
  `FantasyProvider` implementation" inside the existing Fastify/Node backend —
  it requires standing up a second, ESPN-only runtime (Section 6's deployment
  topology has no Python process today) that the Node backend calls into.
**Priority reversal (flagged mid-2026, not yet acted on):** the original
"Yahoo first, ESPN second" ordering above was ranked by integration quality
(sanctioned auth beats cookie-scraping). That ordering predates ESPN Fantasy
Football becoming the NFL's official fantasy game for the 2026 season
(announced July 16, 2026) — the NFL retired NFL Fantasy entirely and migrated
its user base to ESPN, making ESPN the largest platform by a wide margin.
User-base size is a real argument for building ESPN first despite the worse
integration path and the added Python-runtime cost above. This is captured
here as an open decision, not resolved — see sequencing rationale below.
 
NFL Fantasy is removed from this list: it no longer exists as a standalone
platform (retired into ESPN, per above).
 
Sequencing rationale: multi-platform fantasy is deliberately deferred out of
v1 (and out of the Sprint 10 shipping sprint) so v1 validates the core
switching-engine thesis with real users on Sleeper first. Provider priority
post-v1 should still be driven by which platform v1 users actually ask for,
not built speculatively — the user-base argument above is a prior, not a
substitute for actual demand signal. Do not build either Yahoo or ESPN
speculatively before v1 has users. The `FantasyProvider` abstraction
(Section 6) must stay clean so each slots in without touching the engine,
dispatcher, or UI. Each provider is scoped as its own sprint when demand
justifies it; revisit the Yahoo-vs-ESPN ordering at that point with real
usage data rather than deciding it now.
 
### Future stake sources (incl. sports betting) — post-v1, requires legal + partnership review
 
Reframe: this app's core mechanic is not fantasy-specific — the engine flags
live game moments a user has a STAKE in. Fantasy lineup is v1's only stake
source; the same engine can be driven by other stake types. Multi-platform
fantasy (Yahoo/ESPN/NFL, see previous subsection) is one axis. A second,
higher-value-but-harder axis is **sports betting slips**:
 
- **DraftKings / FanDuel / etc.** — link a user's placed bets so the app flags
  games those bets are live in ("your same-game parlay is playing out now").
  This is what makes PRESEASON meaningful: Sleeper has no preseason lineup, so
  fantasy can't drive preseason flags, but betting stakes can (Sportradar does
  cover preseason games).
Hard constraints — why this is post-v1, not near-term:
- **API access is closed/partner-gated.** DraftKings and FanDuel do not offer
  open public read APIs for a user's bets; access likely requires a commercial
  partnership or is unavailable. Categorically harder than Yahoo OAuth.
- **Regulatory exposure.** Ingesting bets and pushing "your bet is live"
  notifications moves the app into gambling-adjacent territory: state-by-state
  gambling regs, responsible-gambling requirements, age verification, stricter
  App Store review for real-money-gambling-adjacent apps. Requires legal review
  BEFORE any build — this is not an engineering-only decision.
Architecture note (do now, cheaply): the engine's input type should generalize
so a betting stake isn't awkward to add later. Today `UserLineupCache`
(Section 8) is fantasy-shaped (teamPositions / playerToTeam / starPlayerIds)
and `FlagReasonType` enumerates fantasy reasons (offense_active, etc.). A
betting stake ("parlay live in game Z", "player X to score") doesn't map onto
position units. When betting is built, the engine's stake-input type and
FlagReasonType must generalize beyond fantasy positions. No change required in
v1 — this is a flagged seam, not a task. Keep the FantasyProvider boundary
clean and avoid letting fantasy-specific assumptions leak deeper into the
engine's core types than they already have.

---

## 15. Phase 2 Strategy

Target: Year 2. Goal is to replace deep-link/cast with native embedded streaming.

### Partnership priorities (in order)

1. **Sportsbook integration** — DraftKings, FanDuel, ESPN Bet, Caesars
   - These have limited NFL streaming embedded in their products
   - Hungry for engagement-driving integrations
   - Most realistic path
   - Revenue model: rev share on bet activity driven from app

2. **NFL+ partnership** — NFL-owned streaming product
   - Needs differentiation, lacks fantasy-aware features
   - Complementary positioning
   - Revenue model: licensing fee or subscriber rev share

3. **YouTube TV / Sunday Ticket** — Google
   - Home run partnership
   - Requires significant traction to even open the conversation
   - Revenue model: licensing or integration fee

### Architecture changes for Phase 2

The `PlaybackSource` interface absorbs the change:

```typescript
class EmbeddedStreamPlaybackSource implements PlaybackSource {
  id = 'embedded' as const;
  
  canPlay(game: Game, userContext: UserContext): boolean {
    return userContext.partner === 'draftkings' 
        && this.partnerStreamAvailable(game);
  }
  
  async createSession(game: Game): Promise<VideoSession> {
    // Use partner SDK to embed stream
  }
}
```

Register new source. Update `decideAction` to prefer embedded sources. UI gets a new video player view. Nothing else changes.

### Validation metrics for partnership pitch

After v1 ships, track:
- Weekly active users during NFL season
- Average notifications acted on per user per Sunday
- Average switches per user per Sunday
- Retention week over week

Aim for 30K+ WAU and 60%+ retention through the season to have a credible partnership conversation.

---

## Appendix: Quick Reference

### Stack at a glance
- iOS: React Native + Expo + TypeScript
- Backend: Node.js + Fastify + TypeScript
- DB: Supabase Postgres
- Cache: Upstash Redis
- Push: Expo Notifications
- Host: Fly.io
- Data: Sportradar (NFL play-by-play), Sleeper (fantasy)
- Cast: cut in v1 (no video rights — Section 2); native AirPlay module present but dormant

### Key files / modules (expected)
- `services/ingestion/` — Sportradar consumer
- `services/engine/` — switching engine
- `services/dispatcher/` — deferred event firing
- `services/api/` — REST + WebSocket server
- `app/screens/` — iOS screens
- `app/playback/` — `PlaybackSource` implementations
- `shared/types/` — shared TS types

### Critical constants
- Stream lag table: see Section 8
- Priority scoring: see Section 3
- Rate limit: max 3 notifications/minute/user
- Heartbeat interval: 30s (REST) + 25s ping (WebSocket)
- Game state stale threshold: 90s
- Notification banner auto-dismiss: 12s

---

*End of plan. This is the buildable specification for Pivot v1.*