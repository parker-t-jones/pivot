import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '@pivot/engine';
import { translatePlay } from './translatePlay.js';

function play(overrides: Partial<PlayEvent> = {}): PlayEvent {
  return {
    playId: 'p1',
    gameId: '401872948',
    week: 3,
    homeTeamId: 'GB',
    awayTeamId: 'ATL',
    possessionTeamId: 'GB',
    playType: 'run',
    scoreHome: 7,
    scoreAway: 3,
    quarter: 2,
    secondsRemainingInQuarter: 521,
    yardsToOpponentEndzone: 40,
    down: 1,
    distance: 10,
    isFinalPlay: false,
    ...overrides,
  };
}

describe('translatePlay', () => {
  it('rewrites the game id and team ids from abbreviations', () => {
    const abbrToUuid = new Map([
      ['GB', 'uuid-gb'],
      ['ATL', 'uuid-atl'],
    ]);
    const translated = translatePlay(play(), 'game-uuid', abbrToUuid);
    expect(translated.gameId).toBe('game-uuid');
    expect(translated.homeTeamId).toBe('uuid-gb');
    expect(translated.awayTeamId).toBe('uuid-atl');
    expect(translated.possessionTeamId).toBe('uuid-gb');
    expect(translated.playId).toBe('p1');
  });

  it('leaves a null possession null and keeps an unknown abbreviation', () => {
    const translated = translatePlay(
      play({ possessionTeamId: null, awayTeamId: 'ZZ' }),
      'game-uuid',
      new Map([['GB', 'uuid-gb']]),
    );
    expect(translated.possessionTeamId).toBeNull();
    expect(translated.homeTeamId).toBe('uuid-gb');
    expect(translated.awayTeamId).toBe('ZZ');
  });
});
