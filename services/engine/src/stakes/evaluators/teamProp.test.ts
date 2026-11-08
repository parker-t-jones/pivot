import { describe, expect, it } from 'vitest';
import { evaluateStake } from '../evaluateStake.js';
import {
  ctx,
  game,
  HOME,
  stake,
  stats,
  TEAM_ATL,
  TEAM_GB,
  WHOLE_GAME,
  AWAY,
} from '../progress/testFixtures.js';
import { evaluateSpreadSwing } from './spreadSwing.js';
import { evaluateTeamProp, TEAM_PROP_LEVERAGE, TEAM_PROP_RED_ZONE_LEVERAGE } from './teamProp.js';
import { evaluateTotalSwing } from './totalSwing.js';

const atlTotal = stake({ type: 'TEAM_TOTAL_OVER', line: 24.5 }, TEAM_ATL);

describe('evaluateTeamProp', () => {
  it('nudges only while that team has the ball', () => {
    expect(evaluateTeamProp(atlTotal, ctx({ game: game({ possessionTeamId: AWAY }) }))).toEqual([
      expect.objectContaining({
        code: 'TEAM_PROP_POSSESSION',
        kind: 'NUDGE',
        leverage: TEAM_PROP_LEVERAGE,
      }),
    ]);
    expect(evaluateTeamProp(atlTotal, ctx({ game: game({ possessionTeamId: HOME }) }))).toEqual([]);
    expect(evaluateTeamProp(atlTotal, ctx({ game: game({ possessionTeamId: null }) }))).toEqual([]);
  });

  it('uses the red-zone leverage inside the 20', () => {
    const [trigger] = evaluateTeamProp(atlTotal, ctx({ game: game({ inRedZone: true }) }));
    expect(trigger?.leverage).toBe(TEAM_PROP_RED_ZONE_LEVERAGE);
  });

  it('still nudges once decided, at zero leverage', () => {
    const [trigger] = evaluateTeamProp(atlTotal, ctx({ game: game({ scoreAway: 28 }) }));
    expect(trigger).toMatchObject({ code: 'TEAM_PROP_POSSESSION', leverage: 0 });
    const first = stake({ type: 'FIRST_TO_SCORE' }, TEAM_ATL);
    const scored = ctx({
      playerStats: stats({ scoringPlays: [{ teamId: HOME, period: 1, kind: 'TD', text: '' }] }),
    });
    expect(evaluateTeamProp(first, scored)[0]?.leverage).toBe(0);
  });

  it('is active only during its segment', () => {
    const q1 = stake({ type: 'TEAM_TOTAL_OVER', line: 3.5, segment: 'Q1' }, TEAM_ATL);
    expect(evaluateTeamProp(q1, ctx({ game: game({ quarter: 1 }) }))).toHaveLength(1);
    expect(evaluateTeamProp(q1, ctx({ game: game({ quarter: 2 }) }))).toEqual([]);
  });

  it('routes team FG props here and keeps the game-wide FG total in-app only', () => {
    expect(evaluateStake(stake({ type: 'FG_OVER', line: 1.5 }, TEAM_ATL), ctx())).toHaveLength(1);
    expect(evaluateStake(stake({ type: 'FG_OVER', line: 3.5 }, WHOLE_GAME), ctx())).toEqual([]);
  });
});

describe('segment spread and total swings', () => {
  const linescores = { home: [7, 0], away: [7, 10] };

  it('leaves the full-game spread on the live score in Q4 (unchanged)', () => {
    const full = stake({ type: 'SPREAD', line: 3.5 }, TEAM_GB);
    const state = game({ quarter: 4, timeRemainingSec: 200, scoreHome: 14, scoreAway: 17 });
    expect(evaluateSpreadSwing(full, ctx({ game: state }))).toHaveLength(1);
    expect(evaluateSpreadSwing(full, ctx({ game: { ...state, quarter: 3 } }))).toEqual([]);
  });

  it('fires an H1 spread swing in Q2 from linescores, not the live score', () => {
    const h1 = stake({ type: 'SPREAD', line: 7.5, segment: 'H1' }, TEAM_GB);
    const state = game({ quarter: 2, scoreHome: 40, scoreAway: 0 });
    expect(
      evaluateSpreadSwing(h1, ctx({ game: state, playerStats: stats({ linescores }) })),
    ).toEqual([expect.objectContaining({ code: 'SPREAD_SWING', kind: 'REVEAL' })]);
    expect(
      evaluateSpreadSwing(
        h1,
        ctx({ game: { ...state, quarter: 1 }, playerStats: stats({ linescores }) }),
      ),
    ).toEqual([]);
    expect(
      evaluateSpreadSwing(
        h1,
        ctx({ game: { ...state, quarter: 3 }, playerStats: stats({ linescores }) }),
      ),
    ).toEqual([]);
  });

  it('fires a quarter total swing only in the last 5:00 of that quarter', () => {
    const q2 = stake({ type: 'TOTAL_OVER', line: 13.5, segment: 'Q2' }, WHOLE_GAME);
    const s = stats({ linescores });
    expect(
      evaluateTotalSwing(
        q2,
        ctx({ game: game({ quarter: 2, timeRemainingSec: 300 }), playerStats: s }),
      ),
    ).toHaveLength(1);
    expect(
      evaluateTotalSwing(
        q2,
        ctx({ game: game({ quarter: 2, timeRemainingSec: 301 }), playerStats: s }),
      ),
    ).toEqual([]);
  });

  it('leaves the full-game total swing unchanged', () => {
    const full = stake({ type: 'TOTAL_OVER', line: 45.5 }, WHOLE_GAME);
    expect(
      evaluateTotalSwing(full, ctx({ game: game({ quarter: 4, scoreHome: 20, scoreAway: 20 }) })),
    ).toHaveLength(1);
    expect(
      evaluateTotalSwing(full, ctx({ game: game({ quarter: 4, scoreHome: 20, scoreAway: 10 }) })),
    ).toEqual([]);
  });
});
