import { describe, expect, it } from 'vitest';

import { pickCardModel, pickEyebrow, pickText, type PickCardStake } from './pickCard';

const NOW = new Date('2026-11-08T17:00:00.000Z');

const game = {
  scheduled_start: '2026-11-08T18:00:00.000Z',
  status: 'scheduled',
  home_team_id: 'gb',
  away_team_id: 'det',
  home_team: 'GB',
  away_team: 'DET',
};
const teams = [
  { teamId: 'gb', abbreviation: 'GB' },
  { teamId: 'det', abbreviation: 'DET' },
];

function stake(type: string, extra: Partial<PickCardStake> = {}): PickCardStake {
  return {
    game_id: 'g1',
    subject: { type: 'TEAM', teamId: type.startsWith('TOTAL') ? undefined : 'det' },
    condition: {
      type,
      line: type === 'SPREAD' ? -3.5 : type.startsWith('TOTAL') ? 84.5 : undefined,
    },
    game,
    ...extra,
  };
}

function live(home: number, away: number) {
  return { game_id: 'g1', score: { home, away }, quarter: 2, time_remaining_sec: 300 };
}

function model(
  s: PickCardStake,
  opts: {
    status?: string;
    live?: ReturnType<typeof live>;
    finalScore?: { home: number; away: number } | null;
  } = {},
) {
  return pickCardModel({
    stake: s,
    teams,
    weekGames: [
      {
        game_id: 'g1',
        status: opts.status ?? 'scheduled',
        scheduled_start: game.scheduled_start,
        final_score: opts.finalScore ?? null,
      },
    ],
    liveGames: opts.live ? [opts.live] : [],
    now: NOW,
  });
}

describe('pick text and eyebrow', () => {
  it('names each type, and falls back to PICK', () => {
    expect(pickEyebrow('SPREAD')).toBe('SPREAD');
    expect(pickEyebrow('TOTAL_OVER')).toBe('TOTAL');
    expect(pickEyebrow('TOTAL_UNDER')).toBe('TOTAL');
    expect(pickEyebrow('MONEYLINE')).toBe('MONEYLINE');
    expect(pickEyebrow('SURVIVOR')).toBe('SURVIVOR');
    expect(pickEyebrow('SOMETHING_NEW')).toBe('PICK');
  });

  it('writes the spread with a true minus, totals as O/U, moneyline as ML, survivor as the team', () => {
    expect(pickText(stake('SPREAD'), teams)).toBe('DET −3.5');
    expect(pickText(stake('TOTAL_OVER'), teams)).toBe('O 84.5');
    expect(pickText(stake('TOTAL_UNDER'), teams)).toBe('U 84.5');
    expect(pickText(stake('MONEYLINE'), teams)).toBe('DET ML');
    expect(pickText(stake('SURVIVOR'), teams)).toBe('DET');
  });

  it('never says stake', () => {
    for (const type of ['SPREAD', 'TOTAL_OVER', 'MONEYLINE', 'SURVIVOR']) {
      const card = model(stake(type));
      expect(`${card.eyebrow} ${card.pick} ${card.status}`).not.toMatch(/stake/i);
    }
  });
});

describe('pickCardModel phases', () => {
  it('upcoming: kickoff countdown, matchup, no progress', () => {
    const card = model(stake('SPREAD'));
    expect(card.phase).toBe('upcoming');
    expect(card.matchup).toBe('DET @ GB');
    expect(card.awayTeam).toBe('DET');
    expect(card.homeTeam).toBe('GB');
    expect(card.status).toBe('in 1h 0m');
    expect(card.progress).toBeNull();
  });

  it('live spread: score and clock, cover margin on the bar', () => {
    // DET leads 14-7: margin +7, line -3.5 → +3.5 past the line.
    const card = model(stake('SPREAD'), { status: 'in_progress', live: live(7, 14) });
    expect(card.phase).toBe('live');
    expect(card.status).toContain('Q2');
    expect(card.progress?.phase).toBe('live');
    expect(card.progress?.marker?.position).toBe(3.5);
    expect(card.axisLabel).toBe('14');
  });

  it('live total: combined points against the line', () => {
    const over = model(stake('TOTAL_OVER'), { live: live(30, 40) });
    expect(over.phase).toBe('live');
    expect(over.progress?.marker?.position).toBe(-14.5);
    expect(over.progress?.coverFrom).toBe(0);
    expect(over.axisLabel).toBe('21');
    const under = model(stake('TOTAL_UNDER'), { live: live(30, 40) });
    expect(under.progress?.coverTo).toBe(0);
  });

  it('live moneyline and survivor: the picked team margin', () => {
    const ml = model(stake('MONEYLINE'), { live: live(10, 3) });
    expect(ml.progress?.marker?.position).toBe(-7);
    const survivor = model(stake('SURVIVOR'), { live: live(10, 3) });
    expect(survivor.progress?.marker?.position).toBe(-7);
  });

  it('live with no live-feed score: LIVE, no bar', () => {
    const card = model(stake('SPREAD'), { status: 'in_progress' });
    expect(card.phase).toBe('live');
    expect(card.status).toBe('LIVE');
    expect(card.progress).toBeNull();
  });

  it('final: FINAL, no bar, and no outcome even with a stale live score', () => {
    const card = model(stake('SPREAD'), { status: 'final', live: live(7, 14) });
    expect(card.phase).toBe('final');
    expect(card.status).toBe('FINAL');
    expect(card.progress).toBeNull();
  });

  it('final with a schedule score: "FINAL · away–home", still no outcome', () => {
    const card = model(stake('SPREAD'), { status: 'final', finalScore: { home: 17, away: 24 } });
    expect(card.phase).toBe('final');
    expect(card.status).toBe('FINAL · 24–17');
    expect(card.progress).toBeNull();
  });

  it('ignores a final_score on a game that is not final', () => {
    const card = model(stake('SPREAD'), { status: 'scheduled', finalScore: { home: 1, away: 2 } });
    expect(card.status).not.toContain('FINAL');
  });

  it('unknown type still renders a card with the PICK eyebrow and no bar', () => {
    const card = model(stake('SOMETHING_NEW'), { live: live(7, 14) });
    expect(card.eyebrow).toBe('PICK');
    expect(card.progress).toBeNull();
  });

  it('a stake with no game falls back to its own status and an empty matchup', () => {
    const card = pickCardModel({
      stake: { ...stake('MONEYLINE'), game: null },
      teams: [],
      weekGames: null,
      liveGames: [],
      now: NOW,
    });
    expect(card.matchup).toBe('');
    expect(card.awayTeam).toBeNull();
    expect(card.phase).toBe('upcoming');
    expect(card.status).toBe('Upcoming');
  });
});

describe('hit state and progress bar', () => {
  const propStake = (
    type: string,
    subjectType: string,
    progress: PickCardStake['progress'],
    extra: Partial<PickCardStake> = {},
  ): PickCardStake => ({
    id: 'p1',
    game_id: 'g1',
    subject: { type: subjectType, teamId: 'det' },
    condition: { type, line: 60.5, stat: 'REC_YDS' },
    label: 'a pick',
    progress,
    game,
    ...extra,
  });
  const hitProgress = { status: 'hit' as const, current: 70, line: 60.5, needed: 0 };
  const liveOpts = { status: 'in_progress', live: live(7, 14) };

  it('marks a live prop, team total, FG total and first-to-score pick that has hit', () => {
    for (const [type, subject] of [
      ['STAT_OVER', 'PLAYER'],
      ['TEAM_TOTAL_OVER', 'TEAM'],
      ['FG_OVER', 'GAME'],
      ['FIRST_TO_SCORE', 'TEAM'],
    ] as const) {
      const card = model(propStake(type, subject, hitProgress), liveOpts);
      expect(card.hit, type).toBe(true);
    }
  });

  it('does not mark a live pick that is only on track', () => {
    const card = model(
      propStake('STAT_OVER', 'PLAYER', { status: 'live', current: 42, line: 60.5, needed: 19 }),
      liveOpts,
    );
    expect(card.hit).toBe(false);
  });

  it('marks a pick settled as won while the game is still live (a quarter line)', () => {
    const card = model(
      propStake('STAT_OVER', 'PLAYER', { ...hitProgress, status: 'won' }),
      liveOpts,
    );
    expect(card.hit).toBe(true);
  });

  it('never marks lost, missed, tie, void or unavailable', () => {
    for (const status of ['lost', 'missed', 'tie', 'void', 'unavailable', 'pending'] as const) {
      const card = model(propStake('STAT_OVER', 'PLAYER', { ...hitProgress, status }), liveOpts);
      expect(card.hit, status).toBe(false);
    }
  });

  it('never marks a final card, even when the pick won', () => {
    const card = model(propStake('STAT_OVER', 'PLAYER', { ...hitProgress, status: 'won' }), {
      status: 'final',
    });
    expect(card.phase).toBe('final');
    expect(card.hit).toBe(false);
    expect(card.bar).toBeNull();
  });

  it('never marks an upcoming card', () => {
    const card = model(propStake('STAT_OVER', 'PLAYER', hitProgress));
    expect(card.phase).toBe('upcoming');
    expect(card.hit).toBe(false);
  });

  it('does not mark the legacy full-game types, which never state an outcome', () => {
    for (const type of ['SPREAD', 'TOTAL_OVER', 'MONEYLINE', 'SURVIVOR']) {
      const card = model(stake(type, { progress: hitProgress }), liveOpts);
      expect(card.hit, type).toBe(false);
      expect(card.bar, type).toBeNull();
    }
  });

  it('a hit leg does not mark the whole parlay card, and the parlay has no bar', () => {
    const card = model(
      {
        id: 'slip-1',
        game_id: 'g1',
        subject: { type: 'SLIP' },
        condition: { type: 'PARLAY' },
        label: '2-leg parlay',
        game,
        summary: { status: 'live', legs: 2, hit: 1, alive: 1, lost: 0, refunded: 0 },
        legs: [
          propStake('STAT_OVER', 'PLAYER', hitProgress, { id: 'a' }),
          propStake(
            'STAT_OVER',
            'PLAYER',
            { status: 'live', current: 10, line: 60.5 },
            { id: 'b' },
          ),
        ],
      },
      liveOpts,
    );
    expect(card.hit).toBe(false);
    expect(card.bar).toBeNull();
    expect(card.legs[0]?.state).toBe('Hit');
  });

  it('draws a bar from current and line, clamped to 0..1', () => {
    const on = model(
      propStake('STAT_OVER', 'PLAYER', { status: 'live', current: 30.25, line: 60.5, needed: 31 }),
      liveOpts,
    );
    expect(on.bar).toEqual({ fill: 0.5, current: 30.25, line: 60.5 });
    expect(model(propStake('STAT_OVER', 'PLAYER', hitProgress), liveOpts).bar?.fill).toBe(1);
    const none = model(
      propStake('STAT_OVER', 'PLAYER', { status: 'live', current: 0, line: 60.5 }),
      liveOpts,
    );
    expect(none.bar?.fill).toBe(0);
  });

  it('draws no bar without a number, with a non-positive line, or without progress', () => {
    expect(model(propStake('FIRST_TO_SCORE', 'TEAM', { status: 'live' }), liveOpts).bar).toBeNull();
    expect(
      model(propStake('STAT_OVER', 'PLAYER', { status: 'live', current: 3, line: 0 }), liveOpts)
        .bar,
    ).toBeNull();
    expect(model(propStake('STAT_OVER', 'PLAYER', undefined), liveOpts).bar).toBeNull();
    expect(
      model(propStake('STAT_OVER', 'PLAYER', { status: 'unavailable' }), liveOpts).bar,
    ).toBeNull();
  });
});
