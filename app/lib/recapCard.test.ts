import { describe, expect, it } from 'vitest';
import { recapCardModel } from './recapCard';
import type { RecapPage } from './picksClient';

function page(overrides: Partial<RecapPage> = {}): RecapPage {
  return {
    week: 9,
    season: 2026,
    week_recap: {
      picks_made: 0,
      won: 0,
      lost: 0,
      tie: 0,
      void: 0,
      decided: 0,
      hit_rate: null,
      best: null,
      worst: null,
    },
    season_recap: { won: 0, decided: 0, hit_rate: null },
    ...overrides,
  };
}

describe('recapCardModel', () => {
  it('is empty with no graded picks this week, regardless of season history', () => {
    const model = recapCardModel(page());
    expect(model.isEmpty).toBe(true);
    expect(model.weekLine).toBeNull();
  });

  it('is a hit-rate line with picks decided', () => {
    const model = recapCardModel(
      page({
        week_recap: {
          picks_made: 5,
          won: 3,
          lost: 2,
          tie: 0,
          void: 0,
          decided: 5,
          hit_rate: 0.6,
          best: null,
          worst: null,
        },
      }),
    );
    expect(model.isEmpty).toBe(false);
    expect(model.weekLine).toBe('3 of 5 hit (60%)');
  });

  it('has picks made but no weekLine when nothing is decided yet (all tie/void)', () => {
    const model = recapCardModel(
      page({
        week_recap: {
          picks_made: 2,
          won: 0,
          lost: 0,
          tie: 1,
          void: 1,
          decided: 0,
          hit_rate: null,
          best: null,
          worst: null,
        },
      }),
    );
    expect(model.isEmpty).toBe(false);
    expect(model.weekLine).toBeNull();
  });

  it('labels the best and worst pick with their outcome', () => {
    const model = recapCardModel(
      page({
        week_recap: {
          picks_made: 2,
          won: 1,
          lost: 1,
          tie: 0,
          void: 0,
          decided: 2,
          hit_rate: 0.5,
          best: { id: 'a', label: 'B. Robinson Over 79.5 rush yds', result: 'won', result_value: 140, game_id: 'g1' },
          worst: { id: 'b', label: 'ATL -3.5', result: 'lost', result_value: -14, game_id: 'g2' },
        },
      }),
    );
    expect(model.bestLabel).toBe('B. Robinson Over 79.5 rush yds · Won');
    expect(model.worstLabel).toBe('ATL -3.5 · Lost');
  });

  it('has no best/worst label when the pick carries no label', () => {
    const model = recapCardModel(
      page({
        week_recap: {
          picks_made: 1,
          won: 1,
          lost: 0,
          tie: 0,
          void: 0,
          decided: 1,
          hit_rate: 1,
          best: { id: 'a', label: '', result: 'won', result_value: null, game_id: 'g1' },
          worst: null,
        },
      }),
    );
    expect(model.bestLabel).toBeNull();
  });

  it('is a season hit-rate line with season picks decided', () => {
    const model = recapCardModel(page({ season_recap: { won: 9, decided: 14, hit_rate: 9 / 14 } }));
    expect(model.seasonLine).toBe('9 of 14 hit this season (64%)');
  });

  it('has no season line with nothing decided all season', () => {
    const model = recapCardModel(page());
    expect(model.seasonLine).toBeNull();
  });
});
