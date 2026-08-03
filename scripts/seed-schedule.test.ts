import { describe, expect, it } from 'vitest';
import {
  parseEspnEvent,
  resolveTeamAbbreviation,
  type ScheduleSeasonType,
} from './fetch-nfl-schedule.js';
import { toGameSeedRow } from './seed-schedule.js';

describe('resolveTeamAbbreviation', () => {
  it('maps ESPN WSH to WAS', () => {
    expect(resolveTeamAbbreviation('WSH')).toBe('WAS');
  });

  it('passes through abbreviations that already match our teams seed', () => {
    expect(resolveTeamAbbreviation('LAR')).toBe('LAR');
    expect(resolveTeamAbbreviation('KC')).toBe('KC');
  });
});

describe('parseEspnEvent', () => {
  it('builds a schedule record with seed:espn external id and WAS mapping', () => {
    const row = parseEspnEvent(
      {
        id: '401872999',
        date: '2026-09-10T00:20Z',
        competitions: [
          {
            competitors: [
              { homeAway: 'home', team: { abbreviation: 'SEA' } },
              { homeAway: 'away', team: { abbreviation: 'WSH' } },
            ],
            venue: { fullName: 'Lumen Field' },
          },
        ],
      },
      'regular',
      1,
      2026,
    );
    expect(row).toEqual({
      external_id: 'seed:espn:401872999',
      season_year: 2026,
      season_type: 'regular' satisfies ScheduleSeasonType,
      week: 1,
      scheduled_start: '2026-09-10T00:20Z',
      home_team: 'SEA',
      away_team: 'WAS',
      venue: 'Lumen Field',
      status: 'scheduled',
    });
  });
});

describe('toGameSeedRow', () => {
  it('resolves team abbreviations to ids', () => {
    const teams = new Map([
      ['SEA', 'team-sea'],
      ['WAS', 'team-was'],
    ]);
    expect(
      toGameSeedRow(
        {
          external_id: 'seed:espn:1',
          season_year: 2026,
          season_type: 'regular',
          week: 1,
          scheduled_start: '2026-09-10T00:20:00Z',
          home_team: 'SEA',
          away_team: 'WAS',
          venue: null,
          status: 'scheduled',
        },
        teams,
      ),
    ).toMatchObject({
      sportradar_id: 'seed:espn:1',
      home_team_id: 'team-sea',
      away_team_id: 'team-was',
      season_type: 'regular',
    });
  });
});
