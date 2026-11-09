// Test-only fixtures for slip import: one week with two games, four teams, and a few players.
import type { PickGameRow } from '../pickInput.js';
import type { SlipLeg } from './schema.js';
import type { SlipPlayer, SlipTeam } from './mapSlip.js';

export const PHI = '4e380990-e5ea-4b5e-bed5-fa1b919830e3';
export const CHI = 'f2624144-a1b6-4415-bacc-217a25b2aa62';
export const NYG = '11111111-1111-4111-8111-111111111111';
export const NYJ = '22222222-2222-4222-8222-222222222222';
export const KC = '33333333-3333-4333-8333-333333333333';

export const GAME = 'e67747a6-c528-4508-b08d-e63c6f589f2e';
export const NY_GAME = '75e386ee-05e0-47cf-87ab-0a5d2af2e1d8';

export const BARKLEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const WILLIAMS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const BROWN_PHI = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const BROWN_CHI = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const SMITH_NJIGBA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const KELCE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

export const TEAMS: SlipTeam[] = [
  { id: PHI, abbreviation: 'PHI', city: 'Philadelphia', name: 'Eagles' },
  { id: CHI, abbreviation: 'CHI', city: 'Chicago', name: 'Bears' },
  { id: NYG, abbreviation: 'NYG', city: 'New York', name: 'Giants' },
  { id: NYJ, abbreviation: 'NYJ', city: 'New York', name: 'Jets' },
  { id: KC, abbreviation: 'KC', city: 'Kansas City', name: 'Chiefs' },
];

export function weekGame(overrides: Partial<PickGameRow> = {}): PickGameRow {
  return {
    id: GAME,
    season_year: 2026,
    week: 5,
    season_type: 'regular',
    status: 'scheduled',
    home_team_id: CHI,
    away_team_id: PHI,
    scheduled_start: '2026-10-11T17:00:00.000Z',
    ...overrides,
  };
}

export const GAMES: PickGameRow[] = [
  weekGame(),
  weekGame({ id: NY_GAME, home_team_id: NYJ, away_team_id: NYG }),
];

export const PLAYERS: SlipPlayer[] = [
  { id: BARKLEY, first_name: 'Saquon', last_name: 'Barkley', position: 'RB', team_id: PHI },
  { id: WILLIAMS, first_name: 'Caleb', last_name: 'Williams', position: 'QB', team_id: CHI },
  { id: BROWN_PHI, first_name: 'A.J.', last_name: 'Brown', position: 'WR', team_id: PHI },
  { id: BROWN_CHI, first_name: 'Austin', last_name: 'Brown', position: 'WR', team_id: CHI },
  {
    id: SMITH_NJIGBA,
    first_name: 'Jaxon',
    last_name: 'Smith-Njigba',
    position: 'WR',
    team_id: NYJ,
  },
  // Kansas City has no game this week.
  { id: KELCE, first_name: 'Travis', last_name: 'Kelce', position: 'TE', team_id: KC },
];

export function leg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    text: 'leg',
    market: 'MONEYLINE',
    stat: null,
    player: null,
    team: null,
    matchup: [],
    side: null,
    line: null,
    plus_style: false,
    period: 'FULL',
    game_date: null,
    odds: null,
    ...overrides,
  };
}
