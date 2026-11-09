import type { Segment, StakeCondition } from '@pivot/shared';
import { ApiError } from '../errors.js';
import type { PickGameRow, PickInput } from '../pickInput.js';
import type { SlipLeg } from './schema.js';

export interface SlipTeam {
  id: string;
  abbreviation: string;
  city: string;
  name: string;
}

export interface SlipPlayer {
  id: string;
  first_name: string;
  last_name: string;
  position: string;
  team_id: string;
}

/** What mapping needs from the database. The route wires these to Supabase; tests to fixtures. */
export interface SlipLookups {
  /** This week's regular-season games. */
  games: readonly PickGameRow[];
  teams: readonly SlipTeam[];
  /** Active players whose last name contains `surname` (case-insensitive). */
  findPlayers(surname: string): Promise<SlipPlayer[]>;
  /** The same check `POST /picks` runs. Throws `ApiError` when the pick would be refused. */
  validate(input: PickInput): Promise<void>;
}

export interface ImportedGame {
  game_id: string;
  status: string;
  scheduled_start: string;
  home_team_id: string;
  away_team_id: string;
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
}

export interface ImportedPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string;
  team: { abbreviation: string } | null;
}

export type ImportedLeg =
  | {
      status: 'ready';
      /** The leg as the slip printed it. */
      text: string;
      pick: PickInput;
      game: ImportedGame;
      player: ImportedPlayer | null;
    }
  | { status: 'flagged'; text: string; reason: string };

export const FLAG = {
  unsupported: 'Pivot can’t track this kind of pick yet.',
  unclear: 'The side or line isn’t clear on the slip.',
  team: 'We couldn’t tell which team this pick is on.',
  game: 'That game isn’t on this week’s schedule.',
  otherWeek: 'This pick looks like it’s for a different week.',
  over: 'That game isn’t open for a pick.',
  line: 'Pivot can’t track that line.',
  noMatch: 'We couldn’t match this pick. Add it yourself.',
} as const;

const TEAM_ALIASES: Record<string, readonly string[]> = {
  JAX: ['JAC'],
  LAR: ['LA'],
  WSH: ['WAS'],
  ARI: ['ARZ'],
  GB: ['GNB'],
  KC: ['KAN'],
  NE: ['NWE'],
  NO: ['NOR'],
  SF: ['SFO'],
  TB: ['TAM'],
  LV: ['LVR'],
};

function words(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’,()]/g, '')
    .split(/[\s\-–@/]+/)
    .filter((word) => word.length > 0);
}

function abbreviationsOf(team: SlipTeam): string[] {
  const own = team.abbreviation.toUpperCase();
  const aliases = Object.entries(TEAM_ALIASES).flatMap(([canonical, others]) =>
    canonical === own ? others : others.includes(own) ? [canonical] : [],
  );
  return [own, ...(TEAM_ALIASES[own] ?? []), ...aliases].map((a) => a.toLowerCase());
}

/**
 * The one team a printed name refers to: abbreviation, nickname ("Eagles", "PHI Eagles"), city
 * and nickname, or a city only when one team has it. Anything else (e.g. "New York") is null.
 */
export function resolveTeam(text: string | null, teams: readonly SlipTeam[]): SlipTeam | null {
  if (text === null) return null;
  const tokens = words(text);
  if (tokens.length === 0) return null;
  const joined = tokens.join(' ');
  const unique = (matches: SlipTeam[]): SlipTeam | null => {
    const ids = new Set(matches.map((team) => team.id));
    return ids.size === 1 ? (matches[0] ?? null) : null;
  };

  if (tokens.length === 1) {
    const byAbbreviation = unique(teams.filter((team) => abbreviationsOf(team).includes(joined)));
    if (byAbbreviation) return byAbbreviation;
  }
  const byNickname = unique(
    teams.filter((team) => {
      const name = words(team.name).join(' ');
      return name.length > 0 && (joined === name || joined.endsWith(` ${name}`));
    }),
  );
  if (byNickname) return byNickname;
  return unique(teams.filter((team) => words(team.city).join(' ') === joined));
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function nameWords(value: string): string[] {
  return words(value).filter((word) => !NAME_SUFFIXES.has(word));
}

/** The word to search last names with: the last word of the printed name, suffix dropped. */
export function surnameKey(printed: string): string | null {
  const tokens = nameWords(printed);
  return tokens.length >= 2 ? (tokens[tokens.length - 1] ?? null) : null;
}

/** "Saquon Barkley" and "S. Barkley" both name Saquon Barkley. A last name alone does not. */
export function playerNameMatches(printed: string, player: SlipPlayer): boolean {
  const slip = nameWords(printed);
  const first = nameWords(player.first_name);
  const last = nameWords(player.last_name);
  if (slip.length < 2 || first.length === 0 || last.length === 0) return false;
  const full = [...first, ...last];
  if (slip.length === full.length && slip.every((word, i) => word === full[i])) return true;
  const [initial, ...rest] = slip;
  return (
    initial !== undefined &&
    initial.length === 1 &&
    (first[0] ?? '').startsWith(initial) &&
    rest.length === last.length &&
    rest.every((word, i) => word === last[i])
  );
}

function gameFor(teamId: string, games: readonly PickGameRow[]): PickGameRow | null {
  const matches = games.filter(
    (game) => game.home_team_id === teamId || game.away_team_id === teamId,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A printed date more than a day from kickoff means another week's game. */
function dateMismatch(printed: string | null, game: PickGameRow): boolean {
  if (printed === null || !/^\d{4}-\d{2}-\d{2}$/.test(printed)) return false;
  const day = Date.parse(`${printed}T12:00:00Z`);
  const kickoff = Date.parse(game.scheduled_start);
  if (Number.isNaN(day) || Number.isNaN(kickoff)) return false;
  return Math.abs(day - kickoff) > 1.5 * DAY_MS;
}

type Built =
  | { ok: true; condition: StakeCondition; needs: 'team' | 'player' | 'game' | 'teamOrGame' }
  | { ok: false; reason: string };

function overUnder(leg: SlipLeg): { side: 'OVER' | 'UNDER'; line: number } | null {
  if (leg.line === null) return null;
  if (leg.plus_style) {
    if (leg.side === 'UNDER' || leg.side === 'NO') return null;
    return { side: 'OVER', line: leg.line - 0.5 };
  }
  if (leg.side !== 'OVER' && leg.side !== 'UNDER') return null;
  return { side: leg.side, line: leg.line };
}

function segmentOf(leg: SlipLeg): { segment?: Segment } {
  return leg.period === 'FULL' ? {} : { segment: leg.period };
}

/** The condition a leg describes, before any player, team, or game is matched. */
export function buildCondition(leg: SlipLeg): Built {
  const fullGameOnly = leg.period === 'FULL';
  switch (leg.market) {
    case 'MONEYLINE':
      if (!fullGameOnly) return { ok: false, reason: FLAG.unsupported };
      return { ok: true, condition: { type: 'MONEYLINE', side: 'TEAM' }, needs: 'team' };
    case 'SPREAD':
      if (leg.line === null) return { ok: false, reason: FLAG.unclear };
      return {
        ok: true,
        condition: { type: 'SPREAD', line: leg.line, ...segmentOf(leg) },
        needs: 'team',
      };
    case 'GAME_TOTAL': {
      const ou = overUnder(leg);
      if (ou === null) return { ok: false, reason: FLAG.unclear };
      return {
        ok: true,
        condition: {
          type: ou.side === 'OVER' ? 'TOTAL_OVER' : 'TOTAL_UNDER',
          line: ou.line,
          ...segmentOf(leg),
        },
        needs: 'game',
      };
    }
    case 'TEAM_TOTAL': {
      const ou = overUnder(leg);
      if (ou === null) return { ok: false, reason: FLAG.unclear };
      return {
        ok: true,
        condition: {
          type: ou.side === 'OVER' ? 'TEAM_TOTAL_OVER' : 'TEAM_TOTAL_UNDER',
          line: ou.line,
          ...segmentOf(leg),
        },
        needs: 'team',
      };
    }
    case 'FIELD_GOALS': {
      const ou = overUnder(leg);
      if (ou === null) return { ok: false, reason: FLAG.unclear };
      return {
        ok: true,
        condition: {
          type: ou.side === 'OVER' ? 'FG_OVER' : 'FG_UNDER',
          line: ou.line,
          ...segmentOf(leg),
        },
        needs: 'teamOrGame',
      };
    }
    case 'PLAYER_STAT': {
      if (!fullGameOnly || leg.stat === null) return { ok: false, reason: FLAG.unsupported };
      const ou = overUnder(leg);
      if (ou === null) return { ok: false, reason: FLAG.unclear };
      return {
        ok: true,
        condition: {
          type: ou.side === 'OVER' ? 'STAT_OVER' : 'STAT_UNDER',
          stat: leg.stat,
          line: ou.line,
        },
        needs: 'player',
      };
    }
    case 'ANYTIME_TD':
    case 'FIRST_TD': {
      if (!fullGameOnly) return { ok: false, reason: FLAG.unsupported };
      // A scorer bet with no "No" printed is a "Yes" bet.
      if (leg.side === 'OVER' || leg.side === 'UNDER') return { ok: false, reason: FLAG.unclear };
      return {
        ok: true,
        condition: {
          type: 'PLAYER_EVENT',
          event: leg.market === 'ANYTIME_TD' ? 'ANY_TD' : 'FIRST_TD',
          side: leg.side === 'NO' ? 'NO' : 'YES',
        },
        needs: 'player',
      };
    }
    case 'FIRST_TO_SCORE':
      if (!fullGameOnly) return { ok: false, reason: FLAG.unsupported };
      return { ok: true, condition: { type: 'FIRST_TO_SCORE' }, needs: 'team' };
    default:
      return { ok: false, reason: FLAG.unsupported };
  }
}

function validationReason(error: ApiError): string {
  switch (error.code) {
    case 'stake_line_invalid':
      return FLAG.line;
    case 'stake_game_invalid':
      return FLAG.over;
    default:
      return FLAG.noMatch;
  }
}

function importedGame(game: PickGameRow, teams: ReadonlyMap<string, SlipTeam>): ImportedGame {
  const home = teams.get(game.home_team_id);
  const away = teams.get(game.away_team_id);
  return {
    game_id: game.id,
    status: game.status,
    scheduled_start: game.scheduled_start,
    home_team_id: game.home_team_id,
    away_team_id: game.away_team_id,
    home_team: home?.abbreviation ?? '',
    away_team: away?.abbreviation ?? '',
    home_team_name: home?.name ?? '',
    away_team_name: away?.name ?? '',
  };
}

/**
 * Matches each leg to a player, team, and this week's game, and runs the `POST /picks` check.
 * A leg that does not match exactly one of each is flagged with a reason. Nothing is guessed.
 */
export async function mapSlipLeg(leg: SlipLeg, lookups: SlipLookups): Promise<ImportedLeg> {
  const flag = (reason: string): ImportedLeg => ({ status: 'flagged', text: leg.text, reason });
  const built = buildCondition(leg);
  if (!built.ok) return flag(built.reason);

  const teamsById = new Map(lookups.teams.map((team) => [team.id, team]));
  const weekTeamIds = new Set(lookups.games.flatMap((g) => [g.home_team_id, g.away_team_id]));
  const pickTeam = resolveTeam(leg.team, lookups.teams);
  const matchupTeams = leg.matchup.map((text) => resolveTeam(text, lookups.teams));

  let game: PickGameRow | null = null;
  let teamId: string | undefined;
  let playerRow: SlipPlayer | null = null;

  if (built.needs === 'player') {
    const printed = leg.player ?? '';
    const surname = surnameKey(printed);
    if (surname === null) return flag(`We couldn’t tell which player this is.`);
    const candidates = (await lookups.findPlayers(surname)).filter(
      (player) =>
        weekTeamIds.has(player.team_id) &&
        playerNameMatches(printed, player) &&
        (pickTeam === null || pickTeam.id === player.team_id),
    );
    if (candidates.length === 0) return flag(`We couldn’t find ${printed} in this week’s games.`);
    if (candidates.length > 1) return flag(`More than one player matches ${printed}.`);
    playerRow = candidates[0] ?? null;
    if (playerRow === null) return flag(FLAG.noMatch);
    game = gameFor(playerRow.team_id, lookups.games);
  } else if (built.needs === 'team' || (built.needs === 'teamOrGame' && leg.team !== null)) {
    if (pickTeam === null) return flag(FLAG.team);
    teamId = pickTeam.id;
    game = gameFor(pickTeam.id, lookups.games);
  } else {
    const resolved = matchupTeams.filter((team): team is SlipTeam => team !== null);
    if (resolved.length === 0 && pickTeam !== null) resolved.push(pickTeam);
    if (resolved.length === 0) return flag(FLAG.team);
    const games = new Set(resolved.map((team) => gameFor(team.id, lookups.games)));
    if (games.size !== 1) return flag(FLAG.game);
    game = [...games][0] ?? null;
  }
  if (game === null) return flag(FLAG.game);
  const matched = game;

  // Every team the slip prints for this leg has to be in the matched game.
  const inGame = (team: SlipTeam | null) =>
    team === null || team.id === matched.home_team_id || team.id === matched.away_team_id;
  if (!matchupTeams.every(inGame) || !inGame(pickTeam)) return flag(FLAG.game);
  if (dateMismatch(leg.game_date, matched)) return flag(FLAG.otherWeek);

  const pick: PickInput = {
    gameId: matched.id,
    condition: built.condition as PickInput['condition'],
    ...(teamId !== undefined ? { teamId } : {}),
    ...(playerRow !== null ? { playerId: playerRow.id } : {}),
  };
  try {
    await lookups.validate(pick);
  } catch (error) {
    if (error instanceof ApiError) return flag(validationReason(error));
    throw error;
  }

  const playerTeam = playerRow ? teamsById.get(playerRow.team_id) : undefined;
  return {
    status: 'ready',
    text: leg.text,
    pick,
    game: importedGame(matched, teamsById),
    player: playerRow
      ? {
          player_id: playerRow.id,
          first_name: playerRow.first_name,
          last_name: playerRow.last_name,
          position: playerRow.position,
          team: playerTeam ? { abbreviation: playerTeam.abbreviation } : null,
        }
      : null,
  };
}
