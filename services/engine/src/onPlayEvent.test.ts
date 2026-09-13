import { beforeEach, describe, expect, it } from 'vitest';
import type { UserLineupCache } from '@pivot/shared';
import type { Clock } from './clock.js';
import type { PlayEvent } from './playEvent.js';
import { InMemoryGameStateProvider } from './gameStateProvider.js';
import { CapturingEventDispatcher } from './eventDispatcher.js';
import { onPlayEvent, type LineupCacheReader, type OnPlayEventDeps } from './onPlayEvent.js';

const clock: Clock = () => 1_700_000_000_000;

/** Minimal stand-in for Sprint 3's `LineupCacheProvider` — structurally satisfies `LineupCacheReader`. */
class StubLineupCache implements LineupCacheReader {
  private readonly map = new Map<string, UserLineupCache>();
  set(cache: UserLineupCache): void {
    this.map.set(`${cache.userId}:${cache.week}`, cache);
  }
  async getLineupCache(userId: string, week: number): Promise<UserLineupCache | null> {
    return this.map.get(`${userId}:${week}`) ?? null;
  }
}

function lineupWithRbOn(team: string, userId = 'u1', week = 8): UserLineupCache {
  return {
    userId,
    week,
    teamPositions: new Map([[team, new Set(['offense'])]]),
    playerToTeam: new Map([['rb-1', team]]),
    starPlayerIds: new Set(),
  };
}

function makePlay(overrides: Partial<PlayEvent> = {}): PlayEvent {
  return {
    playId: 'p1',
    gameId: 'g1',
    week: 8,
    homeTeamId: 'LV',
    awayTeamId: 'KC',
    possessionTeamId: 'KC',
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 900,
    yardsToOpponentEndzone: 50,
    down: 1,
    distance: 10,
    isFinalPlay: false,
    ...overrides,
  };
}

describe('onPlayEvent', () => {
  let gameState: InMemoryGameStateProvider;
  let dispatcher: CapturingEventDispatcher;
  let lineupCache: StubLineupCache;
  let deps: OnPlayEventDeps;

  beforeEach(() => {
    gameState = new InMemoryGameStateProvider();
    dispatcher = new CapturingEventDispatcher();
    lineupCache = new StubLineupCache();
    deps = { lineupCache, gameState, dispatcher, clock };
  });

  it('dispatches flag_added when an active stakeholder becomes flagged', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addActiveUser('u1');
    gameState.addStake('KC', 'u1');

    await onPlayEvent(deps, makePlay({ possessionTeamId: 'KC', playType: 'run' }));

    expect(dispatcher.events).toHaveLength(1);
    expect(dispatcher.events[0]?.type).toBe('flag_added');
    expect(dispatcher.events[0]?.userId).toBe('u1');
    expect(dispatcher.events[0]?.gameId).toBe('g1');
  });

  it('persists the new game state on every play', async () => {
    await onPlayEvent(deps, makePlay({ scoreHome: 7 }));
    const stored = await gameState.getGameState('g1');
    expect(stored?.scoreHome).toBe(7);
    expect(stored?.status).toBe('in_progress');
  });

  it('does not dispatch for a stakeholder who is not active', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addStake('KC', 'u1'); // stake but not active

    await onPlayEvent(deps, makePlay());

    expect(dispatcher.events).toHaveLength(0);
  });

  it('does not dispatch for an active stakeholder with no lineup cached', async () => {
    gameState.addActiveUser('u1');
    gameState.addStake('KC', 'u1'); // no lineup set

    await onPlayEvent(deps, makePlay());

    expect(dispatcher.events).toHaveLength(0);
  });

  it('filters out non-interesting plays (no duplicate event on an identical follow-up play)', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addActiveUser('u1');
    gameState.addStake('KC', 'u1');

    const play = makePlay();
    await onPlayEvent(deps, play);
    await onPlayEvent(deps, { ...play, playId: 'p2' }); // identical field state

    expect(dispatcher.events).toHaveLength(1);
    expect(dispatcher.events[0]?.type).toBe('flag_added');
  });

  it('emits priority_increased when the flag crosses the +3 threshold (red-zone entry)', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addActiveUser('u1');
    gameState.addStake('KC', 'u1');

    await onPlayEvent(deps, makePlay({ playId: 'p1', yardsToOpponentEndzone: 40 })); // priority 2
    await onPlayEvent(deps, makePlay({ playId: 'p2', yardsToOpponentEndzone: 10 })); // priority 5

    expect(dispatcher.events.map((e) => e.type)).toEqual(['flag_added', 'priority_increased']);
  });

  it('fires flag_removed for active flagged users when the game ends, and nothing after', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addActiveUser('u1');
    gameState.addStake('KC', 'u1');

    await onPlayEvent(deps, makePlay({ playId: 'p1' })); // flag_added
    await onPlayEvent(deps, makePlay({ playId: 'p2', playType: 'end_game', isFinalPlay: true })); // flag_removed
    await onPlayEvent(deps, makePlay({ playId: 'p3', playType: 'end_game', isFinalPlay: true })); // nothing new

    expect(dispatcher.events.map((e) => e.type)).toEqual(['flag_added', 'flag_removed']);
    expect((await gameState.getGameState('g1'))?.status).toBe('final');
  });
});
