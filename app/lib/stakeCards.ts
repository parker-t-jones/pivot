/**
 * Pure models for Watchlist stake cards (PIVOT-STAKES-PLAN.md §11.2).
 * Scores come from `GET /games/live` or a realtime `game_state`. The week
 * slate has no score, so a missing score stays on the line-only state.
 */

export const SPREAD_AXIS = 14;
export const TOTAL_AXIS = 21;

export interface GameScore {
  home: number;
  away: number;
}

export type CardPhase = 'line-only' | 'live' | 'final';
export type CoverOutcome = 'covered' | 'pushed' | 'lost';
export type MarkerArrow = 'low' | 'high' | null;

export interface AxisMarker {
  /** Clamped onto the axis. */
  position: number;
  clamped: boolean;
  arrow: MarkerArrow;
}

export interface LineScaleModel {
  axisMin: number;
  axisMax: number;
  /** Push point on the axis. Cover-relative scales put the line at 0. */
  lineAt: number;
  coverFrom: number;
  coverTo: number;
  phase: CardPhase;
  marker: AxisMarker | null;
  outcome: CoverOutcome | null;
}

export interface SpreadLineInput {
  line: number;
  pickedSide: 'home' | 'away';
  status: string;
  score: GameScore | null;
}

export interface TotalLineInput {
  line: number;
  side: 'over' | 'under';
  status: string;
  score: GameScore | null;
}

/** A tie is LOST. No survivor league rule in this client says otherwise. */
export type SurvivorStatus = 'PICK' | 'WON' | 'LOST';

export interface SurvivorBadgeModel {
  abbreviation: string;
  status: SurvivorStatus;
}

export interface RosterStripInput {
  key: string;
  label: string;
  count: number;
}

export interface RosterStripSegment extends RosterStripInput {
  /** Share of the bar. The segments of one strip sum to 100. */
  widthPercent: number;
}

export function pickedSideOf(
  teamId: string | undefined,
  game: { home_team_id: string; away_team_id: string; home_team: string; away_team: string },
): 'home' | 'away' | null {
  if (teamId == null || teamId.length === 0) return null;
  const key = teamId.toUpperCase();
  if (teamId === game.home_team_id || key === game.home_team.toUpperCase()) return 'home';
  if (teamId === game.away_team_id || key === game.away_team.toUpperCase()) return 'away';
  return null;
}

export function axisPercent(position: number, min: number, max: number): number {
  if (max === min) return 0;
  return ((position - min) / (max - min)) * 100;
}

export function spreadLineModel(input: SpreadLineInput): LineScaleModel {
  const score = usableScore(input.status, input.score);
  const raw = score ? margin(score, input.pickedSide) + input.line : null;
  return scaleModel(raw, input.status, -SPREAD_AXIS, SPREAD_AXIS, 0, SPREAD_AXIS, (value) =>
    signedOutcome(value),
  );
}

export function totalLineModel(input: TotalLineInput): LineScaleModel {
  const score = usableScore(input.status, input.score);
  const raw = score ? score.home + score.away - input.line : null;
  const coverFrom = input.side === 'over' ? 0 : -TOTAL_AXIS;
  const coverTo = input.side === 'over' ? TOTAL_AXIS : 0;
  return scaleModel(raw, input.status, -TOTAL_AXIS, TOTAL_AXIS, coverFrom, coverTo, (value) =>
    input.side === 'over' ? signedOutcome(value) : signedOutcome(-value),
  );
}

/**
 * Ring status for one survivor pick. Alive count is intentionally absent:
 * past weeks are not stored, so there is no season record to count.
 * A final tie is LOST; nothing in the stakes schema defines a tiebreaker.
 */
export function survivorBadgeModel(input: {
  abbreviation: string;
  pickedSide: 'home' | 'away';
  status: string;
  score: GameScore | null;
}): SurvivorBadgeModel {
  const abbreviation = input.abbreviation.trim();
  if (input.status !== 'final' || input.score == null) {
    return { abbreviation, status: 'PICK' };
  }
  const picked = input.pickedSide === 'home' ? input.score.home : input.score.away;
  const other = input.pickedSide === 'home' ? input.score.away : input.score.home;
  return { abbreviation, status: picked > other ? 'WON' : 'LOST' };
}

/** Drops empty games. The last segment takes the remainder so the widths sum to 100. */
export function rosterStripModel(segments: readonly RosterStripInput[]): RosterStripSegment[] {
  const playing = segments.filter((segment) => segment.count > 0);
  const total = playing.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return [];
  let used = 0;
  return playing.map((segment, index) => {
    const width = index === playing.length - 1 ? 100 - used : (segment.count / total) * 100;
    used += width;
    return { ...segment, widthPercent: width };
  });
}

export interface StripStarter {
  teamAbbr: string | null;
}

export interface StripGame {
  gameId: string;
  home: string;
  away: string;
  kickoffLabel: string;
}

/** One segment per game that has starters. The label is the team abbreviation, or the kickoff when it is missing. */
export function rosterStripInputs(
  starters: readonly StripStarter[],
  games: readonly StripGame[],
): RosterStripInput[] {
  const grouped = new Map<
    string,
    { label: string; count: number; order: number; labels: string[] }
  >();
  for (const starter of starters) {
    const abbr = starter.teamAbbr?.trim().toUpperCase() ?? '';
    const match = games.findIndex(
      (game) => game.home.toUpperCase() === abbr || game.away.toUpperCase() === abbr,
    );
    if (abbr.length === 0 || match < 0) continue;
    const game = games[match];
    if (!game) continue;
    const existing = grouped.get(game.gameId);
    if (existing) {
      existing.count += 1;
      if (!existing.labels.includes(abbr)) existing.labels.push(abbr);
      existing.label = existing.labels.join(' · ');
      continue;
    }
    grouped.set(game.gameId, {
      label: abbr.length > 0 ? abbr : game.kickoffLabel,
      count: 1,
      order: match,
      labels: [abbr],
    });
  }
  return [...grouped.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, row]) => ({ key, label: row.label, count: row.count }));
}

function usableScore(status: string, score: GameScore | null): GameScore | null {
  if (score == null) return null;
  if (status !== 'in_progress' && status !== 'final') return null;
  return score;
}

function margin(score: GameScore, pickedSide: 'home' | 'away'): number {
  return pickedSide === 'home' ? score.home - score.away : score.away - score.home;
}

function signedOutcome(raw: number): CoverOutcome {
  if (raw > 0) return 'covered';
  if (raw < 0) return 'lost';
  return 'pushed';
}

function scaleModel(
  raw: number | null,
  status: string,
  axisMin: number,
  axisMax: number,
  coverFrom: number,
  coverTo: number,
  outcomeFor: (raw: number) => CoverOutcome,
): LineScaleModel {
  const frame = { axisMin, axisMax, lineAt: 0, coverFrom, coverTo };
  if (raw == null) {
    return { ...frame, phase: 'line-only', marker: null, outcome: null };
  }
  if (status === 'final') {
    return { ...frame, phase: 'final', marker: null, outcome: outcomeFor(raw) };
  }
  return { ...frame, phase: 'live', marker: clampMarker(raw, axisMin, axisMax), outcome: null };
}

function clampMarker(raw: number, min: number, max: number): AxisMarker {
  if (raw > max) return { position: max, clamped: true, arrow: 'high' };
  if (raw < min) return { position: min, clamped: true, arrow: 'low' };
  return { position: raw, clamped: false, arrow: null };
}
