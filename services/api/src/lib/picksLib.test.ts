import type { GamePlayerStats } from '@pivot/shared';
import { describe, expect, it } from 'vitest';
import { slipLegFactor } from './betFlagsCurrent.js';
import { isBetCondition } from './betIndex.js';
import { countFreeSlots } from './freeSlots.js';
import {
  readGamePlayerStats,
  translateStatsTeams,
  writeGamePlayerStats,
} from './gamePlayerStats.js';
import { canonicalCondition, lineIsValid, samePick } from './pickInput.js';
import { isLegacyPick, parseCondition, toStake } from './pickRows.js';

describe('countFreeSlots', () => {
  const row = (id: string, type: string, slip_id: string | null = null) => ({
    id,
    condition: { type },
    slip_id,
  });

  it('counts a slip once, survivor and fantasy never, and spent ids not still live', () => {
    const rows = [
      row('a', 'SPREAD'),
      row('leg1', 'STAT_OVER', 'slip'),
      row('leg2', 'TEAM_TOTAL_OVER', 'slip'),
      row('s', 'SURVIVOR'),
      row('f', 'ROSTERED'),
    ];
    expect(countFreeSlots(rows, ['gone', 'a', 'slip'])).toMatchObject({ used: 3, spent: 1 });
    expect(countFreeSlots(rows, ['gone', 'gone'])).toMatchObject({ used: 3, spent: 1 });
  });
});

describe('isBetCondition', () => {
  it('covers every manual pick type and no fantasy or unknown type', () => {
    for (const type of [
      'SPREAD',
      'SURVIVOR',
      'STAT_OVER',
      'PLAYER_EVENT',
      'FG_UNDER',
      'FIRST_TO_SCORE',
    ]) {
      expect(isBetCondition({ type })).toBe(true);
    }
    for (const type of ['ROSTERED', 'OPPONENT_ROSTERED', 'NOPE']) {
      expect(isBetCondition({ type })).toBe(false);
    }
  });
});

describe('pick rows', () => {
  it('parses new conditions and rejects malformed ones', () => {
    expect(parseCondition({ type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 })).toEqual({
      type: 'STAT_OVER',
      stat: 'RUSH_YDS',
      line: 89.5,
    });
    expect(parseCondition({ type: 'STAT_OVER', stat: 'TACKLES', line: 5.5 })).toBeNull();
    expect(parseCondition({ type: 'SPREAD', line: -3.5, segment: 'Q5' })).toBeNull();
  });

  it('keeps the slip id and player subject on the engine stake', () => {
    const stake = toStake({
      id: 'x',
      user_id: 'u',
      season: 2026,
      week: 5,
      game_id: 'g',
      subject: { type: 'PLAYER', playerId: 'p', teamId: 't' },
      condition: { type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' },
      source: 'MANUAL',
      weight: 1,
      created_at: '',
      slip_id: 'slip',
    });
    expect(stake).toMatchObject({ slipId: 'slip', subject: { type: 'PLAYER', playerId: 'p' } });
  });

  it('marks only full-game singles of the four existing types as legacy', () => {
    const team = { type: 'TEAM', teamId: 't' };
    expect(isLegacyPick({ condition: { type: 'SPREAD', line: 3.5 }, subject: team })).toBe(true);
    expect(isLegacyPick({ condition: { type: 'SURVIVOR' }, subject: team })).toBe(true);
    expect(
      isLegacyPick({ condition: { type: 'SPREAD', line: 3.5, segment: 'H1' }, subject: team }),
    ).toBe(false);
    expect(
      isLegacyPick({ condition: { type: 'SPREAD', line: 3.5 }, subject: team, slip_id: 's' }),
    ).toBe(false);
    expect(isLegacyPick({ condition: { type: 'TEAM_TOTAL_OVER', line: 3.5 }, subject: team })).toBe(
      false,
    );
  });
});

describe('pick input', () => {
  it('validates lines per type', () => {
    expect(lineIsValid({ type: 'STAT_OVER', stat: 'RECEPTIONS', line: 4.5 })).toBe(true);
    expect(lineIsValid({ type: 'STAT_OVER', stat: 'RECEPTIONS', line: 30.5 })).toBe(false);
    expect(lineIsValid({ type: 'TOTAL_OVER', line: 9.5 })).toBe(false);
    expect(lineIsValid({ type: 'TOTAL_OVER', line: 9.5, segment: 'Q1' })).toBe(true);
    expect(lineIsValid({ type: 'FG_OVER', line: 2.3 })).toBe(false);
    expect(lineIsValid({ type: 'FIRST_TO_SCORE' })).toBe(true);
  });

  it('compares picks field by field regardless of key order', () => {
    const a = { subject: { teamId: 't', type: 'TEAM' }, condition: { line: 3.5, type: 'SPREAD' } };
    const b = {
      subject: { type: 'TEAM', teamId: 't' },
      condition: canonicalCondition({ type: 'SPREAD', line: 3.5 }),
    };
    expect(samePick(a, b)).toBe(true);
    expect(samePick(a, { ...b, condition: { type: 'SPREAD', line: 3.5, segment: 'H1' } })).toBe(
      false,
    );
  });
});

describe('game player stats snapshot', () => {
  const stats: GamePlayerStats = {
    gameId: 'g',
    fetchedAt: 1,
    final: false,
    players: { '1': { teamId: 'ATL', displayName: 'X', stats: { RUSH_YDS: 3 } } },
    linescores: { home: [0], away: [3] },
    scoringPlays: [{ teamId: 'ATL', period: 1, kind: 'FG', text: '' }],
  };

  it('round-trips through Redis and reads garbage or another game as null', async () => {
    const values = new Map<string, string>();
    const redis = {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => {
        values.set(key, value);
      },
    };
    await writeGamePlayerStats(redis, stats);
    expect(await readGamePlayerStats(redis, 'g')).toEqual(stats);
    expect(await readGamePlayerStats(redis, 'missing')).toBeNull();
    values.set('game_player_stats:bad', '{not json');
    expect(await readGamePlayerStats(redis, 'bad')).toBeNull();
    values.set('game_player_stats:other', JSON.stringify({ ...stats, gameId: 'g' }));
    expect(await readGamePlayerStats(redis, 'other')).toBeNull();
  });

  it('translates ESPN team abbreviations to Pivot team ids', () => {
    const translated = translateStatsTeams(stats, new Map([['ATL', 'uuid-atl']]));
    expect(translated.players['1']?.teamId).toBe('uuid-atl');
    expect(translated.scoringPlays[0]?.teamId).toBe('uuid-atl');
  });
});

describe('slipLegFactor', () => {
  it('is 0 for a lost slip, 1 for its last open leg, and 0.8 otherwise', () => {
    expect(
      slipLegFactor(
        [
          { stakeId: 'a', open: true, lost: false },
          { stakeId: 'b', open: false, lost: true },
        ],
        'a',
      ),
    ).toBe(0);
    expect(
      slipLegFactor(
        [
          { stakeId: 'a', open: true, lost: false },
          { stakeId: 'b', open: false, lost: false },
        ],
        'a',
      ),
    ).toBe(1);
    expect(
      slipLegFactor(
        [
          { stakeId: 'a', open: true, lost: false },
          { stakeId: 'b', open: true, lost: false },
        ],
        'a',
      ),
    ).toBe(0.8);
  });
});

describe('loadWeekBets with props and parlays', () => {
  it('labels a live player prop chip and ranks a slip once per game', async () => {
    const { MemSupabase } = await import('./memSupabase.test-helper.js');
    const { loadWeekBets } = await import('./betFlagsCurrent.js');
    const db = new MemSupabase();
    const base = {
      user_id: 'u',
      season: 2026,
      week: 5,
      game_id: 'g',
      source: 'MANUAL',
      weight: 1,
      created_at: '',
    };
    db.rows('stakes').push(
      {
        ...base,
        id: 'single',
        slip_id: null,
        subject: { type: 'PLAYER', playerId: 'rb', teamId: 'atl' },
        condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 },
      },
      {
        ...base,
        id: 'leg1',
        slip_id: 'slip',
        subject: { type: 'TEAM', teamId: 'atl' },
        condition: { type: 'TEAM_TOTAL_OVER', line: 24.5 },
      },
      {
        ...base,
        id: 'leg2',
        slip_id: 'slip',
        subject: { type: 'TEAM', teamId: 'gb' },
        condition: { type: 'TEAM_TOTAL_OVER', line: 24.5 },
      },
    );
    db.rows('players').push({
      id: 'rb',
      team_id: 'atl',
      position: 'RB',
      espn_id: '1',
      first_name: 'Bijan',
      last_name: 'Robinson',
    });
    db.rows('games').push({ id: 'g', home_team_id: 'gb', away_team_id: 'atl' });
    db.rows('teams').push(
      { id: 'gb', abbreviation: 'GB', name: 'Packers', primary_color: '', secondary_color: '' },
      { id: 'atl', abbreviation: 'ATL', name: 'Falcons', primary_color: '', secondary_color: '' },
    );
    const week = await loadWeekBets({
      supabase: db as unknown as import('./supabase.js').SupabaseServiceClient,
      userId: 'u',
      week: 5,
      gameIds: ['g'],
      getGameState: async () => ({
        gameId: 'g',
        homeTeamId: 'gb',
        awayTeamId: 'atl',
        possessionTeamId: 'atl',
        unitOnField: 'offense',
        scoreHome: 0,
        scoreAway: 0,
        quarter: 1,
        timeRemainingSec: 800,
        yardsToOpponentEndzone: 60,
        down: 1,
        distance: 10,
        inRedZone: false,
        status: 'in_progress',
        updatedAt: 1,
      }),
      getPlayerStats: async () => ({
        gameId: 'g',
        fetchedAt: 1,
        final: false,
        players: { '1': { teamId: 'atl', displayName: 'Bijan Robinson', stats: { RUSH_YDS: 10 } } },
        linescores: { home: [0], away: [0] },
        scoringPlays: [],
      }),
    });
    const chips = week?.byGame.get('g')?.bets.map((bet) => bet.label);
    expect(chips).toEqual(['ATL team total over 24.5', 'B. Robinson over 89.5 rush yds']);
    // ATL has the ball: team prop leverage 0.6 at the 0.8 leg factor beats the RB's possession lev.
    expect(week?.byGame.get('g')?.score).toBe(Math.round(0.6 * 0.8 * 12));
  });
});
