import type { UserLineupCache } from '@pivot/shared';
import type { LineupCacheProvider, NflState } from './types.js';

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
  private readonly bets = new Map<string, Set<string>>();
  private readonly betGames = new Map<string, Set<string>>();
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
    const users = this.bets.get(gameId) ?? new Set<string>();
    users.add(userId);
    this.bets.set(gameId, users);
    const games = this.betGames.get(betGamesKey(userId, week)) ?? new Set<string>();
    games.add(gameId);
    this.betGames.set(betGamesKey(userId, week), games);
  }

  async removeUserBet(gameId: string, userId: string, week: number): Promise<void> {
    this.bets.get(gameId)?.delete(userId);
    this.betGames.get(betGamesKey(userId, week))?.delete(gameId);
  }

  async getUsersWithBet(gameId: string): Promise<string[]> {
    return [...(this.bets.get(gameId) ?? [])];
  }

  async getUserBetGames(userId: string, week: number): Promise<string[]> {
    return [...(this.betGames.get(betGamesKey(userId, week)) ?? [])];
  }

  async getNflState(): Promise<NflState | null> {
    if (!this.nflState || this.nflState.expiresAt <= Date.now()) return null;
    return this.nflState.value;
  }

  async setNflState(state: NflState, ttlSec: number): Promise<void> {
    this.nflState = { value: state, expiresAt: Date.now() + ttlSec * 1000 };
  }
}
