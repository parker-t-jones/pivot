import { randomUUID } from 'node:crypto';
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
  userId: string;
  gameId: string;
  eventType: 'flag_added' | 'flag_removed' | 'priority_increased' | 'priority_decreased';
  /**
   * ESPN play id of the play that produced the event. `FlagEvent` does not carry it; the handler
   * passes it into dispatch. Null does not participate in the dedupe key — Postgres UNIQUE treats
   * NULLs as distinct, and live events set this.
   */
  triggeringPlayId: string | null;
  priorityScore: number;
  reasons: FlagReason[];
  firedAt: number;
  deliveredAt: number;
}

export interface StoredFlagEvent extends PersistedFlagEventInput {
  /** `flag_events.id` from `gen_random_uuid()`. Not the engine `FlagEvent.id`. */
  id: string;
}

export type PersistFlagEventResult = { inserted: true; id: string } | { inserted: false };

/** The push body saved with a failed send so a later retry does not rebuild it. */
export interface PushRetryPayload {
  token: string;
  title: string;
  body: string;
  data: unknown;
}

export interface PendingPushRetry {
  id: string;
  userId: string;
  /** Clock at the `flag_events` insert. Age is measured from here. */
  deliveredAt: number;
  attempts: number;
  payload: PushRetryPayload;
}

export type PushOutcome =
  | { id: string; status: 'sent' }
  | { id: string; status: 'dropped' }
  | {
      id: string;
      status: 'pending';
      userId: string;
      deliveredAt: number;
      attempts: number;
      lastError: string;
      nextAttemptAt: number;
      payload: PushRetryPayload;
    };

export interface PushOutcomeRecord {
  id: string;
  status: 'sent' | 'pending' | 'dropped';
  userId: string;
  deliveredAt: number;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number | null;
  payload: PushRetryPayload | null;
}

export interface FlagEventPersistence {
  persistFlagEvent(input: PersistedFlagEventInput): Promise<PersistFlagEventResult>;
  recordPushOutcome(outcome: PushOutcome): Promise<void>;
  duePushRetries(now: number): Promise<PendingPushRetry[]>;
}

function dedupeKey(input: PersistedFlagEventInput): string | null {
  if (input.triggeringPlayId === null) return null;
  return `${input.userId}\0${input.gameId}\0${input.eventType}\0${input.triggeringPlayId}`;
}

/** Records inserted flag events. A repeated non-null dedupe key inserts nothing. */
export class InMemoryFlagEventPersistence implements FlagEventPersistence {
  readonly records: StoredFlagEvent[] = [];
  private readonly seenKeys = new Set<string>();
  private readonly pushOutcomes = new Map<string, PushOutcomeRecord>();

  async persistFlagEvent(input: PersistedFlagEventInput): Promise<PersistFlagEventResult> {
    const key = dedupeKey(input);
    if (key !== null && this.seenKeys.has(key)) return { inserted: false };
    if (key !== null) this.seenKeys.add(key);
    const id = randomUUID();
    this.records.push({ ...input, id });
    return { inserted: true, id };
  }

  pushOutcome(id: string): PushOutcomeRecord | undefined {
    return this.pushOutcomes.get(id);
  }

  async recordPushOutcome(outcome: PushOutcome): Promise<void> {
    const existing = this.pushOutcomes.get(outcome.id);
    if (outcome.status === 'sent' || outcome.status === 'dropped') {
      this.pushOutcomes.set(outcome.id, {
        id: outcome.id,
        status: outcome.status,
        userId: existing?.userId ?? '',
        deliveredAt: existing?.deliveredAt ?? 0,
        attempts: existing?.attempts ?? 0,
        lastError: existing?.lastError ?? null,
        nextAttemptAt: null,
        payload: existing?.payload ?? null,
      });
      return;
    }
    this.pushOutcomes.set(outcome.id, {
      id: outcome.id,
      status: 'pending',
      userId: outcome.userId,
      deliveredAt: outcome.deliveredAt,
      attempts: outcome.attempts,
      lastError: outcome.lastError,
      nextAttemptAt: outcome.nextAttemptAt,
      payload: outcome.payload,
    });
  }

  async duePushRetries(now: number): Promise<PendingPushRetry[]> {
    const due: PendingPushRetry[] = [];
    for (const item of this.pushOutcomes.values()) {
      if (item.status !== 'pending' || item.nextAttemptAt === null || item.payload === null)
        continue;
      if (item.nextAttemptAt > now) continue;
      due.push({
        id: item.id,
        userId: item.userId,
        deliveredAt: item.deliveredAt,
        attempts: item.attempts,
        payload: item.payload,
      });
    }
    return due;
  }
}
