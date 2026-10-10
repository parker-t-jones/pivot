import type { FlagState, GameState } from '@pivot/shared';
import {
  LEGACY_IOS_DEVICE_ID,
  connectionCountsAsActive,
  type PresenceConnection,
} from '../presence.js';
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
  /** Legacy slot: userId -> expiry (unix ms). Active iff expiry >= now. Device `legacy-ios`. */
  private readonly activeUsers = new Map<string, number>();
  /** One entry per connection. Hidden web stays here and does not count. */
  private readonly connections = new Map<string, { connection: PresenceConnection; expiresAt: number }>();
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
    const ids = new Set<string>();
    for (const [userId, expiry] of this.activeUsers) {
      if (expiry >= now) ids.add(userId);
    }
    for (const entry of this.connections.values()) {
      if (entry.expiresAt >= now && connectionCountsAsActive(entry.connection)) {
        ids.add(entry.connection.userId);
      }
    }
    return [...ids];
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

  async markConnectionActive(connection: PresenceConnection, ttlMs: number): Promise<void> {
    this.connections.set(connection.connectionId, {
      connection,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async removeConnection(connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
  }

  async isUserActive(userId: string): Promise<boolean> {
    const now = Date.now();
    const expiry = this.activeUsers.get(userId);
    if (expiry !== undefined && expiry >= now) return true;
    for (const entry of this.connections.values()) {
      if (
        entry.expiresAt >= now &&
        entry.connection.userId === userId &&
        connectionCountsAsActive(entry.connection)
      ) {
        return true;
      }
    }
    return false;
  }

  async isDeviceActive(userId: string, deviceId: string): Promise<boolean> {
    const now = Date.now();
    if (deviceId === LEGACY_IOS_DEVICE_ID) {
      const expiry = this.activeUsers.get(userId);
      if (expiry !== undefined && expiry >= now) return true;
    }
    for (const entry of this.connections.values()) {
      if (entry.expiresAt < now) continue;
      const connection = entry.connection;
      if (
        connection.userId === userId &&
        connection.deviceId === deviceId &&
        connectionCountsAsActive(connection)
      ) {
        return true;
      }
    }
    return false;
  }

  async sweepExpiredActiveUsers(): Promise<void> {
    const now = Date.now();
    for (const [userId, expiry] of this.activeUsers) {
      if (expiry < now) this.activeUsers.delete(userId);
    }
    for (const [connectionId, entry] of this.connections) {
      if (entry.expiresAt < now) this.connections.delete(connectionId);
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
