import type {
  GamePlayerStats,
  ParsedPlayerLine,
  ParsedScoringPlay,
  ScoringPlayKind,
  StatKey,
} from '@pivot/shared';
import type { EspnSummary } from './espnTypes.js';
import { resolveTeamAbbreviation } from './mapEspnPlay.js';

/**
 * Pure parse of one ESPN summary into the stats player and team props read
 * (docs/P2-PICKS-MODEL.md §1, §5). Field paths match the committed replay fixture
 * `fixtures/replays/401872948` and `experiments/espn-boxscore-probe.ts`.
 *
 * Team ids are ESPN abbreviations after the `WSH` → `WAS` override, the same ids `mapEspnPlay`
 * puts on a `PlayEvent`. The runner translates both to `teams.id` with one map.
 */

/** Stat group and column for each single-cell `StatKey`. */
const SINGLE_CELLS: readonly (readonly [StatKey, string, string])[] = [
  ['PASS_YDS', 'passing', 'passingYards'],
  ['PASS_TD', 'passing', 'passingTouchdowns'],
  ['INT_THROWN', 'passing', 'interceptions'],
  ['RUSH_YDS', 'rushing', 'rushingYards'],
  ['RUSH_ATT', 'rushing', 'rushingAttempts'],
  ['REC_YDS', 'receiving', 'receivingYards'],
  ['RECEPTIONS', 'receiving', 'receptions'],
  ['KICK_PTS', 'kicking', 'totalKickingPoints'],
];

/** `made/attempts` cells. Index 0 is left of the slash. */
const SPLIT_CELLS: readonly (readonly [StatKey, string, string, 0 | 1])[] = [
  ['PASS_COMP', 'passing', 'completions/passingAttempts', 0],
  ['PASS_ATT', 'passing', 'completions/passingAttempts', 1],
  ['FG_MADE', 'kicking', 'fieldGoalsMade/fieldGoalAttempts', 0],
];

/** TDs the player scored. The passer's passingTouchdowns are not his. */
const SCORED_TD_CELLS: readonly (readonly [string, string])[] = [
  ['rushing', 'rushingTouchdowns'],
  ['receiving', 'receivingTouchdowns'],
  ['kickReturns', 'kickReturnTouchdowns'],
  ['puntReturns', 'puntReturnTouchdowns'],
];

/**
 * A pick-six may appear both as `defensiveTouchdowns` and `interceptionTouchdowns`. Unverified
 * against a live game, so the larger of the two is used rather than the sum.
 */
const DEFENSIVE_TD_CELLS: readonly (readonly [string, string])[] = [
  ['defensive', 'defensiveTouchdowns'],
  ['interceptions', 'interceptionTouchdowns'],
];

function toNumber(cell: string | undefined, part?: 0 | 1): number | undefined {
  if (cell === undefined) return undefined;
  const raw = part === undefined ? cell : cell.split('/')[part];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

type Cells = Map<string, Map<string, string>>;

/** athleteId -> group -> key -> raw cell. */
interface AthleteCells {
  teamId: string;
  displayName: string;
  cells: Cells;
}

function collectCells(summary: EspnSummary): Map<string, AthleteCells> {
  const athletes = new Map<string, AthleteCells>();
  for (const team of summary.boxscore?.players ?? []) {
    const abbreviation = team.team?.abbreviation;
    if (abbreviation === undefined) continue;
    const teamId = resolveTeamAbbreviation(abbreviation);
    for (const group of team.statistics ?? []) {
      const groupName = group.name;
      const keys = group.keys ?? [];
      if (groupName === undefined) continue;
      for (const entry of group.athletes ?? []) {
        const id = entry.athlete.id;
        let athlete = athletes.get(id);
        if (athlete === undefined) {
          athlete = { teamId, displayName: entry.athlete.displayName ?? '', cells: new Map() };
          athletes.set(id, athlete);
        }
        const row = new Map<string, string>();
        keys.forEach((key, index) => {
          const value = entry.stats?.[index];
          if (value !== undefined) row.set(key, value);
        });
        athlete.cells.set(groupName, row);
      }
    }
  }
  return athletes;
}

function cell(cells: Cells, group: string, key: string): string | undefined {
  return cells.get(group)?.get(key);
}

function playerLine(athlete: AthleteCells): ParsedPlayerLine {
  const stats: Partial<Record<StatKey, number>> = {};
  for (const [stat, group, key] of SINGLE_CELLS) {
    const value = toNumber(cell(athlete.cells, group, key));
    if (value !== undefined) stats[stat] = value;
  }
  for (const [stat, group, key, part] of SPLIT_CELLS) {
    const value = toNumber(cell(athlete.cells, group, key), part);
    if (value !== undefined) stats[stat] = value;
  }

  // Missing groups count as zero; neither group leaves the parsed stat undefined.
  if (athlete.cells.has('rushing') || athlete.cells.has('receiving')) {
    stats.RUSH_REC_YDS = (stats.RUSH_YDS ?? 0) + (stats.REC_YDS ?? 0);
  }

  let scored = 0;
  let any = false;
  for (const [group, key] of SCORED_TD_CELLS) {
    const value = toNumber(cell(athlete.cells, group, key));
    if (value === undefined) continue;
    any = true;
    scored += value;
  }
  let defensive = 0;
  for (const [group, key] of DEFENSIVE_TD_CELLS) {
    const value = toNumber(cell(athlete.cells, group, key));
    if (value === undefined) continue;
    any = true;
    defensive = Math.max(defensive, value);
  }
  // A player listed only under passing/kicking has scored no TD, which is still a known 0.
  stats.ANY_TD = any ? scored + defensive : 0;

  return { teamId: athlete.teamId, displayName: athlete.displayName, stats };
}

function linescoresFor(summary: EspnSummary, side: 'home' | 'away'): number[] {
  const competitor = summary.header?.competitions?.[0]?.competitors?.find(
    (c) => c.homeAway === side,
  );
  return (competitor?.linescores ?? []).map((period) => {
    if (typeof period.value === 'number' && Number.isFinite(period.value)) return period.value;
    return toNumber(period.displayValue) ?? 0;
  });
}

function scoringKind(play: NonNullable<EspnSummary['scoringPlays']>[number]): ScoringPlayKind {
  const name = play.scoringType?.name;
  const abbreviation = play.type?.abbreviation;
  if (name === 'touchdown' || abbreviation === 'TD') return 'TD';
  if (name === 'field-goal' || abbreviation === 'FG') return 'FG';
  return 'OTHER';
}

function scoringPlays(summary: EspnSummary): ParsedScoringPlay[] {
  const plays: ParsedScoringPlay[] = [];
  for (const play of summary.scoringPlays ?? []) {
    const abbreviation = play.team?.abbreviation;
    if (abbreviation === undefined) continue;
    plays.push({
      teamId: resolveTeamAbbreviation(abbreviation),
      period: play.period?.number ?? 0,
      kind: scoringKind(play),
      text: play.text ?? '',
    });
  }
  return plays;
}

export function isSummaryFinal(summary: EspnSummary): boolean {
  const statusType = summary.header?.competitions?.[0]?.status?.type;
  return Boolean(statusType?.completed) || statusType?.state === 'post';
}

export function parseEspnPlayerStats(
  summary: EspnSummary,
  gameId: string,
  fetchedAt: number,
): GamePlayerStats {
  const players: Record<string, ParsedPlayerLine> = {};
  for (const [id, athlete] of collectCells(summary)) players[id] = playerLine(athlete);
  return {
    gameId,
    fetchedAt,
    final: isSummaryFinal(summary),
    players,
    linescores: { home: linescoresFor(summary, 'home'), away: linescoresFor(summary, 'away') },
    scoringPlays: scoringPlays(summary),
  };
}
