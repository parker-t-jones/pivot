import { describe, expect, it } from 'vitest';
import type { RecapPage, RecapPickSummary, RecapWeek } from './picksClient';
import { recapHistoryModel, recapResultLabel } from './recapHistory';

const EMPTY_TOTALS = {
  picks_made: 0,
  won: 0,
  lost: 0,
  tie: 0,
  void: 0,
  decided: 0,
  hit_rate: null,
  best: null,
  worst: null,
};

function pick(id: string, overrides: Partial<RecapPickSummary> = {}): RecapPickSummary {
  return {
    id,
    label: `Pick ${id}`,
    result: 'won',
    result_value: null,
    game_id: 'g1',
    slip_id: null,
    ...overrides,
  };
}

function week(n: number, overrides: Partial<RecapWeek> = {}): RecapWeek {
  return { ...EMPTY_TOTALS, week: n, picks: [], ...overrides };
}

function page(overrides: Partial<RecapPage> = {}): RecapPage {
  return {
    week: 10,
    season: 2026,
    week_recap: EMPTY_TOTALS,
    season_recap: { won: 0, decided: 0, hit_rate: null },
    weeks: [],
    ...overrides,
  };
}

describe('recapHistoryModel', () => {
  it('is empty with no graded weeks', () => {
    const model = recapHistoryModel(page());
    expect(model.isEmpty).toBe(true);
    expect(model.weeks).toEqual([]);
    expect(model.seasonLine).toBe('No picks won or lost this season yet.');
  });

  it('keeps the API order (most recent first) and builds each week line', () => {
    const best = pick('b', { label: 'J. Gibbs over 120.5 rush + rec yds' });
    const worst = pick('w', { label: 'DET -3.5', result: 'lost' });
    const model = recapHistoryModel(
      page({
        season_recap: { won: 1, decided: 2, hit_rate: 0.5 },
        weeks: [
          week(10, {
            picks_made: 2,
            won: 1,
            lost: 1,
            decided: 2,
            hit_rate: 0.5,
            best,
            worst,
            picks: [best, worst],
          }),
          week(8, { picks_made: 1, tie: 1, picks: [pick('t', { result: 'tie' })] }),
        ],
      }),
    );
    expect(model.isEmpty).toBe(false);
    expect(model.seasonLine).toBe('1 of 2 hit this season (50%)');
    expect(model.weeks.map((w) => w.eyebrow)).toEqual(['WEEK 10', 'WEEK 8']);
    expect(model.weeks[0]).toMatchObject({
      weekLine: '1 of 2 hit (50%)',
      bestLabel: 'J. Gibbs over 120.5 rush + rec yds · Won',
      worstLabel: 'DET -3.5 · Lost',
    });
    expect(model.weeks[0]?.picks.map((p) => [p.label, p.resultLabel, p.tone])).toEqual([
      ['J. Gibbs over 120.5 rush + rec yds', 'Won', 'won'],
      ['DET -3.5', 'Lost', 'lost'],
    ]);
    expect(model.weeks[1]).toMatchObject({
      weekLine: '1 pick, tied or refunded',
      bestLabel: null,
      worstLabel: null,
    });
  });

  it('says tie or refunded, never push, for picks that were neither won nor lost', () => {
    expect(recapResultLabel('tie')).toBe('Tie');
    expect(recapResultLabel('void')).toBe('Refunded');
    const model = recapHistoryModel(
      page({
        weeks: [
          week(9, {
            picks_made: 2,
            tie: 1,
            void: 1,
            picks: [pick('t', { result: 'tie' }), pick('v', { result: 'void' })],
          }),
        ],
      }),
    );
    expect(model.weeks[0]?.weekLine).toBe('2 picks, all tied or refunded');
    const copy = JSON.stringify(model);
    expect(copy).not.toMatch(/push/i);
    expect(copy).not.toMatch(/stake/i);
    expect(model.weeks[0]?.picks.map((p) => p.tone)).toEqual(['neutral', 'neutral']);
  });

  it('marks parlay legs and drops picks without a label', () => {
    const model = recapHistoryModel(
      page({
        weeks: [
          week(7, {
            picks_made: 2,
            won: 1,
            decided: 1,
            hit_rate: 1,
            picks: [pick('leg', { slip_id: 's1', label: 'PHI ML' }), pick('blank', { label: '' })],
          }),
        ],
      }),
    );
    expect(model.weeks[0]?.picks.map((p) => p.label)).toEqual(['PHI ML · Parlay leg']);
  });

  it('falls back to this week alone when the API predates the weeks list', () => {
    const best = pick('b', { label: 'S. Barkley over 89.5 rush yds' });
    const model = recapHistoryModel(
      page({
        weeks: undefined,
        week_recap: { ...EMPTY_TOTALS, picks_made: 1, won: 1, decided: 1, hit_rate: 1, best },
        season_recap: { won: 1, decided: 1, hit_rate: 1 },
      }),
    );
    expect(model.weeks).toHaveLength(1);
    expect(model.weeks[0]).toMatchObject({
      week: 10,
      weekLine: '1 of 1 hit (100%)',
      bestLabel: 'S. Barkley over 89.5 rush yds · Won',
      picks: [],
    });
    expect(recapHistoryModel(page({ weeks: undefined })).isEmpty).toBe(true);
  });
});
