import type { GameAiring, GameBroadcast } from '../lib/gameDisplay';
import type { LiveGame } from '../lib/schedule';

/**
 * Scrubbed prod payloads from Monday 2026-10-19, WAS @ SF at halftime.
 * `GET /games/live` returned this one in-progress game. `GET /flags/current` returned
 * `flags: []` (no stake active). Broadcasts are from `GET /games?week=6` for this game.
 * Deep links and saved-stream URLs are replaced; no user ids.
 *
 * ESPN at the same moment: status.type.name `STATUS_HALFTIME`, period 2, displayClock `0:00`,
 * last play type id 65 "End of Half". That play clears possession, so the API fields below
 * are null. There is no period-status field on the payload.
 */
export const MNF_GAME_ID = 'fb29be67-4107-488e-9964-88932fde8f3d';

export const MNF_HALFTIME_LIVE: LiveGame = {
  game_id: MNF_GAME_ID,
  status: 'in_progress',
  scheduled_start: '2026-10-20T00:15:00+00:00',
  home_team: 'SF',
  away_team: 'WAS',
  home_team_name: '49ers',
  away_team_name: 'Commanders',
  home_team_primary_color: '#AA0000',
  home_team_secondary_color: '#B3995D',
  away_team_primary_color: '#5A1414',
  away_team_secondary_color: '#FFB612',
  score: { home: 20, away: 3 },
  quarter: 2,
  time_remaining_sec: 0,
  possession_team: null,
  yards_to_endzone: null,
  down: null,
  distance: null,
  in_red_zone: false,
};

/** Preferred watch option on the week schedule. URL is a stand-in, not Parker's link. */
export const MNF_BROADCAST: GameBroadcast = {
  service: 'youtube_tv',
  network: 'espn',
  deep_link_url: 'https://tv.youtube.com/watch',
  market_confidence: 'national',
  preferred: true,
  requires_subscription: true,
  typical_lag_seconds: 30,
  user_has_subscription: true,
};

export const MNF_AIRINGS: GameAiring[] = [
  { network: 'espn', market: 'national', market_confidence: 'national' },
  { network: 'abc', market: 'national', market_confidence: 'national' },
];

/** Starters on this game from the week-6 lineup fetch. Player ids omitted. */
export const MNF_STARTERS = [
  {
    playerId: 'was-dst',
    firstName: 'Defense',
    lastName: '',
    position: 'DEF',
    teamAbbreviation: 'WAS',
  },
  {
    playerId: 'sf-kittle',
    firstName: 'George',
    lastName: 'Kittle',
    position: 'TE',
    teamAbbreviation: 'SF',
  },
] as const;

export const MNF_FLAGS_CURRENT = {
  flags: [] as [],
  generated_at: '2026-10-20T01:50:00.000Z',
};
