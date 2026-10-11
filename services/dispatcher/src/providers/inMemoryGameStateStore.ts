import type { FlagState, GameState } from '@pivot/shared';
import {
  LEGACY_IOS_DEVICE_ID,
  connectionCountsAsActive,
  listLivePresenceConnections,
  presenceKey,
  presenceVisibilityKey,
  removePresenceConnection,
  writePresenceConnection,
  type PresenceConnection,
} from '../presence.js';
import { MemoryPresenceRedis } from '../presenceRedisMemory.js';
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
  /** Per-user `presence:{userId}` and `presence-vis:{userId}`. */
  private readonly presence = new MemoryPresenceRedis();
  private readonly presenceUsers = new Set<string>();
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
    for (const userId of this.presenceUsers) {
      const live = await listLivePresenceConnections(this.presence, userId, now);
      if (live.some(connectionCountsAsActive)) ids.add(userId);
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
    this.presenceUsers.add(connection.userId);
    await writePresenceConnection(this.presence, connection, ttlMs);
  }

  async removeConnection(userId: string, connectionId: string): Promise<void> {
    await removePresenceConnection(this.presence, userId, connectionId);
  }

  async isUserActive(userId: string): Promise<boolean> {
    const now = Date.now();
    const expiry = this.activeUsers.get(userId);
    if (expiry !== undefined && expiry >= now) return true;
    const live = await listLivePresenceConnections(this.presence, userId, now);
    return live.some(connectionCountsAsActive);
  }

  async isDeviceActive(userId: string, deviceId: string): Promise<boolean> {
    const now = Date.now();
    if (deviceId === LEGACY_IOS_DEVICE_ID) {
      const expiry = this.activeUsers.get(userId);
      if (expiry !== undefined && expiry >= now) return true;
    }
    const live = await listLivePresenceConnections(this.presence, userId, now);
    return live.some(
      (connection) => connection.deviceId === deviceId && connectionCountsAsActive(connection),
    );
  }

  async sweepExpiredActiveUsers(): Promise<void> {
    const now = Date.now();
    for (const [userId, expiry] of this.activeUsers) {
      if (expiry < now) this.activeUsers.delete(userId);
    }
  }

  /** Commands issued by the per-user presence backend since the last call. */
  takePresenceCommands(): string[] {
    const commands = this.presence.commands.splice(0, this.presence.commands.length);
    return commands;
  }

  hasPresenceKey(userId: string): boolean {
    return this.presence.hasKey(presenceKey(userId)) || this.presence.hasKey(presenceVisibilityKey(userId));
  }

  presenceMembers(userId: string): string[] {
    return this.presence.members(presenceKey(userId));
  }

  presenceVisibility(userId: string): Record<string, string> {
    return this.presence.hash(presenceVisibilityKey(userId));
  }

  // --- Seeding helpers (not part of the interface; used to set up tests) ---

  /** `users_with_stake:{team_id}` seeding. In production this set is written by `RedisLineupCache`. */
  addStake(teamId: string, userId: string): void {
    const users = this.stakes.get(teamId) ?? new Set<string>();
    users.add(userId);
    this.stakes.set(teamId, users);
  }
}
