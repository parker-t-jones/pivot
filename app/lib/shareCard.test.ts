import { describe, expect, it } from 'vitest';

import type { PickCardModel } from './pickCard';
import { pickCardShareContent, weekCardShareContent } from './shareCard';
import { weekCardModel } from './weekCardModel';

describe('weekCardShareContent', () => {
  it('carries the week and the four cells, with the brand mark and no account info', () => {
    const content = weekCardShareContent(
      weekCardModel({
        starterCount: 9,
        opponentStatus: 'on',
        betCount: 1,
        survivorCount: 1,
        isPro: false,
        week: 9,
        gameCount: 6,
      }),
    );
    expect(content.title).toBe('YOUR WEEK 9 CARD');
    expect(content.subtitle).toBe('6 GAMES');
    expect(content.rows.map((row) => row.label)).toEqual([
      'Fantasy',
      'Opponent',
      'Bets & props',
      'Survivor pool',
    ]);
    expect(content.rows.find((row) => row.label === 'Opponent')?.value).toBe('Tracking');
    expect(content.footer).toBe('PIVOT');
    const serialized = JSON.stringify(content);
    expect(serialized).not.toMatch(/@|subscription|email|user_id|userId/i);
  });

  it('hides the game count when it is unknown, matching the live card', () => {
    const content = weekCardShareContent(
      weekCardModel({
        starterCount: 9,
        opponentStatus: 'off',
        betCount: 0,
        survivorCount: 0,
        isPro: false,
        week: 9,
        gameCount: null,
      }),
    );
    expect(content.subtitle).toBeNull();
  });

  it('carries a free user’s free-allowance note on the Bets & props row', () => {
    const content = weekCardShareContent(
      weekCardModel({
        starterCount: 0,
        opponentStatus: 'off',
        betCount: 1,
        survivorCount: 0,
        isPro: false,
      }),
    );
    expect(content.rows.find((row) => row.label === 'Bets & props')?.note).toBe('2 free left');
  });
});

const pick: PickCardModel = {
  eyebrow: 'SPREAD',
  pick: 'DET −3.5',
  awayTeam: 'DET',
  homeTeam: 'GB',
  matchup: 'DET @ GB',
  status: 'FINAL',
  phase: 'final',
  progress: null,
  axisLabel: '',
  detail: null,
  legs: [],
};

describe('pickCardShareContent', () => {
  it('carries the team matchup and the pick label', () => {
    const content = pickCardShareContent(pick, 9);
    expect(content.title).toBe('DET −3.5');
    expect(content.subtitle).toBe('DET @ GB');
    expect(content.rows).toEqual([
      { label: 'SPREAD', value: 'DET −3.5' },
      { label: 'Status', value: 'FINAL' },
    ]);
    expect(content.footer).toBe('PIVOT · WEEK 9');
  });

  it('includes the detail line for props, and drops the week from the footer when unknown', () => {
    const content = pickCardShareContent(
      { ...pick, eyebrow: 'PROP', detail: 'Live · 62 yds of 84.5' },
      null,
    );
    expect(content.rows).toEqual([
      { label: 'PROP', value: 'DET −3.5' },
      { label: 'Detail', value: 'Live · 62 yds of 84.5' },
      { label: 'Status', value: 'FINAL' },
    ]);
    expect(content.footer).toBe('PIVOT');
  });

  it('drops the subtitle when there is no game (e.g. a totals-only stake with no matchup)', () => {
    const content = pickCardShareContent({ ...pick, matchup: '' }, 9);
    expect(content.subtitle).toBeNull();
  });
});
