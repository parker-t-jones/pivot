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
    expect(dispatcher.triggeringPlayIds).toEqual(['p1']);
  });

  it('persists the new game state on every play', async () => {
    await onPlayEvent(deps, makePlay({ scoreHome: 7 }));
    const stored = await gameState.getGameState('g1');
    expect(stored?.scoreHome).toBe(7);
    expect(stored?.status).toBe('in_progress');
  });

  it('dispatches for a stakeholder who is not in active_users', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addStake('KC', 'u1');

    await onPlayEvent(deps, makePlay());

    expect(dispatcher.events).toHaveLength(1);
    expect(dispatcher.events[0]?.type).toBe('flag_added');
    expect(dispatcher.events[0]?.userId).toBe('u1');
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

  it('emits priority_increased when the same players enter the red zone', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addActiveUser('u1');
    gameState.addStake('KC', 'u1');

    await onPlayEvent(deps, makePlay({ playId: 'p1', yardsToOpponentEndzone: 40 })); // priority 2
    await onPlayEvent(deps, makePlay({ playId: 'p2', yardsToOpponentEndzone: 10 })); // +3 red_zone

    expect(dispatcher.events.map((e) => e.type)).toEqual(['flag_added', 'priority_increased']);
    expect(dispatcher.events[1]?.newState.reasons.map((reason) => reason.type)).toEqual([
      'offense_active',
      'red_zone',
    ]);
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

  it('emits flag_added for the tight end when CLE takes the ball from its own D/ST', async () => {
    const cle = 'cle';
    const pit = 'pit';
    lineupCache.set(sameTeam(cle));
    gameState.addStake(cle, 'u1');

    await onPlayEvent(deps, snap('pit-snap', pit, cle));
    await onPlayEvent(deps, snap('cle-snap', cle, pit));

    expect(dispatcher.events.map((event) => event.type)).toEqual(['flag_added', 'flag_added']);
    expect(dispatcher.events[1]?.newState.reasons).toEqual([
      { type: 'offense_active', triggeringPlayerIds: ['te'] },
    ]);
    const stored = await gameState.getUserFlagState('u1', 'g1');
    expect(stored?.reasons).toEqual([{ type: 'offense_active', triggeringPlayerIds: ['te'] }]);
  });

  it('emits flag_added when the same team flips from offense back to defense', async () => {
    const cle = 'cle';
    const pit = 'pit';
    lineupCache.set(sameTeam(cle));
    gameState.addStake(cle, 'u1');

    await onPlayEvent(deps, snap('cle-snap', cle, pit));
    await onPlayEvent(deps, snap('pit-snap', pit, cle));

    expect(dispatcher.events.map((event) => event.type)).toEqual(['flag_added', 'flag_added']);
    expect(dispatcher.events[1]?.newState.reasons).toEqual([
      { type: 'defense_active', triggeringPlayerIds: ['dst'] },
    ]);
  });

  it('emits flag_added when a second offensive player becomes active', async () => {
    lineupCache.set(lineupWithRbOn('KC'));
    gameState.addStake('KC', 'u1');

    await onPlayEvent(deps, makePlay({ playId: 'one' }));
    lineupCache.set({
      userId: 'u1',
      week: 8,
      teamPositions: new Map([['KC', new Set(['offense'])]]),
      playerToTeam: new Map([
        ['rb-1', 'KC'],
        ['wr-1', 'KC'],
      ]),
      playerUnits: new Map([
        ['rb-1', 'offense'],
        ['wr-1', 'offense'],
      ]),
      starPlayerIds: new Set(),
    });
    await onPlayEvent(deps, makePlay({ playId: 'two', scoreAway: 3 }));

    expect(dispatcher.events.map((event) => event.type)).toEqual(['flag_added', 'flag_added']);
    expect(dispatcher.events[1]?.newState.priorityScore).toBe(4);
    expect(dispatcher.events[1]?.newState.reasons).toEqual([
      { type: 'offense_active', triggeringPlayerIds: ['rb-1', 'wr-1'] },
    ]);
  });
});

function sameTeam(team: string): UserLineupCache {
  return {
    userId: 'u1',
    week: 8,
    teamPositions: new Map([[team, new Set<'offense' | 'defense'>(['offense', 'defense'])]]),
    playerToTeam: new Map([
      ['te', team],
      ['dst', team],
    ]),
    playerUnits: new Map([
      ['te', 'offense'],
      ['dst', 'defense'],
    ]),
    starPlayerIds: new Set(),
  };
}

function snap(playId: string, possessionTeamId: string, otherTeamId: string): PlayEvent {
  const home = possessionTeamId === 'cle' || otherTeamId === 'cle' ? 'cle' : possessionTeamId;
  return makePlay({
    playId,
    homeTeamId: home,
    awayTeamId: home === possessionTeamId ? otherTeamId : possessionTeamId,
    possessionTeamId,
    playType: 'run',
  });
}
