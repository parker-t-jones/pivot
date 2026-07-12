# Fantasy Sports Command Center — Build Plan

A spec for building a fantasy-aware NFL viewing app. v1 ships as a fantasy command center that routes users to the right games (via deep-link or TV cast) based on real-time fantasy lineup activity. Architecture is designed to swap into native streaming when partnership deals are landed in Phase 2.

This document is the source of truth for the build. Sections are organized so each can be referenced independently by Cursor when working on a given module.

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

**Product.** A mobile app that monitors live NFL games and the user's fantasy football lineup, then surfaces real-time notifications when their fantasy players become active on the field. The user can switch their viewing (on phone or TV) to the relevant game in one tap.

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
2. **Aggregator with deep-linking** — routes users into existing apps. ← v1 fallback mode
3. **Phone-as-remote** — controls TV streaming via AirPlay/Chromecast. ← v1 primary mode
4. **Native streaming via partnership** — Phase 2 destination

### Three-phase roadmap

**Phase 1 (Year 1) — bridge.** Ship v1 with phone-as-remote + deep-link fallback. Prove the engagement hypothesis.

**Phase 2 (Year 2) — unlock.** Land a partnership with a sportsbook, NFL+, or rights holder. Replace the deep-link/cast layer with native embedded streaming. Engine, lineup logic, notifications, and UI all unchanged.

**Phase 3 (Year 3+) — expand.** Multi-sport, deeper analytics, original content.

### Swap-ready architecture principle

Every external boundary in v1 is hidden behind an interface so Phase 2 swaps are local changes:

- `PlaybackSource` interface — `DeepLinkPlaybackSource`, `AirPlayPlaybackSource`, `ChromecastPlaybackSource` in v1; `EmbeddedStreamPlaybackSource` added in Phase 2.
- `FantasyProvider` interface — `SleeperProvider` and `ManualProvider` in v1; ESPN, Yahoo, NFL Fantasy added later.
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
- AirPlay control to Apple TV
- Chromecast control to Google/Android TV
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
| Cast | react-native-google-cast + native AirPlay | Standard libraries |
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
| `created_at` | timestamptz | |

> **Sprint 3 divergence:** `external_owner_id` and `external_roster_id` were added during Sprint 3 implementation. They weren't in the original spec but are required to map a connected Sleeper account to the correct roster within a league (a league has many rosters; only one belongs to the connecting user). Both are `NULL` for `platform = 'manual'` leagues.

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
| `week` | int | indexed |
| `scheduled_start` | timestamptz | indexed |
| `home_team_id` | uuid | FK → teams |
| `away_team_id` | uuid | FK → teams |
| `status` | text | `'scheduled' \| 'in_progress' \| 'final' \| 'postponed'` |
| `venue` | text | nullable |

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
game_state:{game_id}              hash → { possession_team_id, unit_on_field, 
                                            score_home, score_away, quarter, 
                                            time_remaining_sec, in_red_zone, 
                                            updated_at }

user_flagged_games:{user_id}      sorted set → { game_id : priority_score }
                                  (highest score = current primary)

user_lineup_cache:{user_id}:{week} hash → { team_id : [position_categories] }
                                  e.g., { "IND": ["offense"], "BAL": ["offense", "defense"] }

users_with_stake:{team_id}        set → user_ids with any player on this team

active_users                      set → user_ids with viewing session in last 5 min

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
| `POST` | `/leagues/:id/sync` | Force refresh from Sleeper |
| `GET` | `/leagues/:id/lineup?week={w}` | Get lineup for week |
| `PUT` | `/leagues/:id/lineup` | Replace lineup for week |
| `GET` | `/players/search?q={q}&position={p}` | Player autocomplete |
| `POST` | `/leagues/:id/stars` | Set star players |

**`GET /leagues/:id/lineup` response:**
```typescript
{
  league_id: string,
  week: number,
  last_synced_at: string,
  slots: Array<{
    slot_id: string,
    slot_type: 'starter' | 'bench' | 'flex' | 'idp',
    position_in_lineup: string,
    player: {
      player_id: string,
      first_name: string,
      last_name: string,
      position: string,
      team: { team_id: string, abbreviation: string, name: string }
    },
    is_star: boolean
  }>
}
```

#### Games & state

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/games?week={w}` | This week's schedule with broadcasts |
| `GET` | `/games/:id` | One game with current state |
| `GET` | `/games/live` | All games in progress |
| `GET` | `/games/:id/broadcasts` | Broadcast sources filtered by user's app presence |

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
    flagged_player_ids: string[],
    game: { /* abbreviated game state */ },
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
    user_id: string,
    game_id: string,
    event_type: 'flag_added' | 'flag_removed' | 'priority_increased' | 'priority_decreased',
    old_state: FlagState | null,
    new_state: FlagState,
    action: {
      type: 'prompt' | 'auto_switch' | 'in_app_indicator' | 'notify_only' | 'prompt_low_priority',
      cta: 'switch_primary' | 'add_to_split' | 'dismiss' | null,
      recommended_source: string,
      deep_link_url: string
    },
    game_summary: {
      home_team: string,
      away_team: string,
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

Three-tab bottom navigation:
1. **Home** — live games dashboard (opens here on launch)
2. **Lineup** — fantasy team and live points
3. **Settings** — preferences, leagues, account

### Onboarding (6 screens, ~2 min total)

**1. Welcome.** Value prop sentence + "Get started" button.

**2. Sign up / sign in.** Email + password + Sign in with Apple.

**3. Connect fantasy team.** Two options:
- *Connect Sleeper* — username input → league picker → persist
- *Add manually* — lineup builder with player search

**4. Streaming services.** Multi-select grid of services (Sunday Ticket, ESPN+, Paramount+, Peacock, Prime, NFL+, broadcast TV). Writes to `user_app_presence`.

**5. Notifications.** Pre-permission screen explaining why before triggering iOS prompt.

**6. All set.** Confirmation with CTA to today's games or weekly schedule.

### Home screen — five states

#### State 1: Active games with flags (Sunday afternoon)

Top to bottom:

- **"Now active" card** (large, dominant): teams + score, game state strip, possession indicator, reason chip ("Jonathan Taylor active — RB — Colts offense"), primary CTA button ("Watch on Sunday Ticket" or "Cast to Apple TV"), secondary "Or use..." link
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
- Cast target unreachable: "Couldn't reach your Apple TV..." with retry
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
- `PlaybackSource` interface
- `DeepLinkPlaybackSource` implementation
- `BroadcastResolver` server-side logic
- Game broadcast routing UI on Home
- Goal: tapping "Switch" opens correct streaming app at correct game

### Sprint 8: AirPlay + Chromecast sources
- `AirPlayPlaybackSource` via native iOS APIs
- `ChromecastPlaybackSource` via react-native-google-cast
- Cast target detection on app launch
- "Cast to TV" CTA on Home when target detected
- Goal: phone-as-remote experience works

### Sprint 9: Polish & shipping
- All empty/loading/error states
- Settings screen complete
- Onboarding polish
- Star player UI (data layer only)
- Real-world testing on Sundays during preseason
- App Store submission

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
2. **Deep-link availability per service.** Audit needed before Sprint 7.
3. **v1.5 subscription price point.** Suggested range $9.99–14.99/month, defer to market research.
4. **Launch marketing strategy.** Out of scope for this plan.
5. **TestFlight beta cohort.** Likely 50–100 users for August preseason testing.
6. **Terms of service & privacy policy.** Lawyer review needed before App Store submission.
7. **Whether to soft-pitch a sportsbook partner pre-launch.** Could compress Phase 2 timeline.

---

## Known Issues

### Sleeper sync fails during the offseason/preseason — must fix before v1 launch

**Symptom:** Both the best-effort initial sync run by `POST /leagues/sleeper` (connect flow) and an explicit `POST /leagues/:id/sync` fail with a `sleeper_matchup_not_found` error whenever the NFL is in the offseason or preseason. In the connect flow this is caught and logged, so it fails silently — the league gets created but its lineup stays empty; via a direct `/sync` call it surfaces as a 404 to the client.

**Root cause:** Sync always targets the current week reported by Sleeper's `/v1/state/nfl` (`services/api/src/lib/nfl-state.ts`). When `season_type` is `'off'` or `'pre'`, that week is `0`. Sleeper's `/league/{id}/matchups/0` has no matchup data for week 0, so `SleeperProvider.fetchLineup` (`services/api/src/providers/sleeper-provider.ts`) can't find a matchup for the roster and throws `sleeper_matchup_not_found`.

**Fix options (pick one before regular season starts):**
1. Guard `syncLeagueLineup` (`services/api/src/lib/lineup-sync.ts`) and the sync routes to no-op — or return a distinct `season_not_active`-style response — when `nflState.seasonType` is `'off'` or `'pre'`, instead of attempting a matchup fetch that can't succeed.
2. Fall back to `GET /league/{id}/rosters` (the roster's static `players` list, with no `starters`/week-scoping) when there's no matchup data yet, so the app can show *something* — even if not yet slotted into starter/bench positions — before Week 1 matchups exist.

**Impact if unfixed:** Leagues are typically drafted in August, well before Week 1. A user connecting a Sleeper league during that window — a very common flow — sees an empty lineup screen with no path to a populated one until Sleeper publishes Week 1 matchup data.

### Stale flag state when a user goes inactive mid-game (Sprint 4 discovery) — resolve in Sprint 5

**Symptom:** `onPlayEvent` (`services/engine`) only recomputes flag state for users in `getActiveUsers()`. The Section 8 "game ends → fire `flag_removed` for every flagged user" behavior therefore fires only for users still active at the whistle. A user who was flagged but went inactive before the game ended keeps a `flagged: true` `FlagState` in the store and never receives the `flag_removed`.

**Fix (Sprint 5):** the deferred-firing dispatcher's `isStillRelevant` re-validation must gate on liveness — drop/expire events for users who are no longer active, and don't trust a stored `flagged` state without confirming the user is live. Acceptable for v1 in isolation (an inactive user has no session to switch), but the dispatcher and cold-start resolver must not treat stale flagged state as truth.

### Stored `FlagState` is not ground truth — `/flags/current` must recompute (Sprint 4 discovery)

**Symptom:** Per Section 8, `onPlayEvent` persists a user's `FlagState` only when a diff crosses the event threshold (flag added/removed, or priority delta ≥ ±3). Sub-threshold priority drift is intentionally *not* persisted, so the stored `priorityScore` can lag the true current value by up to ±2, and the stored `reasons` can be slightly stale.

**Fix (Sprint 5+):** `GET /flags/current` (the cold-start endpoint) must recompute fresh from `(lineup, gameState)` via `computeFlagState` rather than reading the stored `FlagState`. Only the WebSocket delta stream should rely on the diff-persisted state. Don't let any consumer treat the stored score as authoritative.

### `scheduledFireAt` is a placeholder (Sprint 4) — Sprint 5 dispatcher owns the real value

**Symptom:** The engine sets `FlagEvent.scheduledFireAt = newState.computedAt` as a placeholder. Real deferred firing (stream-lag calibration per `BROADCAST_LAG_SECONDS`, Section 8) is out of scope for Sprint 4.

**Fix (Sprint 5):** the dispatcher's `scheduleFlagEvent` overwrites `scheduledFireAt` with `Date.now() + lag`. Nothing downstream should treat the engine-emitted value as authoritative timing.

### IDP support (v1.5+) requires per-player position categories in the lineup cache (Sprint 4 note)

**Symptom:** `UserLineupCache` tracks offense/defense position categories at the *team* level (`teamPositions`), not per player. `computeFlagState`'s `playerIdsOnTeam` therefore returns all of a user's players on a team and relies on `teamPositions` gating to enforce the offense-vs-defense distinction. This is exact for v1 (a team is either the user's offense stake or defense stake), but breaks with IDP, where a single team can have both offensive and individual defensive players the engine must distinguish per player.

**Fix (v1.5+, when IDP lands):** grow `UserLineupCache` to carry per-player position categories and update `playerIdsOnTeam` to filter a team's players by the requested category. IDP is explicitly out of scope for v1 (Section 4).

---

## 14. v1.5 Roadmap

Target: 3 months after v1 ships (mid-season).

### Features

- **Multi-stream split-screen view** (1 + 2 thumbnails on mobile)
- **Subscription billing** (StoreKit integration, Pro tier)
- **Multi-league support** (lineup tab gets league selector)
- **Auto-switch toggle** (functional in settings)
- **Star players** (functional in switching engine, not just stored)
- **Notification batching** (collapse multiple events in 10s window)
- **Android version** (same React Native codebase)
- **Missed plays screen** (replay history of flag events)

### Architecture changes

- New `PlaybackSource` modes for split-screen rendering
- Billing integration via Supabase Edge Functions or RevenueCat
- WebSocket message: `flag_batch` for combined events
- Multi-league lineup cache: `user_lineup_cache:{user_id}:{week}:{league_id}`

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
- Cast: react-native-google-cast + native AirPlay

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

*End of plan. This is the buildable specification for v1.*