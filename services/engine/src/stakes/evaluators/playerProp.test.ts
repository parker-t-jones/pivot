import { describe, expect, it } from 'vitest';
import {
  ctx,
  ESPN_ID,
  game,
  HOME,
  line,
  player,
  stake,
  stats,
  AWAY,
} from '../progress/testFixtures.js';
import type { Stake } from '../types.js';
import { evaluatePlayerProp, propPlayerCache, propProximity } from './playerProp.js';
import { evaluateRostered } from './rostered.js';

const rushOver = stake({ type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 });
const rushUnder = stake({ type: 'STAT_UNDER', stat: 'RUSH_YDS', line: 89.5 });

function withRush(yards: number) {
  return stats({ players: { [ESPN_ID]: line({ RUSH_YDS: yards }) } });
}

function codes(s: Stake, c = ctx()): string[] {
  return evaluatePlayerProp(s, c).map((trigger) => trigger.code);
}

describe('evaluatePlayerProp: activity', () => {
  it('nudges exactly when the fantasy rule says the player is active', () => {
    const rosteredStake = stake({ type: 'ROSTERED' });
    const lineup = propPlayerCache(player());
    for (const state of [
      game({ possessionTeamId: AWAY }),
      game({ possessionTeamId: HOME }),
      game({ possessionTeamId: AWAY, inRedZone: true, yardsToOpponentEndzone: 8 }),
    ]) {
      const fantasyActive =
        evaluateRostered(rosteredStake, ctx({ game: state, lineup })).length > 0;
      const propActive = codes(rushOver, ctx({ game: state })).includes('PROP_LIVE_POSSESSION');
      expect(propActive).toBe(fantasyActive);
    }
    expect(codes(rushOver, ctx({ game: game({ possessionTeamId: AWAY }) }))).toContain(
      'PROP_LIVE_POSSESSION',
    );
    expect(codes(rushOver, ctx({ game: game({ possessionTeamId: HOME }) }))).toEqual([]);
  });

  it('nudges a prop that has already cleared, at zero leverage, so the nudge never reveals it', () => {
    const [nudge] = evaluatePlayerProp(rushOver, ctx({ playerStats: withRush(120) }));
    expect(nudge).toMatchObject({ code: 'PROP_LIVE_POSSESSION', kind: 'NUDGE', leverage: 0 });
  });

  it('marks the possession trigger a NUDGE and near triggers REVEALs', () => {
    const triggers = evaluatePlayerProp(rushOver, ctx({ playerStats: withRush(80) }));
    expect(triggers.map((t) => [t.code, t.kind])).toEqual([
      ['PROP_LIVE_POSSESSION', 'NUDGE'],
      ['PROP_NEAR', 'REVEAL'],
    ]);
  });

  it('is silent before kickoff, after final, for another game, or without the resolved player', () => {
    expect(codes(rushOver, ctx({ game: game({ status: 'scheduled' }) }))).toEqual([]);
    expect(codes(rushOver, ctx({ game: game({ status: 'final' }) }))).toEqual([]);
    expect(codes({ ...rushOver, gameId: 'other' })).toEqual([]);
    const noPlayer = ctx();
    delete noPlayer.player;
    expect(codes(rushOver, noPlayer)).toEqual([]);
  });

  it('treats a defensive player as active when the opponent has the ball', () => {
    const def = ctx({
      player: player({ unit: 'defense' }),
      game: game({ possessionTeamId: HOME }),
    });
    expect(codes(rushOver, def)).toContain('PROP_LIVE_POSSESSION');
  });
});

describe('evaluatePlayerProp: near and danger', () => {
  const off = (yards: number) =>
    ctx({ game: game({ possessionTeamId: HOME }), playerStats: withRush(yards) });

  it('fires PROP_NEAR at exactly 80% of the line', () => {
    const over100 = stake({ type: 'STAT_OVER', stat: 'RUSH_YDS', line: 100 });
    expect(codes(over100, off(80))).toEqual(['PROP_NEAR']);
    expect(codes(over100, off(79))).toEqual([]);
  });

  it('fires PROP_NEAR within one big play of the line below 80%', () => {
    const over50 = stake({ type: 'STAT_OVER', stat: 'RUSH_YDS', line: 50.5 });
    expect(codes(over50, off(36))).toEqual(['PROP_NEAR']); // needs 15
    expect(codes(over50, off(35))).toEqual([]); // needs 16, 69%
  });

  it('never fires near while the stat is still 0', () => {
    const over = stake({ type: 'STAT_OVER', stat: 'RECEPTIONS', line: 0.5 });
    expect(codes(over, off(0))).toEqual([]);
  });

  it('stops PROP_NEAR once the over has cleared', () => {
    expect(codes(rushOver, off(90))).toEqual([]);
  });

  it('fires PROP_DANGER for an under that one big play would bust', () => {
    expect(codes(rushUnder, off(76))).toEqual(['PROP_DANGER']); // 80% of 89.5 is 71.6
    const under50 = stake({ type: 'STAT_UNDER', stat: 'RUSH_YDS', line: 50.5 });
    expect(codes(under50, off(36))).toEqual(['PROP_DANGER']); // room 14
    expect(codes(under50, off(35))).toEqual([]); // room 15
    expect(codes(rushUnder, off(95))).toEqual([]); // already over
  });

  it('never sends near or danger for yes/no props', () => {
    const anytime = stake({ type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' });
    expect(codes(anytime, off(50))).toEqual([]);
  });
});

describe('evaluatePlayerProp: leverage', () => {
  it('rises as the prop gets closer to clearing', () => {
    const lev = (yards: number) =>
      evaluatePlayerProp(rushOver, ctx({ playerStats: withRush(yards) }))[0]?.leverage ?? -1;
    expect(lev(70)).toBeGreaterThan(lev(30));
    expect(lev(30)).toBeGreaterThan(0);
  });

  it('adds the red-zone bonus to TD props, capped at 1', () => {
    const td = stake({ type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' });
    const field = evaluatePlayerProp(td, ctx())[0]?.leverage ?? 0;
    const rz =
      evaluatePlayerProp(td, ctx({ game: game({ inRedZone: true, yardsToOpponentEndzone: 5 }) }))[0]
        ?.leverage ?? 0;
    expect(rz).toBeGreaterThan(field);
    expect(rz).toBeLessThanOrEqual(1);
  });

  it('maps proximity onto [0, 1] in big plays', () => {
    expect(propProximity(0, 'RUSH_YDS')).toBe(1);
    expect(propProximity(15, 'RUSH_YDS')).toBe(0.5);
    expect(propProximity(30, 'RUSH_YDS')).toBe(0);
    expect(propProximity(100, 'RUSH_YDS')).toBe(0);
  });
});

describe('RUSH_REC_YDS evaluator', () => {
  it.each([
    ['STAT_OVER', 31, 'PROP_NEAR'],
    ['STAT_UNDER', 31, 'PROP_DANGER'],
  ] as const)('uses the 20-yard big-play threshold for %s', (type, current, code) => {
    const pick = stake({ type, stat: 'RUSH_REC_YDS', line: 50.5 });
    const context = (yards: number) =>
      ctx({
        game: game({ possessionTeamId: HOME }),
        playerStats: stats({ players: { [ESPN_ID]: line({ RUSH_REC_YDS: yards }) } }),
      });
    expect(codes(pick, context(current))).toEqual([code]);
    expect(codes(pick, context(current - 1))).toEqual([]);
  });
});
