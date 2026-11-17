import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./apiClient', () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  apiClient: { get: api.get, post: api.post },
}));

import { ApiRequestError } from './apiClient';
import { buildPickInput, draftReadout } from './pickDraft';
import type { BetCondition, PickInput } from './picksClient';
import {
  draftFromImportedLeg,
  importBetChoices,
  importBetHeader,
  initialImportSelection,
  isMultiBetImport,
  planImportSaves,
  fetchSlipImportEnabled,
  importSlip,
  slipImportErrorMessage,
  type ImportedLeg,
  type SlipImportResult,
} from './slipImport';

const GAME = {
  game_id: 'g-sf-sea',
  status: 'scheduled',
  scheduled_start: '2026-11-15T21:25:00Z',
  home_team_id: 'sea-id',
  away_team_id: 'sf-id',
  home_team: 'SEA',
  away_team: 'SF',
  home_team_name: 'Seattle Seahawks',
  away_team_name: 'San Francisco 49ers',
};
const KITTLE = {
  player_id: 'p-kittle',
  first_name: 'George',
  last_name: 'Kittle',
  position: 'TE',
  team: { abbreviation: 'SF' },
};

function ready(pick: PickInput, player: typeof KITTLE | null = null) {
  return { status: 'ready', text: 'as printed', pick, game: GAME, player } satisfies ImportedLeg;
}
const team = (condition: BetCondition): PickInput => ({
  gameId: 'g-sf-sea',
  teamId: 'sf-id',
  condition,
});
const game = (condition: BetCondition): PickInput => ({ gameId: 'g-sf-sea', condition });
const player = (condition: BetCondition): PickInput => ({
  gameId: 'g-sf-sea',
  playerId: 'p-kittle',
  condition,
});

describe('draftFromImportedLeg', () => {
  it.each<[string, PickInput, typeof KITTLE | null]>([
    ['moneyline', team({ type: 'MONEYLINE', side: 'TEAM' }), null],
    ['favorite spread', team({ type: 'SPREAD', line: -3.5 }), null],
    ['underdog spread', team({ type: 'SPREAD', line: 7 }), null],
    ['first-half spread', team({ type: 'SPREAD', line: -0.5, segment: 'H1' }), null],
    ['game total', game({ type: 'TOTAL_UNDER', line: 44.5 }), null],
    ['quarter total', game({ type: 'TOTAL_OVER', line: 10.5, segment: 'Q1' }), null],
    ['team total', team({ type: 'TEAM_TOTAL_OVER', line: 24.5 }), null],
    ['half team total', team({ type: 'TEAM_TOTAL_UNDER', line: 10.5, segment: 'H2' }), null],
    ['first to score', team({ type: 'FIRST_TO_SCORE' }), null],
    ['team field goals', team({ type: 'FG_OVER', line: 1.5 }), null],
    ['game field goals', game({ type: 'FG_UNDER', line: 3.5 }), null],
    ['stat over', player({ type: 'STAT_OVER', stat: 'REC_YDS', line: 59.5 }), KITTLE],
    ['stat under', player({ type: 'STAT_UNDER', stat: 'RECEPTIONS', line: 5.5 }), KITTLE],
    ['anytime TD', player({ type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' }), KITTLE],
    ['first TD no', player({ type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'NO' }), KITTLE],
  ])('rebuilds a %s into the same pick', (_name, pick, who) => {
    const draft = draftFromImportedLeg(ready(pick, who));
    expect(draft).not.toBeNull();
    if (draft === null) return;
    expect(buildPickInput(draft)).toEqual(pick);
    // Every line pick reads back in words; a moneyline has no readout in the steps either.
    if (pick.condition.type !== 'MONEYLINE')
      expect(draftReadout(draft)).toEqual(expect.any(String));
  });

  it('gives a player prop the player’s team for the slip badge', () => {
    const draft = draftFromImportedLeg(
      ready(player({ type: 'STAT_OVER', stat: 'REC_YDS', line: 59.5 }), KITTLE),
    );
    expect(draft?.teamId).toBe('sf-id');
    expect(draft && draftReadout(draft)).toBe('Kittle needs 60 or more receiving yards');
  });

  it('returns null when the steps could not rebuild the same pick', () => {
    // A pick'em spread has no favorite or underdog side in the steps.
    expect(draftFromImportedLeg(ready(team({ type: 'SPREAD', line: 0 })))).toBeNull();
    // A team-subject pick with no team in the game.
    expect(
      draftFromImportedLeg(
        ready({ gameId: 'g-sf-sea', condition: { type: 'MONEYLINE', side: 'TEAM' } }),
      ),
    ).toBeNull();
  });
});

describe('slip import client', () => {
  it('posts the image and nothing else, with the multi-bet capability in the query', async () => {
    api.post.mockResolvedValueOnce({ kind: 'single', legs: [], imports_left: 4 });
    await importSlip('data:image/png;base64,AAAA');
    expect(api.post).toHaveBeenCalledWith('/picks/import?multi_bet=v1', {
      image: 'data:image/png;base64,AAAA',
    });
  });

  it('reads import as on only when /health says enabled', async () => {
    api.get.mockResolvedValueOnce({ ok: true, slipImport: 'enabled' });
    expect(await fetchSlipImportEnabled()).toBe(true);
    api.get.mockResolvedValueOnce({ ok: true, slipImport: 'disabled' });
    expect(await fetchSlipImportEnabled()).toBe(false);
    api.get.mockResolvedValueOnce({ ok: true });
    expect(await fetchSlipImportEnabled()).toBe(false);
    api.get.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchSlipImportEnabled()).toBe(false);
  });

  it('shows the API’s sentence for import errors and a fallback otherwise', () => {
    const limit = new ApiRequestError(
      429,
      'slip_import_limit',
      'You’ve used this week’s 10 screenshot imports.',
    );
    expect(slipImportErrorMessage(limit)).toBe('You’ve used this week’s 10 screenshot imports.');
    expect(
      slipImportErrorMessage(new ApiRequestError(500, 'internal_error', 'Internal server error.')),
    ).toBe('We couldn’t import that screenshot. Try again, or add the pick yourself.');
    expect(slipImportErrorMessage(new Error('x'))).toContain('add the pick yourself');
  });
});

describe('multi-bet import', () => {
  const ml = ready(team({ type: 'MONEYLINE', side: 'TEAM' }));
  const rec = ready(player({ type: 'STAT_OVER', stat: 'REC_YDS', line: 59.5 }), KITTLE);
  const under = ready(game({ type: 'TOTAL_UNDER', line: 44.5 }));
  const flagged = { status: 'flagged', text: 'Correct score 24-17', reason: 'Not yet.' } as const;
  let n = 0;
  const nextKey = () => `k${++n}`;

  it('uses the multi-bet review only for several bets or a review request', () => {
    const one: SlipImportResult = { kind: 'single', legs: [ml], imports_left: 1 };
    expect(isMultiBetImport(one)).toBe(false);
    expect(isMultiBetImport({ ...one, bets: [{ bet_type: 'single', legs: [ml] }] })).toBe(false);
    expect(
      isMultiBetImport({ ...one, bets: [{ bet_type: 'single', legs: [ml] }], review: true }),
    ).toBe(true);
    expect(
      isMultiBetImport({
        ...one,
        bets: [
          { bet_type: 'single', legs: [ml] },
          { bet_type: 'single', legs: [rec] },
        ],
      }),
    ).toBe(true);
  });

  it('groups ready and flagged legs per bet, with headers', () => {
    const bets = importBetChoices(
      [
        { bet_type: 'single', legs: [ml] },
        { bet_type: 'parlay', legs: [rec, flagged, under] },
      ],
      nextKey,
    );
    expect(bets.map((bet) => bet.legs.map((leg) => leg.label))).toEqual([
      ['SF ML'],
      [expect.stringContaining('Kittle'), expect.any(String)],
    ]);
    expect(bets[1]?.legs[0]?.printed).toBe('as printed');
    expect(bets[1]?.flagged).toEqual([
      { key: expect.any(String), text: 'Correct score 24-17', reason: 'Not yet.' },
    ]);
    expect(bets.map((bet, index) => importBetHeader(index, bet))).toEqual([
      'Bet 1 · Single',
      'Bet 2 · Parlay · 3 legs',
    ]);
  });

  it('preselects everything only when it all fits and the grouping is sure', () => {
    const bets = importBetChoices(
      [
        { bet_type: 'single', legs: [ml] },
        { bet_type: 'parlay', legs: [rec, under] },
      ],
      nextKey,
    );
    expect(initialImportSelection(bets, null, false)).toHaveLength(3);
    expect(initialImportSelection(bets, 3, false)).toHaveLength(3);
    expect(initialImportSelection(bets, 2, false)).toEqual([]);
    expect(initialImportSelection(bets, null, true)).toEqual([]);
  });

  it('plans one save per bet: a pick for one leg, a parlay for more', () => {
    const bets = importBetChoices(
      [
        { bet_type: 'single', legs: [ml] },
        { bet_type: 'parlay', legs: [rec, under] },
        { bet_type: 'parlay', legs: [rec, ml, under] },
        { bet_type: 'single', legs: [under] },
      ],
      nextKey,
    );
    const keys = bets.map((bet) => bet.legs.map((leg) => leg.key));
    const selected = [keys[0]?.[0], keys[1]?.[1], keys[2]?.[0], keys[2]?.[2]].filter(
      (key): key is string => key !== undefined,
    );
    expect(planImportSaves(bets, selected)).toEqual([
      { kind: 'pick', betKey: bets[0]?.key, input: ml.pick },
      { kind: 'pick', betKey: bets[1]?.key, input: under.pick },
      { kind: 'slip', betKey: bets[2]?.key, inputs: [rec.pick, under.pick] },
    ]);
  });
});
