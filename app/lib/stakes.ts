export type ManualStakeType = 'SPREAD' | 'TOTAL_OVER' | 'TOTAL_UNDER' | 'MONEYLINE' | 'SURVIVOR';

export interface StakeLabelSource {
  condition: { type: string; line?: number | null };
  subject: { type: string; teamId?: string | null };
}

export interface StakeTeam {
  teamId: string;
  abbreviation: string;
}

export interface StakeRequest {
  type: ManualStakeType;
  gameId: string;
  teamId?: string;
  line?: number;
}

export interface ManualStakeGame {
  scheduled_start: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
}

export interface ManualStake {
  id: string;
  season: number;
  week: number;
  game_id: string;
  source: string;
  weight: number;
  subject: { type: string; teamId?: string; gameId?: string };
  condition: { type: string; line?: number; side?: string };
  game: ManualStakeGame | null;
}

export interface StakesResponse {
  week: number;
  stakes: ManualStake[];
}

const MINUS = '\u2212';

function isHalfPoint(line: number): boolean {
  const doubled = line * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-6;
}

function formatMagnitude(line: number): string {
  const abs = Math.abs(line);
  return Number.isInteger(abs) ? String(abs) : String(abs);
}

/** Negative lines use a true minus sign. Non-negative lines use a plus. */
export function formatSignedLine(line: number): string {
  return line < 0 ? `${MINUS}${formatMagnitude(line)}` : `+${formatMagnitude(line)}`;
}

export function formatStakeLabel(stake: StakeLabelSource, teams: readonly StakeTeam[]): string {
  const type = stake.condition.type;
  const teamId = stake.subject.teamId ?? '';
  const abbreviation =
    teams.find((team) => team.teamId === teamId)?.abbreviation ?? (teamId.length > 0 ? teamId : '');
  const line = stake.condition.line;

  if (type === 'SPREAD' && typeof line === 'number') {
    return `${abbreviation} ${formatSignedLine(line)}`.trim();
  }
  if (type === 'TOTAL_OVER')
    return `Over ${typeof line === 'number' ? formatMagnitude(line) : ''}`.trim();
  if (type === 'TOTAL_UNDER') {
    return `Under ${typeof line === 'number' ? formatMagnitude(line) : ''}`.trim();
  }
  if (type === 'MONEYLINE') return `${abbreviation} ML`.trim();
  if (type === 'SURVIVOR') return `Survivor · ${abbreviation}`.trim();
  return abbreviation;
}

export function validateLine(
  type: ManualStakeType,
  input: string,
): { ok: true; line?: number } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (type === 'MONEYLINE' || type === 'SURVIVOR') {
    if (trimmed.length > 0) {
      return { ok: false, message: 'This bet does not take a line.' };
    }
    return { ok: true };
  }

  if (trimmed.length === 0) return { ok: false, message: 'Enter a line.' };
  const negative = trimmed.startsWith('-') || trimmed.startsWith(MINUS);
  const numeric = trimmed.replace(/^[+\u2212-]/, '');
  if (numeric.length === 0) return { ok: false, message: 'Enter a line.' };
  const value = Number(numeric);
  if (!Number.isFinite(value)) return { ok: false, message: 'Enter a number.' };
  const signed = negative ? -Math.abs(value) : Math.abs(value);

  if (!isHalfPoint(signed)) {
    return { ok: false, message: 'Use steps of 0.5.' };
  }
  if (type === 'SPREAD') {
    if (Math.abs(signed) > 50) {
      return { ok: false, message: 'Spread must be between −50 and +50.' };
    }
    return { ok: true, line: signed };
  }
  if (signed < 10 || signed > 100) {
    return { ok: false, message: 'Total must be between 10 and 100.' };
  }
  return { ok: true, line: signed };
}

export function buildStakeRequest(input: {
  type: ManualStakeType;
  gameId: string;
  teamId?: string;
  line?: number;
}): StakeRequest {
  const needsTeam =
    input.type === 'SPREAD' || input.type === 'MONEYLINE' || input.type === 'SURVIVOR';
  const needsLine =
    input.type === 'SPREAD' || input.type === 'TOTAL_OVER' || input.type === 'TOTAL_UNDER';
  const request: StakeRequest = { type: input.type, gameId: input.gameId };
  if (needsTeam && input.teamId !== undefined) request.teamId = input.teamId;
  if (needsLine && input.line !== undefined) request.line = input.line;
  return request;
}

export function stakeErrorCopy(code: string): string {
  switch (code) {
    case 'stake_game_invalid':
      return 'That game is not open for a bet.';
    case 'stake_team_invalid':
      return 'Pick a team in that game.';
    case 'stake_line_invalid':
      return 'That line is not valid.';
    case 'survivor_pick_exists':
      return 'You already have a survivor pick this week.';
    case 'stake_duplicate':
      return 'You already added this bet.';
    case 'stake_managed_by_sync':
      return 'This bet is managed by your league sync.';
    default:
      return 'Could not save that bet.';
  }
}

export function stakeTeams(stake: ManualStake): StakeTeam[] {
  if (!stake.game) return [];
  return [
    { teamId: stake.game.home_team_id, abbreviation: stake.game.home_team },
    { teamId: stake.game.away_team_id, abbreviation: stake.game.away_team },
  ];
}
