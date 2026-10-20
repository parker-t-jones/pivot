import { describe, expect, it } from 'vitest';

import {
  MNF_AIRINGS,
  MNF_BROADCAST,
  MNF_FLAGS_CURRENT,
  MNF_GAME_ID,
  MNF_HALFTIME_LIVE,
  MNF_STARTERS,
} from '../fixtures/mnfHalftime';
import {
  buildLiveStakeCards,
  liveCardClock,
  liveStakeChips,
  rankLiveStakeCards,
  watchButtonLabel,
} from './liveStakeCards';
import type { LiveGame } from './schedule';

function live(overrides: Partial<LiveGame> & { game_id: string }): LiveGame {
  return {
    ...MNF_HALFTIME_LIVE,
    possession_team: 'SF',
    yards_to_endzone: 45,
    quarter: 3,
    time_remaining_sec: 480,
    ...overrides,
  };
}

describe('rankLiveStakeCards', () => {
  const early = live({
    game_id: 'g-early',
    scheduled_start: '2026-10-18T17:00:00Z',
    away_team: 'SEA',
    home_team: 'DEN',
  });
  const mnf = live({ game_id: MNF_GAME_ID, scheduled_start: '2026-10-20T00:15:00Z' });

  it('labels the earliest staked live game LIVE · YOUR GAME when none is active', () => {
    expect(MNF_FLAGS_CURRENT.flags).toEqual([]);
    const cards = buildLiveStakeCards({
      liveGames: [mnf, early],
      stakeGameIds: new Set([mnf.game_id, early.game_id]),
      activeFlags: [],
      playersByGameId: new Map(),
      betsByGameId: new Map(),
      watchByGameId: new Map(),
    });
    expect(cards.map((card) => card.game.game_id)).toEqual([early.game_id, mnf.game_id]);
    expect(cards[0]?.eyebrow).toBe('LIVE · YOUR GAME');
    expect(cards[0]?.active).toBe(false);
    expect(cards[1]?.eyebrow).toBeNull();
  });

  it('puts the highest priority_score active game on top as NOW ACTIVE', () => {
    const cards = buildLiveStakeCards({
      liveGames: [early, mnf],
      stakeGameIds: new Set([early.game_id, mnf.game_id]),
      activeFlags: [
        { game_id: early.game_id, priority_score: 2 },
        { game_id: mnf.game_id, priority_score: 9 },
      ],
      playersByGameId: new Map(),
      betsByGameId: new Map(),
      watchByGameId: new Map(),
    });
    expect(cards[0]?.game.game_id).toBe(mnf.game_id);
    expect(cards[0]?.eyebrow).toBe('NOW ACTIVE');
    expect(cards[0]?.active).toBe(true);
    expect(cards[1]?.active).toBe(true);
    expect(cards[1]?.eyebrow).toBeNull();
  });

  it('breaks an equal priority tie by game id, matching /flags/current', () => {
    const ranked = rankLiveStakeCards({
      liveGames: [mnf, early],
      stakeGameIds: new Set([mnf.game_id, early.game_id]),
      active: [
        { gameId: mnf.game_id, priorityScore: 4 },
        { gameId: early.game_id, priorityScore: 4 },
      ],
    });
    expect(ranked.map((row) => row.game.game_id)).toEqual(
      [early.game_id, mnf.game_id].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    );
  });
});

describe('MNF halftime fixture', () => {
  it('has no possession, so the shared clock is HALFTIME and chips are sidelined', () => {
    expect(liveCardClock(MNF_HALFTIME_LIVE)).toBe('HALFTIME');
    const { chips, extraChips } = liveStakeChips({
      game: MNF_HALFTIME_LIVE,
      players: [...MNF_STARTERS],
      bets: [],
    });
    expect(extraChips).toBe(0);
    expect(chips.map((chip) => chip.text)).toEqual([
      'Commanders D/ST · SIDELINE',
      'George Kittle TE · SIDELINE',
    ]);
    expect(chips.every((chip) => chip.tone === 'sideline')).toBe(true);
  });

  it('marks offense and defense on field from possession, and keeps bets neutral', () => {
    const driving = { ...MNF_HALFTIME_LIVE, possession_team: 'SF', yards_to_endzone: 12 };
    const { chips } = liveStakeChips({
      game: driving,
      players: [...MNF_STARTERS],
      bets: [
        { id: 'ml', eyebrow: 'BET', label: 'SEA ML' },
        { id: 'pool', eyebrow: 'POOL', label: 'Survivor · JAX' },
      ],
    });
    expect(chips.map((chip) => [chip.text, chip.tone])).toEqual([
      ['Commanders D/ST · ON FIELD', 'on_field'],
      ['George Kittle TE · ON FIELD', 'on_field'],
      ['BET · SEA ML', 'neutral'],
      ['POOL · JAX', 'neutral'],
    ]);
  });

  it('caps a long chip row with +n', () => {
    const players = [0, 1, 2, 3, 4].map((index) => ({
      playerId: `p${index}`,
      firstName: 'Pat',
      lastName: `Player${index}`,
      position: 'WR',
      teamAbbreviation: 'SF',
    }));
    const { chips, extraChips } = liveStakeChips({
      game: { ...MNF_HALFTIME_LIVE, possession_team: 'WAS' },
      players,
      bets: [],
    });
    expect(chips).toHaveLength(4);
    expect(extraChips).toBe(1);
    expect(chips[0]?.tone).toBe('sideline');
  });

  it('uses the saved-link network label Watch on YouTube TV', () => {
    expect(watchButtonLabel([MNF_BROADCAST], MNF_AIRINGS)).toBe('Watch on YouTube TV');
    const [card] = buildLiveStakeCards({
      liveGames: [MNF_HALFTIME_LIVE],
      stakeGameIds: new Set([MNF_GAME_ID]),
      activeFlags: MNF_FLAGS_CURRENT.flags,
      playersByGameId: new Map([[MNF_GAME_ID, [...MNF_STARTERS]]]),
      betsByGameId: new Map(),
      watchByGameId: new Map([[MNF_GAME_ID, { broadcasts: [MNF_BROADCAST], airings: MNF_AIRINGS }]]),
    });
    expect(card?.eyebrow).toBe('LIVE · YOUR GAME');
    expect(card?.active).toBe(false);
    expect(card?.buttonLabel).toBe('Watch on YouTube TV');
  });
});
