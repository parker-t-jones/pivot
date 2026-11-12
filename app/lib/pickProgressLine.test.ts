import { describe, expect, it } from 'vitest';

import {
  isLegacyPick,
  legStateLabel,
  parlaySummaryLine,
  pickProgressLine,
} from './pickProgressLine';

const recYds = { type: 'STAT_OVER', stat: 'REC_YDS' };

describe('pick progress line', () => {
  it('shows a live over as the stat and what is left to clear it', () => {
    expect(
      pickProgressLine({
        condition: recYds,
        progress: { status: 'live', current: 42, line: 60.5, needed: 19 },
      }),
    ).toBe('42 rec yds · 19 to go');
    expect(
      pickProgressLine({
        condition: { type: 'TEAM_TOTAL_UNDER' },
        progress: { status: 'live', current: 10, line: 20.5, needed: 10 },
      }),
    ).toBe('10 pts · 10 to spare');
  });

  it('names a tie and a did-not-play as refunded, never a push', () => {
    const tie = pickProgressLine({
      condition: recYds,
      progress: { status: 'tie', current: 60, line: 60 },
    });
    expect(tie).toBe('Tie · refunded · 60 rec yds');
    expect(pickProgressLine({ condition: recYds, progress: { status: 'void' } })).toBe(
      'Refunded · did not play',
    );
    expect(`${tie}`.toLowerCase()).not.toContain('push');
  });

  it('says nothing before the game and reads a quarter spread as a margin', () => {
    expect(pickProgressLine({ condition: recYds, progress: { status: 'pending' } })).toBeNull();
    expect(
      pickProgressLine({
        condition: { type: 'SPREAD', segment: 'H1' },
        progress: { status: 'live', current: -2.5 },
      }),
    ).toBe('Short by 2.5');
    expect(
      pickProgressLine({ condition: { type: 'FIRST_TO_SCORE' }, progress: { status: 'live' } }),
    ).toBe('No score yet');
  });

  it('leaves the four original types to their score bar', () => {
    expect(isLegacyPick({ condition: { type: 'SPREAD' } })).toBe(true);
    expect(isLegacyPick({ condition: { type: 'SPREAD', segment: 'Q1' } })).toBe(false);
    expect(isLegacyPick({ condition: { type: 'STAT_OVER' } })).toBe(false);
  });
});

describe('parlay summary', () => {
  it('counts hit and open legs while live, leaving refunded legs out', () => {
    expect(
      parlaySummaryLine({ status: 'live', legs: 4, hit: 1, alive: 2, lost: 0, refunded: 1 }),
    ).toBe('1 of 3 legs hit · 2 still open · 1 refunded');
    expect(
      parlaySummaryLine({ status: 'lost', legs: 3, hit: 1, alive: 1, lost: 1, refunded: 0 }),
    ).toBe('Lost · 1 of 3 legs missed');
    expect(
      parlaySummaryLine({ status: 'pending', legs: 2, hit: 0, alive: 2, lost: 0, refunded: 0 }),
    ).toBeNull();
  });

  it('gives each leg a short state', () => {
    expect(legStateLabel({ status: 'live' })).toBe('Live');
    expect(legStateLabel({ status: 'tie' })).toBe('Refunded');
    expect(legStateLabel({ status: 'pending' })).toBeNull();
  });
});

it('shows combined yards on settled picks and refunds a DNP', () => {
  const condition = { type: 'STAT_UNDER', stat: 'RUSH_REC_YDS' };
  expect(pickProgressLine({ condition, progress: { status: 'tie', current: 46 } })).toBe(
    'Tie · refunded · 46 rush + rec yds',
  );
  expect(pickProgressLine({ condition, progress: { status: 'void' } })).toBe(
    'Refunded · did not play',
  );
});
