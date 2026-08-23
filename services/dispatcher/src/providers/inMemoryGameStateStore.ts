import type { FlagState, GameState } from '@pivot/shared';
import type { GameStateStore } from './gameStateStore.js';

function flagKey(userId: string, gameId: string): string {
  return `${userId}:${gameId}`;
}

/**
 * Plain-Map implementation of `GameStateStore` for local dev and the standard test suite (sprint
 * decision #2 — the dispatcher pipeline is exercised end-to-end against in-memory providers so
 * `pnpm test` never requires Redis). Semantics mirror `RedisGameStateProvider` exactly, including the
 * expiry-scored `active_users` model. No cross-process persistence.
 *
 * This is the in-memory analogue of the engine's frozen `InMemoryGameStateProvider`, grown with the
 * active-user lifecycle methods (`markUserActive`/`removeActiveUser`/`isUserActive`) that Sprint 5
 * introduces. The engine file is left untouched (constraint).
 */
export class InMemoryGameStateStore implements GameStateStore {
  private readonly gameStates = new Map<string, GameState>();
  private readonly flagStates = new Map<string, FlagState>();
  /** userId -> expiry (unix ms). Active iff expiry >= now. */
  private readonly activeUsers = new Map<string, number>();
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
    const now = Date.now();
    return [...this.activeUsers.entries()]
      .filter(([, expiry]) => expiry >= now)
      .map(([userId]) => userId);
  }

  async getUsersWithStakeIn(teamId: string): Promise<string[]> {
    return [...(this.stakes.get(teamId) ?? [])];
  }

  async markUserActive(userId: string, ttlMs: number): Promise<void> {
    this.activeUsers.set(userId, Date.now() + ttlMs);
  }

  async removeActiveUser(userId: string): Promise<void> {
    this.activeUsers.delete(userId);
  }

  async isUserActive(userId: string): Promise<boolean> {
    const expiry = this.activeUsers.get(userId);
    return expiry !== undefined && expiry >= Date.now();
  }

  async sweepExpiredActiveUsers(): Promise<void> {
    const now = Date.now();
    for (const [userId, expiry] of this.activeUsers) {
      if (expiry < now) this.activeUsers.delete(userId);
    }
  }

  // --- Seeding helpers (not part of the interface; used to set up tests) ---

  /** `users_with_stake:{team_id}` seeding. In production this set is written by `RedisLineupCache`. */
  addStake(teamId: string, userId: string): void {
    const users = this.stakes.get(teamId) ?? new Set<string>();
    users.add(userId);
    this.stakes.set(teamId, users);
  }
}
