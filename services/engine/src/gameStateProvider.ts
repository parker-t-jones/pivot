import type { FlagState, GameState } from '@roster-remote/shared';

/**
 * Hot-path state the engine reads/writes while processing plays (PLAN.md Section 8 `redis.*` calls +
 * the `users_with_stake` / `active_users` sets from Section 7). Hidden behind an interface so the
 * Redis-backed implementation lands in Sprint 5 without touching the engine (Section 2 swap-ready
 * principle). Sprint 4 ships the in-memory implementation only.
 */
export interface GameStateProvider {
  getGameState(gameId: string): Promise<GameState | null>;
  setGameState(gameId: string, state: GameState): Promise<void>;
  getUserFlagState(userId: string, gameId: string): Promise<FlagState | null>;
  setUserFlagState(userId: string, gameId: string, state: FlagState): Promise<void>;
  getActiveUsers(): Promise<string[]>;
  getUsersWithStakeIn(teamId: string): Promise<string[]>;
}

function flagKey(userId: string, gameId: string): string {
  return `${userId}:${gameId}`;
}

/** Plain-Map implementation for Sprint 4 tests and the replay pipeline. No cross-process persistence. */
export class InMemoryGameStateProvider implements GameStateProvider {
  private readonly gameStates = new Map<string, GameState>();
  private readonly flagStates = new Map<string, FlagState>();
  private readonly activeUsers = new Set<string>();
  private readonly stakes = new Map<string, Set<string>>();

  async getGameState(gameId: string): Promise<GameState | null> {
    return this.gameStates.get(gameId) ?? null;
  }

  async setGameState(gameId: string, state: GameState): Promise<void> {
    this.gameStates.set(gameId, state);
  }

  async getUserFlagState(userId: string, gameId: string): Promise<FlagState | null> {
    return this.flagStates.get(flagKey(userId, gameId)) ?? null;
  }

  async setUserFlagState(userId: string, gameId: string, state: FlagState): Promise<void> {
    this.flagStates.set(flagKey(userId, gameId), state);
  }

  async getActiveUsers(): Promise<string[]> {
    return [...this.activeUsers];
  }

  async getUsersWithStakeIn(teamId: string): Promise<string[]> {
    return [...(this.stakes.get(teamId) ?? [])];
  }

  // --- Seeding helpers (not part of the interface; used to set up replay/tests) ---

  addActiveUser(userId: string): void {
    this.activeUsers.add(userId);
  }

  addStake(teamId: string, userId: string): void {
    const users = this.stakes.get(teamId) ?? new Set<string>();
    users.add(userId);
    this.stakes.set(teamId, users);
  }
}
