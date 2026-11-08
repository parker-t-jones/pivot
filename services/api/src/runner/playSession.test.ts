import { describe, expect, it } from 'vitest';
import { InMemoryGameStateProvider, type PlayEvent } from '@pivot/engine';
import {
  InMemoryFlagEventQueue,
  InMemoryResumptionOpenStore,
  ResumptionCeiling,
  ResumptionGatedDispatcher,
} from '@pivot/dispatcher';
import type { FlagEvent, UserLineupCache } from '@pivot/shared';
import { createPlaySession } from './playSession.js';

function lineup(userId: string, team: string): UserLineupCache {
  return {
    userId,
    week: 8,
    teamPositions: new Map([[team, new Set(['offense'])]]),
    playerToTeam: new Map([[`rb-${team}`, team]]),
    starPlayerIds: new Set(),
  };
}

function play(overrides: Partial<PlayEvent>): PlayEvent {
  return {
    playId: 'p',
    gameId: 'g1',
    week: 8,
    homeTeamId: 'LV',
    awayTeamId: 'KC',
    possessionTeamId: 'KC',
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 2,
    secondsRemainingInQuarter: 400,
    yardsToOpponentEndzone: 60,
    down: 1,
    distance: 10,
    isFinalPlay: false,
    ...overrides,
  };
}

function session(): {
  handlePlay: (play: PlayEvent) => Promise<void>;
  queue: InMemoryFlagEventQueue;
  logs: string[];
  now: { value: number };
} {
  const now = { value: 1_000 };
  const queue = new InMemoryFlagEventQueue();
  const gate = new ResumptionGatedDispatcher({
    queue,
    onGated: () => undefined,
    clock: () => now.value,
  });
  const gameState = new InMemoryGameStateProvider();
  gameState.addStake('KC', 'kc-fan');
  gameState.addStake('LV', 'lv-fan');
  const lineups = new Map([
    ['kc-fan', lineup('kc-fan', 'KC')],
    ['lv-fan', lineup('lv-fan', 'LV')],
  ]);
  const logs: string[] = [];
  const playSession = createPlaySession({
    gameId: 'g1',
    gate,
    ceiling: new ResumptionCeiling({
      store: new InMemoryResumptionOpenStore(),
      onFire: () => undefined,
    }),
    onPlay: {
      lineupCache: {
        async getLineupCache(userId) {
          return lineups.get(userId) ?? null;
        },
      },
      gameState,
      dispatcher: gate,
      clock: () => now.value,
    },
    clock: () => now.value,
    log: (line) => logs.push(line),
  });
  return { handlePlay: (p) => playSession.handlePlay(p), queue, logs, now };
}

async function pushes(
  queue: InMemoryFlagEventQueue,
): Promise<[string, FlagEvent['type'], string | null][]> {
  const due = await queue.due(Number.MAX_SAFE_INTEGER, 100);
  return due
    .filter((item) => item.event.type === 'flag_added')
    .map((item) => [item.event.userId, item.event.type, item.triggeringPlayId]);
}

describe('createPlaySession possession nudge', () => {
  it('pushes the receiving team on the punt, and logs nothing when its snap confirms it', async () => {
    const { handlePlay, queue, logs, now } = session();
    await handlePlay(play({ playId: 'kc-snap' }));
    now.value = 5_000;
    await handlePlay(play({ playId: 'kc-punt', playType: 'punt', endPossessionTeamId: 'LV' }));

    const due = await queue.due(Number.MAX_SAFE_INTEGER, 100);
    const lvPush = due.find((item) => item.event.userId === 'lv-fan');
    expect(lvPush).toMatchObject({ triggeringPlayId: 'kc-punt' });
    expect(lvPush?.event.scheduledFireAt).toBe(5_000);
    expect(lvPush?.event.trigger).toBe('possession');

    now.value = 9_000;
    await handlePlay(
      play({ playId: 'lv-snap', possessionTeamId: 'LV', endPossessionTeamId: 'LV' }),
    );
    expect(logs.filter((line) => line.includes('overturned'))).toEqual([]);
    // The confirming snap adds no second push for the receiving team.
    expect((await pushes(queue)).filter(([user]) => user === 'lv-fan')).toHaveLength(1);
  });

  it('logs an overturned change and sends no correction push of its own', async () => {
    const { handlePlay, queue, logs, now } = session();
    await handlePlay(play({ playId: 'kc-snap' }));
    // A muffed punt first published as recovered by LV (R1 §5), then a re-kick: KC still has the ball.
    now.value = 5_000;
    await handlePlay(play({ playId: 'muff', playType: 'punt', endPossessionTeamId: 'LV' }));
    now.value = 6_000;
    await handlePlay(play({ playId: 'timeout', playType: 'timeout', possessionTeamId: null }));
    now.value = 9_000;
    await handlePlay(play({ playId: 're-kick', playType: 'punt', endPossessionTeamId: 'KC' }));

    expect(logs.filter((line) => line.includes('overturned'))).toEqual([
      '[runner] possession nudge overturned game=g1 nudge_play=muff play=re-kick nudged=LV actual=KC',
    ]);
    // One early push to the wrongly nudged team and none to anyone else: KC's flag never came back
    // on (KC's offense is not on the field during its own re-kick), so nothing "corrects" the nudge.
    expect(await pushes(queue)).toEqual([
      ['kc-fan', 'flag_added', 'kc-snap'],
      ['lv-fan', 'flag_added', 'muff'],
    ]);
  });

  it('does not treat the kickoff after a flip as an overturn', async () => {
    const { handlePlay, logs } = session();
    await handlePlay(play({ playId: 'kc-snap' }));
    await handlePlay(
      play({ playId: 'missed-fg', playType: 'field_goal', endPossessionTeamId: 'LV' }),
    );
    await handlePlay(
      play({
        playId: 'odd-kickoff',
        playType: 'kickoff',
        possessionTeamId: 'KC',
        endPossessionTeamId: 'KC',
      }),
    );

    expect(logs.filter((line) => line.includes('overturned'))).toEqual([]);
  });
});
