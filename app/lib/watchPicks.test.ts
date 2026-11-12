import { describe, expect, it } from 'vitest';

import { removalKeepsFreeSlot, removePickMessage, REMOVE_STARTED_PICK_NOTE } from './stakes';
import { freeBetCount } from './weekCardModel';
import {
  flattenParlays,
  parlayFocusLeg,
  watchPickLabel,
  watchPicksResponse,
  type PicksApiPick,
  type PicksApiResponse,
} from './watchPicks';

function game(id: string, status: string, start: string) {
  return {
    scheduled_start: start,
    status,
    home_team_id: `${id}-home`,
    away_team_id: `${id}-away`,
    home_team: 'SEA',
    away_team: 'SF',
    home_team_name: 'Seattle Seahawks',
    away_team_name: 'San Francisco 49ers',
  };
}

function pick(id: string, patch: Partial<PicksApiPick> = {}): PicksApiPick {
  return {
    id,
    season: 2026,
    week: 11,
    game_id: 'g1',
    source: 'MANUAL',
    weight: 1,
    subject: { type: 'TEAM', teamId: 'g1-home' },
    condition: { type: 'SPREAD', line: -3.5 },
    slip_id: null,
    label: 'SEA −3.5',
    game: game('g1', 'scheduled', '2026-11-15T21:25:00Z'),
    progress: { status: 'pending' },
    ...patch,
  };
}

const prop = pick('p1', {
  subject: { type: 'PLAYER', playerId: 'kittle', teamId: 'g1-away' },
  condition: { type: 'STAT_OVER', line: 60.5 },
  label: 'G. Kittle over 60.5 rec yds',
  progress: { status: 'live', current: 42, line: 60.5, needed: 19 },
});

const legEarly = pick('l1', {
  slip_id: 's1',
  game_id: 'g0',
  game: game('g0', 'final', '2026-11-15T18:00:00Z'),
  condition: { type: 'MONEYLINE', side: 'TEAM' },
  label: 'SEA ML',
  progress: { status: 'won' },
});
const legLive = pick('l2', {
  slip_id: 's1',
  game_id: 'g2',
  game: game('g2', 'in_progress', '2026-11-15T21:05:00Z'),
  label: 'Over 44.5',
  condition: { type: 'TOTAL_OVER', line: 44.5 },
  progress: { status: 'live', current: 30, line: 44.5, needed: 15 },
});

const response: PicksApiResponse = {
  week: 11,
  free_limit: 3,
  free_slots_used: 3,
  picks: [prop, pick('surv', { condition: { type: 'SURVIVOR' }, label: 'Survivor · SEA' })],
  slips: [
    {
      id: 's1',
      season: 2026,
      week: 11,
      created_at: '2026-11-14T00:00:00Z',
      result: null,
      summary: { status: 'live', legs: 2, hit: 1, alive: 1, lost: 0, refunded: 0 },
      legs: [legLive, legEarly],
    },
  ],
};

/** Array element that the test expects to exist. */
function at<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`no row at ${index}`);
  return row;
}

const baseSlip = at(response.slips, 0);

describe('GET /picks for the Watchlist and Home', () => {
  const page = watchPicksResponse(response);

  it('keeps each single with its label and progress, and makes each parlay one row', () => {
    expect(page.stakes.map((row) => row.id)).toEqual(['p1', 'surv', 's1']);
    const [single, , parlay] = page.stakes;
    expect(single?.label).toBe('G. Kittle over 60.5 rec yds');
    expect(single?.progress).toEqual({ status: 'live', current: 42, line: 60.5, needed: 19 });
    expect(parlay?.condition.type).toBe('PARLAY');
    expect(parlay?.label).toBe('2-leg parlay');
    expect(parlay?.legs?.map((leg) => leg.id)).toEqual(['l2', 'l1']);
    expect(parlay?.summary?.hit).toBe(1);
  });

  it('orders a parlay by its live leg', () => {
    const parlay = page.stakes[2];
    expect(parlay?.game_id).toBe('g2');
    expect(parlay?.game?.status).toBe('in_progress');
  });

  it("matches the API's free count: every parlay leg uses a slot and survivor is free", () => {
    // Prop (1) + parlay legs (2) use all 3 slots; survivor uses none.
    expect(page.free_slots_spent).toBe(0);
    expect(freeBetCount(page.stakes, page.free_slots_spent)).toBe(3);
  });

  it('never reports a negative spent count', () => {
    expect(watchPicksResponse({ ...response, free_slots_used: 0 }).free_slots_spent).toBe(0);
  });

  it('puts every parlay leg on its own game for Home', () => {
    expect(flattenParlays(page.stakes).map((row) => `${row.id}:${row.game_id}`)).toEqual([
      'p1:g1',
      'surv:g1',
      'l2:g2',
      'l1:g0',
    ]);
  });

  it('labels a row with the API label, and a parlay by its leg count', () => {
    expect(watchPickLabel(at(page.stakes, 0))).toBe('G. Kittle over 60.5 rec yds');
    expect(watchPickLabel({ ...at(page.stakes, 2), label: '' })).toBe('2-leg parlay');
  });
});

describe('parlay focus leg', () => {
  it('prefers a live leg, then the next kickoff, then the last final', () => {
    const scheduled = {
      ...legLive,
      id: 'l3',
      game_id: 'g3',
      game: game('g3', 'scheduled', '2026-11-16T01:20:00Z'),
    };
    const [a, b, c] = watchPicksResponse({
      ...response,
      picks: [],
      slips: [
        { ...baseSlip, id: 'live', legs: [scheduled, legLive, legEarly] },
        { ...baseSlip, id: 'next', legs: [legEarly, scheduled] },
        { ...baseSlip, id: 'done', legs: [legEarly] },
      ],
    }).stakes;
    expect(a?.game_id).toBe('g2');
    expect(b?.game_id).toBe('g3');
    expect(c?.game_id).toBe('g0');
    expect(parlayFocusLeg([])).toBeNull();
  });
});

describe('removing a parlay', () => {
  const now = new Date('2026-11-15T19:00:00Z');
  const parlayRow = (legs: PicksApiPick[]) =>
    at(watchPicksResponse({ ...response, picks: [], slips: [{ ...baseSlip, legs }] }).stakes, 0);

  it('keeps every leg spent once any leg has kicked off', () => {
    const started = parlayRow([
      pick('a', { game: game('a', 'scheduled', '2026-11-15T18:00:00Z') }),
      pick('b', { game: game('b', 'scheduled', '2026-11-16T01:20:00Z') }),
    ]);
    expect(removalKeepsFreeSlot(started, now)).toBe(true);
    const spent = freeBetCount([started]);
    expect(spent).toBe(2);
    expect(freeBetCount([], spent)).toBe(2);
    expect(removePickMessage(started, '2-leg parlay', { isPro: false, now })).toBe(
      `2-leg parlay\n\n${REMOVE_STARTED_PICK_NOTE}`,
    );
    expect(removePickMessage(started, '2-leg parlay', { isPro: true, now })).toBe('2-leg parlay');
  });

  it('refunds every leg before every leg kicks off', () => {
    const upcoming = parlayRow([
      pick('a', { game: game('a', 'scheduled', '2026-11-15T21:25:00Z') }),
      pick('b', { game: game('b', 'scheduled', '2026-11-16T01:20:00Z') }),
    ]);
    expect(removalKeepsFreeSlot(upcoming, now)).toBe(false);
  });
});
