import { describe, expect, it } from 'vitest';

import {
  browsedStarterCount,
  cardGameCount,
  freeBetCount,
  opponentStripStatus,
  sparseBetPrompt,
  watchedStarterCount,
  weekCardModel,
  type WeekCardInputs,
} from './weekCardModel';

const free: WeekCardInputs = {
  starterCount: 9,
  opponentStatus: 'off',
  betCount: 0,
  survivorCount: 1,
  isPro: false,
};

describe('weekCardModel', () => {
  it('counts singles and all parlay legs in the same pool', () => {
    const single = { condition: { type: 'SPREAD' } };
    const slip = { condition: { type: 'PARLAY' }, legs: [single, single] };
    expect(freeBetCount([single, slip])).toBe(3);
    expect(freeBetCount([slip], 1)).toBe(3);
    expect(
      freeBetCount([{ condition: { type: 'SURVIVOR' } }, { condition: { type: 'ROSTERED' } }]),
    ).toBe(0);
  });

  it('says 3 free left for a Free user with no bets', () => {
    expect(weekCardModel(free).bets).toEqual({
      label: 'Bets & props',
      value: '0',
      note: '3 free left',
      strip: 'Bets & props 0 \u00b7 3 free left',
      accent: true,
      muted: false,
      upgrade: false,
    });
  });

  it('does not count survivor picks against free bets left, and still counts bets', () => {
    const stakes = [
      { condition: { type: 'SPREAD' } },
      { condition: { type: 'SURVIVOR' } },
      { condition: { type: 'SURVIVOR' } },
      { condition: { type: 'ROSTERED' } },
    ];
    expect(freeBetCount(stakes)).toBe(1);
    // Picks removed after kickoff still use their slots.
    expect(freeBetCount(stakes, 2)).toBe(3);
    const spentCell = weekCardModel({ ...free, betCount: freeBetCount(stakes, 2) }).bets;
    expect(spentCell.value).toBe('3');
    expect(spentCell.note).toBe('No free bets left');
    expect(spentCell.upgrade).toBe(true);
    const bets = weekCardModel({ ...free, betCount: freeBetCount(stakes), survivorCount: 2 }).bets;
    expect(bets.value).toBe('1');
    expect(bets.note).toBe('2 free left');

    const atCap = [
      { condition: { type: 'SPREAD' } },
      { condition: { type: 'MONEYLINE' } },
      { condition: { type: 'TOTAL_OVER' } },
      { condition: { type: 'SURVIVOR' } },
    ];
    expect(freeBetCount(atCap)).toBe(3);
    expect(weekCardModel({ ...free, betCount: freeBetCount(atCap) }).bets.note).toBe(
      'No free bets left',
    );
  });

  it('leaves free bets left unchanged for survivor picks and spends them on spread, total, and moneyline', () => {
    const survivors = [{ condition: { type: 'SURVIVOR' } }, { condition: { type: 'SURVIVOR' } }];
    expect(freeBetCount(survivors)).toBe(0);
    expect(
      weekCardModel({ ...free, betCount: freeBetCount(survivors), survivorCount: 2 }).bets,
    ).toEqual({
      label: 'Bets & props',
      value: '0',
      note: '3 free left',
      strip: 'Bets & props 0 \u00b7 3 free left',
      accent: true,
      muted: false,
      upgrade: false,
    });

    const spread = [...survivors, { condition: { type: 'SPREAD' } }];
    expect(freeBetCount(spread)).toBe(1);
    expect(
      weekCardModel({ ...free, betCount: freeBetCount(spread), survivorCount: 2 }).bets.note,
    ).toBe('2 free left');

    const total = [...spread, { condition: { type: 'TOTAL_OVER' } }];
    expect(freeBetCount(total)).toBe(2);
    expect(
      weekCardModel({ ...free, betCount: freeBetCount(total), survivorCount: 2 }).bets.note,
    ).toBe('1 free left');

    const atCap = [...total, { condition: { type: 'MONEYLINE' } }];
    expect(freeBetCount(atCap)).toBe(3);
    expect(
      weekCardModel({ ...free, betCount: freeBetCount(atCap), survivorCount: 2 }).bets,
    ).toEqual({
      label: 'Bets & props',
      value: '3',
      note: 'No free bets left',
      strip: 'Bets & props 3 \u00b7 No free bets left',
      accent: true,
      muted: false,
      upgrade: true,
    });
  });

  it('says 2 free left with one bet', () => {
    expect(weekCardModel({ ...free, betCount: 1 }).bets).toEqual({
      label: 'Bets & props',
      value: '1',
      note: '2 free left',
      strip: 'Bets & props 1 \u00b7 2 free left',
      accent: true,
      muted: false,
      upgrade: false,
    });
  });

  it('never says "of 3 free"', () => {
    for (const betCount of [0, 1, 2, 3]) {
      const bets = weekCardModel({ ...free, betCount }).bets;
      expect(`${bets.value} ${bets.note ?? ''} ${bets.strip ?? ''}`).not.toMatch(/of 3/);
    }
  });

  it('says there are no free bets left at the cap and offers Upgrade', () => {
    expect(weekCardModel({ ...free, betCount: 3 }).bets).toEqual({
      label: 'Bets & props',
      value: '3',
      note: 'No free bets left',
      strip: 'Bets & props 3 \u00b7 No free bets left',
      accent: true,
      muted: false,
      upgrade: true,
    });
  });

  it('stays at no free bets left when the count is over the cap', () => {
    const bets = weekCardModel({ ...free, betCount: 4 }).bets;
    expect(bets.note).toBe('No free bets left');
    expect(bets.strip).toBe('Bets & props 4 \u00b7 No free bets left');
    expect(bets.upgrade).toBe(true);
    expect(bets.value.includes('-')).toBe(false);
  });

  it('shows the plain count for Pro, with no free note', () => {
    expect(weekCardModel({ ...free, betCount: 4, isPro: true }).bets).toEqual({
      label: 'Bets & props',
      value: '4',
      accent: false,
      muted: false,
    });
  });

  it('says Tracking when opponent watch is on and Off when it is not', () => {
    expect(weekCardModel({ ...free, opponentStatus: 'on' }).opponent).toMatchObject({
      value: 'Tracking',
      toggleable: true,
    });
    expect(weekCardModel(free).opponent).toMatchObject({ value: 'Off', toggleable: true });
  });

  it('counts zero starters when there are no leagues', () => {
    expect(watchedStarterCount([], [])).toBe(0);
    expect(weekCardModel({ ...free, starterCount: 0 }).fantasy).toEqual({
      label: 'Fantasy',
      value: '0',
      accent: false,
      muted: false,
    });
  });

  it('counts starters on watched leagues and skips bench slots', () => {
    const lineups = [
      {
        leagueId: 'watched',
        slots: [
          { slot_type: 'starter', position_in_lineup: 'QB' },
          { slot_type: 'flex', position_in_lineup: 'FLEX' },
          { slot_type: 'bench', position_in_lineup: 'BN' },
        ],
      },
      {
        leagueId: 'other',
        slots: [{ slot_type: 'starter', position_in_lineup: 'RB' }],
      },
    ];
    expect(watchedStarterCount(lineups, ['watched'])).toBe(2);
    expect(watchedStarterCount(lineups, [])).toBe(3);
  });

  it('renders an em dash for a failed fantasy count and leaves the other cells', () => {
    const model = weekCardModel({ ...free, starterCount: null });
    expect(model.fantasy).toEqual({
      label: 'Fantasy',
      value: '\u2014',
      accent: false,
      muted: true,
    });
    expect(model.opponent.value).toBe('Off');
    expect(model.bets.note).toBe('3 free left');
    expect(model.pools.value).toBe('1');
  });

  it('renders an em dash for a failed bet count and does not say of 3 free', () => {
    const model = weekCardModel({ ...free, betCount: null, isPro: false });
    expect(model.bets).toEqual({
      label: 'Bets & props',
      value: '\u2014',
      accent: false,
      muted: true,
    });
    expect(model.bets.value).not.toContain('free');
    expect(model.bets.note).toBeUndefined();
    expect(model.fantasy.value).toBe('9');
    expect(model.opponent.value).toBe('Off');
    expect(model.pools.value).toBe('1');
  });

  it('renders an em dash for a failed pool count', () => {
    expect(weekCardModel({ ...free, survivorCount: null }).pools).toEqual({
      label: 'Survivor pool',
      value: '\u2014',
      accent: false,
      muted: true,
    });
  });
});

describe('week card heading', () => {
  it('says YOUR WEEK n CARD with the game count on the right', () => {
    const model = weekCardModel({ ...free, week: 9, gameCount: 6 });
    expect(model.eyebrow).toBe('YOUR WEEK 9 CARD');
    expect(model.gameCountLabel).toBe('6 GAMES');
  });

  it('says 1 GAME, and hides the count while it is unknown', () => {
    expect(weekCardModel({ ...free, week: 9, gameCount: 1 }).gameCountLabel).toBe('1 GAME');
    expect(weekCardModel({ ...free, week: 9, gameCount: null }).gameCountLabel).toBeNull();
    expect(weekCardModel(free).eyebrow).toBe('YOUR WEEK CARD');
  });

  it('labels the four cells Fantasy, Opponent, Bets & props, and Survivor pool', () => {
    const model = weekCardModel(free);
    expect([model.fantasy, model.opponent, model.bets, model.pools].map((c) => c.label)).toEqual([
      'Fantasy',
      'Opponent',
      'Bets & props',
      'Survivor pool',
    ]);
  });
});

describe('cardGameCount', () => {
  const games = [
    { game_id: 'g1', home_team: 'DET', away_team: 'GB' },
    { game_id: 'g2', home_team: 'KC', away_team: 'BUF' },
    { game_id: 'g3', home_team: 'SF', away_team: 'SEA' },
  ];

  it('counts each game once across starters and picks', () => {
    expect(cardGameCount(['DET', 'gb', 'KC'], ['g1', 'g2'], games)).toBe(2);
  });

  it('adds games that only have a pick, and skips picks outside the week', () => {
    expect(cardGameCount(['DET'], ['g3', 'other-week'], games)).toBe(2);
  });

  it('is zero with no starters or picks, and ignores missing teams', () => {
    expect(cardGameCount([null, '', undefined], [], games)).toBe(0);
  });
});

describe('opponent strip for the browsed league', () => {
  it('is on or off for a loaded Sleeper league', () => {
    expect(
      opponentStripStatus({
        browsedLeagueReady: true,
        platform: 'sleeper',
        preferenceKnown: true,
        watchOpponent: true,
      }),
    ).toBe('on');
    expect(
      opponentStripStatus({
        browsedLeagueReady: true,
        platform: 'sleeper',
        preferenceKnown: true,
        watchOpponent: false,
      }),
    ).toBe('off');
    expect(weekCardModel({ ...free, opponentStatus: 'on' }).opponent.value).toBe('Tracking');
    expect(weekCardModel({ ...free, opponentStatus: 'off' }).opponent.value).toBe('Off');
  });

  it('says Sleeper only for a loaded non-Sleeper league and does not toggle', () => {
    const status = opponentStripStatus({
      browsedLeagueReady: true,
      platform: 'manual',
      preferenceKnown: true,
      watchOpponent: true,
    });
    expect(status).toBe('sleeper-only');
    expect(weekCardModel({ ...free, opponentStatus: status }).opponent).toMatchObject({
      value: 'Sleeper only',
      muted: true,
      toggleable: false,
    });
  });

  it('stays unknown, not Off, until the browsed league and the preference are loaded', () => {
    expect(
      opponentStripStatus({
        browsedLeagueReady: false,
        platform: 'sleeper',
        preferenceKnown: true,
        watchOpponent: false,
      }),
    ).toBe('unknown');
    expect(
      opponentStripStatus({
        browsedLeagueReady: true,
        platform: 'sleeper',
        preferenceKnown: false,
        watchOpponent: false,
      }),
    ).toBe('unknown');
    const unknown = weekCardModel({ ...free, opponentStatus: 'unknown' }).opponent;
    expect(unknown.value).toBe('\u2026');
    expect(unknown.value).not.toBe('Off');
    expect(unknown).toMatchObject({ muted: true, toggleable: false });
  });
});

describe('browsedStarterCount', () => {
  const games = [
    { home_team: 'BUF', away_team: 'NYJ' },
    { home_team: 'KC', away_team: 'DEN' },
  ];

  function slot(id: string, abbr: string | null, slotType = 'starter', position = 'WR') {
    return {
      slot_type: slotType,
      position_in_lineup: position,
      player: {
        player_id: id,
        team: abbr == null ? null : { abbreviation: abbr },
      },
    };
  }

  it('counts unique starters who have a game and skips bench, bye, and duplicates', () => {
    expect(
      browsedStarterCount(
        [
          slot('a', 'BUF'),
          slot('a', 'BUF', 'flex', 'FLEX'),
          slot('b', 'NYJ', 'bench', 'BN'),
          slot('c', 'DET'),
          slot('d', null),
          slot('e', 'kc', 'flex', 'FLEX'),
        ],
        games,
      ),
    ).toBe(2);
  });
});

describe('sparseBetPrompt', () => {
  it('offers the remaining free bets when the Bets tab has fewer than 3 rows', () => {
    expect(sparseBetPrompt({ rowCount: 1, betsUsed: 1, isPro: false })).toBe(
      '2 free bets left · Add a pick',
    );
    expect(sparseBetPrompt({ rowCount: 0, betsUsed: 0, isPro: false })).toBe(
      '3 free bets left · Add a pick',
    );
  });

  it('hides the row at the free cap', () => {
    expect(sparseBetPrompt({ rowCount: 2, betsUsed: 3, isPro: false })).toBeNull();
    expect(sparseBetPrompt({ rowCount: 0, betsUsed: 4, isPro: false })).toBeNull();
  });

  it('offers Add a pick for Pro under 3 rows, and nothing once there are 3', () => {
    expect(sparseBetPrompt({ rowCount: 2, betsUsed: 5, isPro: true })).toBe('Add a pick');
    expect(sparseBetPrompt({ rowCount: 3, betsUsed: 0, isPro: false })).toBeNull();
    expect(sparseBetPrompt({ rowCount: 3, betsUsed: 0, isPro: true })).toBeNull();
  });
});
