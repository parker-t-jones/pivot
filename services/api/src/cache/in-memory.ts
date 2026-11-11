import type { UserLineupCache } from '@pivot/shared';
import { LINEUP_CACHE_KEY_TTL_SECONDS, type LineupCacheProvider, type NflState } from './types.js';

interface ExpiringSet {
  members: Set<string>;
  expiresAt: number;
}

function liveMembers(entries: Map<string, ExpiringSet>, key: string): Set<string> | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  return entry.members;
}

function lineupKey(userId: string, week: number): string {
  return `${userId}:${week}`;
}

function betGamesKey(userId: string, week: number): string {
  return `${userId}:${week}`;
}

/** Plain-Map implementation for local dev and tests. No persistence across process restarts. */
export class InMemoryLineupCache implements LineupCacheProvider {
  private readonly lineups = new Map<string, UserLineupCache>();
  private readonly stakes = new Map<string, Set<string>>();
  private readonly bets = new Map<string, ExpiringSet>();
  private readonly betGames = new Map<string, ExpiringSet>();
  private nflState: { value: NflState; expiresAt: number } | null = null;

  async setLineupCache(userId: string, week: number, cache: UserLineupCache): Promise<void> {
    this.lineups.set(lineupKey(userId, week), cache);
  }

  async getLineupCache(userId: string, week: number): Promise<UserLineupCache | null> {
    return this.lineups.get(lineupKey(userId, week)) ?? null;
  }

  async addUserStake(teamId: string, userId: string): Promise<void> {
    const users = this.stakes.get(teamId) ?? new Set<string>();
    users.add(userId);
    this.stakes.set(teamId, users);
  }

  async removeUserStake(teamId: string, userId: string): Promise<void> {
    this.stakes.get(teamId)?.delete(userId);
  }

  async getUsersWithStake(teamId: string): Promise<string[]> {
    return [...(this.stakes.get(teamId) ?? [])];
  }

  async addUserBet(gameId: string, userId: string, week: number): Promise<void> {
    const users = liveMembers(this.bets, gameId) ?? new Set<string>();
    users.add(userId);
    const expiresAt = Date.now() + LINEUP_CACHE_KEY_TTL_SECONDS * 1000;
    this.bets.set(gameId, { members: users, expiresAt });
    const games = liveMembers(this.betGames, betGamesKey(userId, week)) ?? new Set<string>();
    games.add(gameId);
    this.betGames.set(betGamesKey(userId, week), { members: games, expiresAt });
  }

  async removeUserBet(gameId: string, userId: string, week: number): Promise<void> {
    liveMembers(this.bets, gameId)?.delete(userId);
    liveMembers(this.betGames, betGamesKey(userId, week))?.delete(gameId);
  }

  async getUsersWithBet(gameId: string): Promise<string[]> {
    return [...(liveMembers(this.bets, gameId) ?? [])];
  }

  async getUserBetGames(userId: string, week: number): Promise<string[]> {
    return [...(liveMembers(this.betGames, betGamesKey(userId, week)) ?? [])];
  }

  async getNflState(): Promise<NflState | null> {
    if (!this.nflState || this.nflState.expiresAt <= Date.now()) return null;
    return this.nflState.value;
  }

  async setNflState(state: NflState, ttlSec: number): Promise<void> {
    this.nflState = { value: state, expiresAt: Date.now() + ttlSec * 1000 };
  }
}
