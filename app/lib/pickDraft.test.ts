import { describe, expect, it } from 'vitest';

import {
  EMPTY_DRAFT,
  buildPickInput,
  draftLine,
  draftLineReady,
  draftPickBadge,
  draftPickText,
  draftReadout,
  samePickInput,
  type DraftGame,
  type PickDraft,
} from './pickDraft';

const game: DraftGame = {
  game_id: 'g1',
  status: 'scheduled',
  scheduled_start: '2026-11-15T21:25:00Z',
  home_team_id: 'sea-id',
  away_team_id: 'sf-id',
  home_team: 'SEA',
  away_team: 'SF',
  home_team_name: 'Seattle Seahawks',
  away_team_name: 'San Francisco 49ers',
};

const kittle = {
  player_id: 'p-kittle',
  first_name: 'George',
  last_name: 'Kittle',
  position: 'TE',
  team: { abbreviation: 'SF' },
};

function draft(patch: Partial<PickDraft>): PickDraft {
  return { ...EMPTY_DRAFT, game, ...patch };
}

describe('player prop draft', () => {
  const over = draft({
    kind: 'PLAYER_PROP',
    player: kittle,
    teamId: 'sf-id',
    playerMarket: 'REC_YDS',
    totalRole: 'over',
    lineText: '60.5',
  });

  it('builds the POST /picks pick and reads like the spread readout', () => {
    expect(buildPickInput(over)).toEqual({
      gameId: 'g1',
      playerId: 'p-kittle',
      condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: 60.5 },
    });
    expect(draftReadout(over)).toBe('Kittle needs 61 or more receiving yards');
    expect(draftPickText(over)).toBe('G. Kittle over 60.5 rec yds');
    expect(draftPickBadge(over)).toBe('SF');
  });

  it('names the refunded tie on a whole-number line, and never says push', () => {
    const under = { ...over, totalRole: 'under' as const, lineText: '5' };
    const sentence = draftReadout({ ...under, playerMarket: 'RECEPTIONS' });
    expect(sentence).toBe(
      'Kittle needs 4 or fewer receptions. Exactly 5 is a tie, and the pick is refunded.',
    );
    expect(sentence?.toLowerCase()).not.toContain('push');
  });

  it('keeps Continue off for a line outside the stat range or off the half point', () => {
    expect(draftLine({ ...over, lineText: '401' })).toEqual({
      ok: false,
      message: 'Line must be between 0.5 and 400.',
    });
    expect(draftLine({ ...over, lineText: '60.25' })).toEqual({
      ok: false,
      message: 'Use steps of 0.5.',
    });
    expect(draftLineReady({ ...over, lineText: '' })).toBe(false);
    expect(draftLineReady({ ...over, totalRole: null })).toBe(false);
    expect(draftLineReady(over)).toBe(true);
    expect(buildPickInput({ ...over, lineText: '0' })).toBeNull();
  });

  it('asks only yes or no for an anytime or first TD', () => {
    const anytime = draft({
      kind: 'PLAYER_PROP',
      player: kittle,
      playerMarket: 'ANYTIME_TD',
      eventSide: 'yes',
    });
    expect(draftLineReady(anytime)).toBe(true);
    expect(buildPickInput(anytime)).toEqual({
      gameId: 'g1',
      playerId: 'p-kittle',
      condition: { type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' },
    });
    expect(draftReadout(anytime)).toBe('Kittle needs to score a touchdown.');
    expect(draftPickText(anytime)).toBe('G. Kittle anytime TD');

    const firstNo = { ...anytime, playerMarket: 'FIRST_TD' as const, eventSide: 'no' as const };
    expect(buildPickInput(firstNo)?.condition).toEqual({
      type: 'PLAYER_EVENT',
      event: 'FIRST_TD',
      side: 'NO',
    });
    expect(draftReadout(firstNo)).toBe("Kittle can't score the game's first touchdown.");
  });

  it('fills the slip with the player and market before the line is set', () => {
    expect(draftPickText(draft({ kind: 'PLAYER_PROP', player: kittle }))).toBe('G. Kittle');
    expect(
      draftPickText(draft({ kind: 'PLAYER_PROP', player: kittle, playerMarket: 'REC_YDS' })),
    ).toBe('G. Kittle · Receiving yards');
  });
});

describe('team and game prop draft', () => {
  it('sends a full-game team total with no segment', () => {
    const total = draft({
      kind: 'TEAM_PROP',
      teamMarket: 'TEAM_TOTAL',
      teamId: 'sf-id',
      period: null,
      totalRole: 'over',
      lineText: '24.5',
    });
    expect(buildPickInput(total)).toEqual({
      gameId: 'g1',
      teamId: 'sf-id',
      condition: { type: 'TEAM_TOTAL_OVER', line: 24.5 },
    });
    expect(draftReadout(total)).toBe('49ers must score 25 or more points');
    expect(draftPickText(total)).toBe('SF team total over 24.5');
  });

  it('sends a quarter spread signed from the picked side and says overtime is out of Q4', () => {
    const spread = draft({
      kind: 'TEAM_PROP',
      teamMarket: 'SEGMENT_SPREAD',
      teamId: 'sea-id',
      period: 'Q4',
      spreadRole: 'favorite',
      lineText: '3',
    });
    expect(buildPickInput(spread)).toEqual({
      gameId: 'g1',
      teamId: 'sea-id',
      condition: { type: 'SPREAD', line: -3, segment: 'Q4' },
    });
    expect(draftReadout(spread)).toBe(
      "Seahawks must win the 4th quarter by 4 or more. Winning the 4th quarter by exactly 3 is a tie, and the pick is refunded. Overtime doesn't count.",
    );
    expect(draftPickText(spread)).toBe('SEA 4Q −3');

    const dog = {
      ...spread,
      spreadRole: 'underdog' as const,
      lineText: '0.5',
      period: 'H1' as const,
    };
    expect(buildPickInput(dog)?.condition).toEqual({ type: 'SPREAD', line: 0.5, segment: 'H1' });
    expect(draftReadout(dog)).toBe('Seahawks must win or tie the 1st half');
  });

  it('waits for a period on a quarter or half market', () => {
    const total = draft({
      kind: 'TEAM_PROP',
      teamMarket: 'SEGMENT_TOTAL',
      period: undefined,
      totalRole: 'under',
      lineText: '20.5',
    });
    expect(draftLineReady(total)).toBe(false);
    expect(buildPickInput(total)).toBeNull();
    const second = { ...total, period: 'H2' as const };
    expect(buildPickInput(second)).toEqual({
      gameId: 'g1',
      condition: { type: 'TOTAL_UNDER', line: 20.5, segment: 'H2' },
    });
    expect(draftReadout(second)).toBe(
      'Combined score in the 2nd half must be 20 or fewer. Overtime counts.',
    );
    expect(draftPickBadge(second)).toBeNull();
  });

  it('sends field goals on the whole game without a team, and on one team with it', () => {
    const both = draft({
      kind: 'TEAM_PROP',
      teamMarket: 'GAME_FG',
      period: null,
      totalRole: 'over',
      lineText: '3.5',
    });
    expect(buildPickInput(both)).toEqual({
      gameId: 'g1',
      condition: { type: 'FG_OVER', line: 3.5 },
    });
    expect(draftReadout(both)).toBe('The two teams must make 4 or more field goals');
    expect(draftPickText(both)).toBe('Total FGs over 3.5');

    const team = {
      ...both,
      teamMarket: 'TEAM_FG' as const,
      teamId: 'sf-id',
      totalRole: 'under' as const,
      lineText: '1.5',
    };
    expect(buildPickInput(team)).toEqual({
      gameId: 'g1',
      teamId: 'sf-id',
      condition: { type: 'FG_UNDER', line: 1.5 },
    });
    expect(draftReadout(team)).toBe('49ers must make 1 or fewer field goals');
  });

  it('needs only a team for first to score', () => {
    const first = draft({ kind: 'TEAM_PROP', teamMarket: 'FIRST_TO_SCORE', teamId: 'sf-id' });
    expect(buildPickInput(first)).toEqual({
      gameId: 'g1',
      teamId: 'sf-id',
      condition: { type: 'FIRST_TO_SCORE' },
    });
    expect(draftReadout(first)).toBe('49ers must score first.');
    expect(draftPickText(first)).toBe('SF to score first');
  });
});

describe('existing pick types through POST /picks', () => {
  it('builds the same spread, total, moneyline, and survivor bodies the old route took', () => {
    expect(
      buildPickInput(
        draft({ kind: 'SPREAD', teamId: 'sea-id', spreadRole: 'favorite', lineText: '3.5' }),
      ),
    ).toEqual({ gameId: 'g1', teamId: 'sea-id', condition: { type: 'SPREAD', line: -3.5 } });
    expect(buildPickInput(draft({ kind: 'TOTAL', totalRole: 'under', lineText: '47.5' }))).toEqual({
      gameId: 'g1',
      condition: { type: 'TOTAL_UNDER', line: 47.5 },
    });
    expect(buildPickInput(draft({ kind: 'MONEYLINE', teamId: 'sf-id' }))).toEqual({
      gameId: 'g1',
      teamId: 'sf-id',
      condition: { type: 'MONEYLINE', side: 'TEAM' },
    });
    expect(buildPickInput(draft({ kind: 'SURVIVOR', teamId: 'sf-id' }))).toEqual({
      gameId: 'g1',
      teamId: 'sf-id',
      condition: { type: 'SURVIVOR' },
    });
  });

  it('keeps the old slip text and readout for a spread', () => {
    const spread = draft({
      kind: 'SPREAD',
      teamId: 'sea-id',
      spreadRole: 'underdog',
      lineText: '3',
    });
    expect(draftPickText(spread)).toBe('SEA +3');
    expect(draftReadout(spread)).toBe(
      'Seahawks must lose by 2 or less, or win. Losing by exactly 3 is a tie, and the pick is refunded.',
    );
  });
});

describe('parlay legs', () => {
  it('treats the same pick with its keys in another order as the same leg', () => {
    expect(
      samePickInput(
        { gameId: 'g1', teamId: 't', condition: { type: 'SPREAD', line: -3 } },
        { teamId: 't', condition: { line: -3, type: 'SPREAD' }, gameId: 'g1' },
      ),
    ).toBe(true);
    expect(
      samePickInput(
        { gameId: 'g1', teamId: 't', condition: { type: 'SPREAD', line: -3 } },
        { gameId: 'g1', teamId: 't', condition: { type: 'SPREAD', line: -3, segment: 'H1' } },
      ),
    ).toBe(false);
  });
});
