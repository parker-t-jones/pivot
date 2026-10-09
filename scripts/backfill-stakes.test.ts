import { describe, expect, it } from 'vitest';
import { formatBackfillReport, parseBackfillArgs, planBackfill } from './backfill-stakes.js';

describe('backfill-stakes', () => {
  it('dry-runs unless --apply is passed', () => {
    expect(parseBackfillArgs([])).toEqual({ apply: false });
    expect(parseBackfillArgs(['--dry-run'])).toEqual({ apply: false });
    expect(parseBackfillArgs(['--apply'])).toEqual({ apply: true });
  });

  it('prints one line per user and a total', () => {
    const report = formatBackfillReport(
      [
        { userId: 'user-b', stakes: 2, insert: 2, update: 0, delete: 0 },
        { userId: 'user-a', stakes: 1, insert: 0, update: 0, delete: 1 },
      ],
      true,
    );
    expect(report).toBe(
      [
        '[stakes] dry-run user=user-a stakes=1 insert=0 update=0 delete=1',
        '[stakes] dry-run user=user-b stakes=2 insert=2 update=0 delete=0',
        '[stakes] dry-run total users=2 stakes=3 insert=2 update=0 delete=1',
      ].join('\n'),
    );
  });

  it('leaves opponent rows out of the rostered delete set', () => {
    const { plans } = planBackfill({
      leagues: [
        {
          id: 'league-1',
          user_id: 'user-1',
          platform: 'sleeper',
          season_year: 2026,
          lineup_source: 'matchup',
          fallback_roster: null,
        },
      ],
      slots: [
        {
          league_id: 'league-1',
          week: 1,
          player_id: 'player-wr',
          slot_type: 'starter',
          players: { team_id: 'team-phi', position: 'WR' },
        },
      ],
      games: [
        {
          id: 'game-phi',
          season_year: 2026,
          week: 1,
          season_type: 'regular',
          home_team_id: 'team-phi',
          away_team_id: 'team-chi',
        },
      ],
      stakes: [
        {
          id: 'opp-1',
          user_id: 'user-1',
          season: 2026,
          week: 1,
          game_id: 'game-phi',
          source: 'SLEEPER_OPPONENT',
          source_ref: 'league-1',
          subject: { type: 'PLAYER', playerId: 'opp', teamId: 'team-chi' },
          condition: { type: 'OPPONENT_ROSTERED' },
        },
        {
          id: 'mislabeled',
          user_id: 'user-1',
          season: 2026,
          week: 1,
          game_id: 'game-phi',
          source: 'SLEEPER_ROSTER',
          source_ref: 'league-1',
          subject: { type: 'PLAYER', playerId: 'other', teamId: 'team-chi' },
          condition: { type: 'OPPONENT_ROSTERED' },
        },
      ],
      playersById: new Map(),
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]?.diff.deleteIds).toEqual([]);
    expect(plans[0]?.diff.inserts.map((row) => row.subject.playerId)).toEqual(['player-wr']);
  });
});
