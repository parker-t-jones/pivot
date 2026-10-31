import { randomUUID } from 'node:crypto';
import { buildGameSummary, type GameSummaryInfo } from '@pivot/dispatcher';
import type { AiringNetwork, FlagEvent, GameState, WeekGameAirings } from '@pivot/shared';
import { buildWeekWatch, type AiringRow } from './watchOptions.js';

/**
 * Fixed ids that are never inserted into `games`, `teams`, `players`, `leagues`, or `stakes`.
 * The API serves them only after reading `users.is_demo` for the authenticated caller.
 */
export const DEMO_LIVE_GAME_ID = 'de000000-0000-4000-8000-000000000001';
export const DEMO_UPCOMING_GAME_ID = 'de000000-0000-4000-8000-000000000002';
export const DEMO_FINAL_GAME_ID = 'de000000-0000-4000-8000-000000000003';
export const DEMO_LEAGUE_ID = 'de000000-0000-4000-8000-000000000010';
export const DEMO_STAKE_SPREAD_ID = 'de000000-0000-4000-8000-000000000301';
export const DEMO_STAKE_MONEYLINE_ID = 'de000000-0000-4000-8000-000000000302';

const DEMO_GAME_IDS = new Set([DEMO_LIVE_GAME_ID, DEMO_UPCOMING_GAME_ID, DEMO_FINAL_GAME_ID]);

export function isDemoGameId(gameId: string): boolean {
  return DEMO_GAME_IDS.has(gameId);
}

interface DemoTeam {
  id: string;
  abbreviation: string;
  name: string;
  primary_color: string;
  secondary_color: string;
}

const CHIEFS: DemoTeam = {
  id: 'de000000-0000-4000-8000-000000000201',
  abbreviation: 'KC',
  name: 'Chiefs',
  primary_color: '#E31837',
  secondary_color: '#FFB81C',
};
const RAIDERS: DemoTeam = {
  id: 'de000000-0000-4000-8000-000000000202',
  abbreviation: 'LV',
  name: 'Raiders',
  primary_color: '#000000',
  secondary_color: '#A5ACAF',
};
const BILLS: DemoTeam = {
  id: 'de000000-0000-4000-8000-000000000203',
  abbreviation: 'BUF',
  name: 'Bills',
  primary_color: '#00338D',
  secondary_color: '#C60C30',
};
const DOLPHINS: DemoTeam = {
  id: 'de000000-0000-4000-8000-000000000204',
  abbreviation: 'MIA',
  name: 'Dolphins',
  primary_color: '#008E97',
  secondary_color: '#FC4C02',
};
const COWBOYS: DemoTeam = {
  id: 'de000000-0000-4000-8000-000000000205',
  abbreviation: 'DAL',
  name: 'Cowboys',
  primary_color: '#041E42',
  secondary_color: '#869397',
};
const EAGLES: DemoTeam = {
  id: 'de000000-0000-4000-8000-000000000206',
  abbreviation: 'PHI',
  name: 'Eagles',
  primary_color: '#004C54',
  secondary_color: '#A5ACAF',
};

interface DemoPlayer {
  id: string;
  first_name: string;
  last_name: string;
  position: string;
  team: DemoTeam;
  slot_id: string;
  position_in_lineup: string;
  is_star: boolean;
}

const PLAYERS: readonly DemoPlayer[] = [
  {
    id: 'de000000-0000-4000-8000-000000000101',
    first_name: 'Sam',
    last_name: 'Hart',
    position: 'QB',
    team: CHIEFS,
    slot_id: 'de000000-0000-4000-8000-000000000401',
    position_in_lineup: 'QB',
    is_star: true,
  },
  {
    id: 'de000000-0000-4000-8000-000000000102',
    first_name: 'Jules',
    last_name: 'Kemp',
    position: 'WR',
    team: CHIEFS,
    slot_id: 'de000000-0000-4000-8000-000000000402',
    position_in_lineup: 'WR1',
    is_star: false,
  },
  {
    id: 'de000000-0000-4000-8000-000000000103',
    first_name: 'Rio',
    last_name: 'Banks',
    position: 'QB',
    team: BILLS,
    slot_id: 'de000000-0000-4000-8000-000000000403',
    position_in_lineup: 'QB',
    is_star: false,
  },
  {
    id: 'de000000-0000-4000-8000-000000000104',
    first_name: 'Casey',
    last_name: 'Nguyen',
    position: 'RB',
    team: COWBOYS,
    slot_id: 'de000000-0000-4000-8000-000000000404',
    position_in_lineup: 'RB1',
    is_star: false,
  },
];

interface SlateDef {
  id: string;
  status: 'in_progress' | 'scheduled' | 'final';
  network: AiringNetwork;
  home: DemoTeam;
  away: DemoTeam;
  kickoffOffsetMs: number;
}

const SLATE: readonly SlateDef[] = [
  {
    id: DEMO_LIVE_GAME_ID,
    status: 'in_progress',
    network: 'cbs',
    home: CHIEFS,
    away: RAIDERS,
    kickoffOffsetMs: -90 * 60 * 1000,
  },
  {
    id: DEMO_UPCOMING_GAME_ID,
    status: 'scheduled',
    network: 'nbc',
    home: BILLS,
    away: DOLPHINS,
    kickoffOffsetMs: 3 * 60 * 60 * 1000,
  },
  {
    id: DEMO_FINAL_GAME_ID,
    status: 'final',
    network: 'fox',
    home: COWBOYS,
    away: EAGLES,
    kickoffOffsetMs: -5 * 60 * 60 * 1000,
  },
];

const LIVE_CLOCK = {
  quarter: 2,
  timeRemainingSec: 7 * 60 + 14,
  scoreHome: 17,
  scoreAway: 10,
  yardsToOpponentEndzone: 15,
  down: 2,
  distance: 8,
};

function summaryInfo(def: SlateDef): GameSummaryInfo {
  return {
    homeTeamAbbreviation: def.home.abbreviation,
    awayTeamAbbreviation: def.away.abbreviation,
    homeTeamName: def.home.name,
    awayTeamName: def.away.name,
    homeTeamPrimaryColor: def.home.primary_color,
    homeTeamSecondaryColor: def.home.secondary_color,
    awayTeamPrimaryColor: def.away.primary_color,
    awayTeamSecondaryColor: def.away.secondary_color,
  };
}

export function demoLiveSummaryInfo(): GameSummaryInfo {
  const live = SLATE[0];
  if (!live) throw new Error('demo slate is missing the live game');
  return summaryInfo(live);
}

/** Live snapshot anchored to `now`. Not written to Redis. */
export function demoLiveGameState(now: Date): GameState {
  const live = SLATE[0];
  if (!live) throw new Error('demo slate is missing the live game');
  return {
    gameId: live.id,
    homeTeamId: live.home.id,
    awayTeamId: live.away.id,
    possessionTeamId: live.home.id,
    unitOnField: 'offense',
    scoreHome: LIVE_CLOCK.scoreHome,
    scoreAway: LIVE_CLOCK.scoreAway,
    quarter: LIVE_CLOCK.quarter,
    timeRemainingSec: LIVE_CLOCK.timeRemainingSec,
    yardsToOpponentEndzone: LIVE_CLOCK.yardsToOpponentEndzone,
    down: LIVE_CLOCK.down,
    distance: LIVE_CLOCK.distance,
    inRedZone: true,
    status: 'in_progress',
    updatedAt: now.getTime(),
  };
}

function slateRows(now: Date) {
  return SLATE.map((def) => ({
    def,
    scheduled_start: new Date(now.getTime() + def.kickoffOffsetMs).toISOString(),
  }));
}

function airingRow(gameId: string, network: AiringNetwork): AiringRow {
  return {
    game_id: gameId,
    network,
    market: 'national',
    espn_media_name: network.toUpperCase(),
    espn_type: null,
  };
}

/** Week airings for `buildWeekWatch` and the demo alert's broadcast catalog. */
export function demoWeekAirings(now: Date): WeekGameAirings[] {
  return slateRows(now).map(({ def, scheduled_start }) => ({
    id: def.id,
    kickoff: new Date(scheduled_start),
    airings: [
      {
        network: def.network,
        market: 'national' as const,
        espnMediaName: def.network.toUpperCase(),
        espnType: null,
      },
    ],
  }));
}

function watchFor(services: ReadonlySet<string>, now: Date) {
  const rows = slateRows(now);
  return buildWeekWatch(
    rows.map(({ def, scheduled_start }) => ({
      id: def.id,
      scheduled_start,
      away_team_name: def.away.name,
      home_team_name: def.home.name,
    })),
    rows.map(({ def }) => airingRow(def.id, def.network)),
    services,
  );
}

/** `GET /games?week=` body for a demo user. `week` is echoed; the three games ignore it. */
export function demoWeekResponse(week: number, services: ReadonlySet<string>, now: Date) {
  const watch = watchFor(services, now);
  return {
    week,
    games: slateRows(now).map(({ def, scheduled_start }) => {
      const options = watch.get(def.id);
      return {
        game_id: def.id,
        status: def.status,
        scheduled_start,
        home_team_id: def.home.id,
        away_team_id: def.away.id,
        home_team: def.home.abbreviation,
        away_team: def.away.abbreviation,
        home_team_name: def.home.name,
        away_team_name: def.away.name,
        home_team_primary_color: def.home.primary_color,
        home_team_secondary_color: def.home.secondary_color,
        away_team_primary_color: def.away.primary_color,
        away_team_secondary_color: def.away.secondary_color,
        broadcasts: options?.broadcasts ?? [],
        airings: options?.airings ?? [],
        destination: options?.destination ?? { kind: 'legacy' as const },
      };
    }),
  };
}

/** `GET /games/live` body. One in-progress game; no Redis read. */
export function demoLiveResponse(now: Date) {
  const live = slateRows(now).find((row) => row.def.id === DEMO_LIVE_GAME_ID);
  if (!live) throw new Error('demo slate is missing the live game');
  const summary = buildGameSummary(demoLiveGameState(now), summaryInfo(live.def));
  return {
    games: [
      {
        game_id: live.def.id,
        status: 'in_progress' as const,
        scheduled_start: live.scheduled_start,
        ...summary,
      },
    ],
  };
}

/** `GET /games/:id/broadcasts` for a fixture id. Null when `gameId` is not a fixture. */
export function demoBroadcastsResponse(gameId: string, services: ReadonlySet<string>, now: Date) {
  if (!isDemoGameId(gameId)) return null;
  const watch = watchFor(services, now).get(gameId);
  return {
    game_id: gameId,
    broadcasts: watch?.broadcasts ?? [],
    destination: watch?.destination ?? { kind: 'legacy' as const },
  };
}

export function demoLeague(seasonYear: number) {
  return {
    league_id: DEMO_LEAGUE_ID,
    platform: 'manual',
    name: 'Demo League',
    sport: 'nfl',
    season_year: seasonYear,
    last_synced_at: null,
  };
}

/** `GET /leagues/:id/lineup`. Roster is fixed; `week` is the caller's week. */
export function demoLineupResponse(week: number) {
  return {
    league_id: DEMO_LEAGUE_ID,
    week,
    last_synced_at: null,
    lineup_source: null,
    regular_season_start: null,
    opponent: null,
    slots: PLAYERS.map((player) => ({
      slot_id: player.slot_id,
      slot_type: 'starter' as const,
      position_in_lineup: player.position_in_lineup,
      is_star: player.is_star,
      player: {
        player_id: player.id,
        first_name: player.first_name,
        last_name: player.last_name,
        position: player.position,
        team: {
          team_id: player.team.id,
          abbreviation: player.team.abbreviation,
          name: player.team.name,
        },
      },
    })),
  };
}

/** Red-zone flag on the live game, plus `live_feed_ok` so Home does not show updates paused. */
export function demoFlagsResponse(now: Date) {
  const live = slateRows(now).find((row) => row.def.id === DEMO_LIVE_GAME_ID);
  if (!live) throw new Error('demo slate is missing the live game');
  const flagged = PLAYERS.filter((player) => player.team.id === CHIEFS.id);
  return {
    flags: [
      {
        game_id: DEMO_LIVE_GAME_ID,
        priority_score: 90,
        reasons: ['red_zone'],
        flagged_players: flagged.map((player) => ({
          player_id: player.id,
          first_name: player.first_name,
          last_name: player.last_name,
          position: player.position,
        })),
        game: buildGameSummary(demoLiveGameState(now), summaryInfo(live.def)),
        recommended_action: 'switch_primary' as const,
      },
    ],
    generated_at: now.toISOString(),
    live_feed_ok: true,
  };
}

/** Two picks on the live game. `game` is embedded so the client does not join `games`. */
export function demoStakesResponse(userId: string, season: number, week: number, now: Date) {
  const live = slateRows(now).find((row) => row.def.id === DEMO_LIVE_GAME_ID);
  if (!live) throw new Error('demo slate is missing the live game');
  const game = {
    scheduled_start: live.scheduled_start,
    status: live.def.status,
    home_team_id: live.def.home.id,
    away_team_id: live.def.away.id,
    home_team: live.def.home.abbreviation,
    away_team: live.def.away.abbreviation,
    home_team_name: live.def.home.name,
    away_team_name: live.def.away.name,
  };
  const created = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  return {
    week,
    stakes: [
      {
        id: DEMO_STAKE_SPREAD_ID,
        user_id: userId,
        season,
        week,
        game_id: DEMO_LIVE_GAME_ID,
        subject: { type: 'TEAM', teamId: CHIEFS.id },
        condition: { type: 'SPREAD', line: -3.5 },
        source: 'MANUAL',
        weight: 1,
        created_at: created,
        game,
      },
      {
        id: DEMO_STAKE_MONEYLINE_ID,
        user_id: userId,
        season,
        week,
        game_id: DEMO_LIVE_GAME_ID,
        subject: { type: 'TEAM', teamId: CHIEFS.id },
        condition: { type: 'MONEYLINE', side: 'TEAM' },
        source: 'MANUAL',
        weight: 1,
        created_at: created,
        game,
      },
    ],
  };
}

const FLAGGED_PLAYER_IDS = PLAYERS.filter((player) => player.team.id === CHIEFS.id).map(
  (player) => player.id,
);

/** `flag_added` for the live game. A fresh id each call so delivery does not dedupe. */
export function demoAlertEvent(userId: string, now: Date): FlagEvent {
  const at = now.getTime();
  return {
    id: randomUUID(),
    userId,
    gameId: DEMO_LIVE_GAME_ID,
    type: 'flag_added',
    oldState: null,
    newState: {
      gameId: DEMO_LIVE_GAME_ID,
      flagged: true,
      priorityScore: 90,
      reasons: [{ type: 'red_zone', triggeringPlayerIds: FLAGGED_PLAYER_IDS }],
      computedAt: at,
    },
    scheduledFireAt: at,
    playWallclock: now.toISOString(),
    seenAt: now.toISOString(),
    enqueuedAt: now.toISOString(),
  };
}

export function demoAlertPlayers(): {
  playerId: string;
  firstName: string;
  lastName: string;
  position: string;
}[] {
  return PLAYERS.filter((player) => player.team.id === CHIEFS.id).map((player) => ({
    playerId: player.id,
    firstName: player.first_name,
    lastName: player.last_name,
    position: player.position,
  }));
}
