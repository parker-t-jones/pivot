import type { FlagReason, Preferences } from '@pivot/shared';

/**
 * Structural interfaces the dispatcher needs from the `users`/`viewing_sessions`/`games`/`teams`/
 * `players`/`flag_events` tables. Declared here (rather than importing `@pivot/api` and its
 * generated `database.types.ts`) so the dispatcher package stays free of a dependency on the API
 * package (sprint decision #9 — dependencies run api -> dispatcher, never the reverse); this mirrors
 * the engine's `LineupCacheReader` pattern from Sprint 4.
 *
 * Only in-memory reference implementations ship in this file. The concrete Postgres-backed adapters
 * are wired from `services/api` once their backing tables exist and have a real caller:
 *  - `FlagEventPersistence` -> Phase 3, once the `flag_events` migration lands.
 *  - `UserDirectory.getViewingSession` -> Phase 6, once the `viewing_sessions` migration lands.
 *  - `UserDirectory.getUser` / `GameCatalog` / `PlayerCatalog` -> whichever of Phase 4/5/6's wiring
 *    steps first assembles the composed dispatcher against a real Supabase client (`users`, `games`,
 *    `teams`, `players` all already exist from earlier sprints, but there's no reason to write an
 *    adapter before it has a caller).
 */

// --- Users & viewing sessions (Section 8 `getUser` / `getViewingSession` / `getUserPrefs`) ---

export interface DispatchUser {
  id: string;
  subscriptionTier: 'free' | 'pro';
  preferences: Preferences;
  /** `users.expo_push_token` (Section 7) — `null` when unset. Sprint 6 Phase 3: `deliverFlagEvent`
   *  skips the push send entirely when this is `null`, same as Section 8's pseudocode gate. */
  expoPushToken: string | null;
}

export interface ViewingSessionSnapshot {
  primaryGameId: string | null;
  primaryPriorityScore: number | null;
}

export interface UserDirectory {
  getUser(userId: string): Promise<DispatchUser | null>;
  getViewingSession(userId: string): Promise<ViewingSessionSnapshot | null>;
}

export class InMemoryUserDirectory implements UserDirectory {
  private readonly users = new Map<string, DispatchUser>();
  private readonly sessions = new Map<string, ViewingSessionSnapshot>();

  async getUser(userId: string): Promise<DispatchUser | null> {
    return this.users.get(userId) ?? null;
  }

  async getViewingSession(userId: string): Promise<ViewingSessionSnapshot | null> {
    return this.sessions.get(userId) ?? null;
  }

  setUser(user: DispatchUser): void {
    this.users.set(user.id, user);
  }

  setViewingSession(userId: string, session: ViewingSessionSnapshot): void {
    this.sessions.set(userId, session);
  }
}

// --- Game & player catalogs (envelope enrichment: Section 9 `game_summary` / `flagged_players`) ---

export interface GameSummaryInfo {
  homeTeamAbbreviation: string;
  awayTeamAbbreviation: string;
  /** `teams.name` (Section 7) — Sprint 6 Phase 3 addition. Notification copy (Section 10's "Colts
   *  have the ball") reads by team nickname, not abbreviation; the WebSocket `flag_event`/`/flags/current`
   *  `game_summary` payload also gains `home_team_name`/`away_team_name` alongside the existing
   *  abbreviation fields (additive — see `gameSummary.ts`). */
  homeTeamName: string;
  awayTeamName: string;
  /** `teams.primary_color`/`secondary_color` (Section 7, `NOT NULL text` hex) — Sprint 9 Phase 1
   *  addition, closing the "team color flash not implemented" Known Issue (Section 13). Feeds the
   *  `game_summary` builder (`gameSummary.ts`) so the client can drive the switching-transition
   *  accent color; additive, same pattern as the Sprint 6 name fields above. */
  homeTeamPrimaryColor: string;
  homeTeamSecondaryColor: string;
  awayTeamPrimaryColor: string;
  awayTeamSecondaryColor: string;
}

export interface GameCatalog {
  getGameSummary(gameId: string): Promise<GameSummaryInfo | null>;
}

export class InMemoryGameCatalog implements GameCatalog {
  private readonly games = new Map<string, GameSummaryInfo>();

  async getGameSummary(gameId: string): Promise<GameSummaryInfo | null> {
    return this.games.get(gameId) ?? null;
  }

  setGame(gameId: string, info: GameSummaryInfo): void {
    this.games.set(gameId, info);
  }
}

export interface PlayerInfo {
  playerId: string;
  firstName: string;
  lastName: string;
  position: string;
}

export interface PlayerCatalog {
  getPlayers(playerIds: string[]): Promise<PlayerInfo[]>;
}

export class InMemoryPlayerCatalog implements PlayerCatalog {
  private readonly players = new Map<string, PlayerInfo>();

  async getPlayers(playerIds: string[]): Promise<PlayerInfo[]> {
    return playerIds.flatMap((id) => {
      const player = this.players.get(id);
      return player ? [player] : [];
    });
  }

  setPlayer(info: PlayerInfo): void {
    this.players.set(info.playerId, info);
  }
}

// --- `flag_events` persistence (Phase 3 migration; concrete Supabase adapter lands alongside it) ---

export interface PersistedFlagEventInput {
  id: string;
  userId: string;
  gameId: string;
  eventType: 'flag_added' | 'flag_removed' | 'priority_increased' | 'priority_decreased';
  /** Section 8's `FlagEvent` (frozen Sprint 4 shared type) carries no play id, so this is always
   *  `null` for now — see PLAN.md Section 7 `flag_events.triggering_play_id` (nullable). */
  triggeringPlayId: string | null;
  priorityScore: number;
  reasons: FlagReason[];
  firedAt: number;
  deliveredAt: number;
}

export interface FlagEventPersistence {
  persistFlagEvent(input: PersistedFlagEventInput): Promise<void>;
}

export class InMemoryFlagEventPersistence implements FlagEventPersistence {
  readonly records: PersistedFlagEventInput[] = [];

  async persistFlagEvent(input: PersistedFlagEventInput): Promise<void> {
    this.records.push(input);
  }
}
