export interface StakeLabelSource {
  condition: { type: string; line?: number | null };
  subject: { type: string; teamId?: string | null };
}

export interface StakeTeam {
  teamId: string;
  abbreviation: string;
}

const MINUS = '\u2212';

function formatMagnitude(line: number): string {
  const abs = Math.abs(line);
  return Number.isInteger(abs) ? String(abs) : String(abs);
}

function formatSignedLine(line: number): string {
  return line < 0 ? `${MINUS}${formatMagnitude(line)}` : `+${formatMagnitude(line)}`;
}

/** Negative spread lines use a true minus. Totals are unsigned. */
export function formatStakeLabel(stake: StakeLabelSource, teams: readonly StakeTeam[]): string {
  const type = stake.condition.type;
  const teamId = stake.subject.teamId ?? '';
  const abbreviation =
    teams.find((team) => team.teamId === teamId)?.abbreviation ?? (teamId.length > 0 ? teamId : '');
  const line = stake.condition.line;

  if (type === 'SPREAD' && typeof line === 'number') {
    return `${abbreviation} ${formatSignedLine(line)}`.trim();
  }
  if (type === 'TOTAL_OVER') {
    return `Over ${typeof line === 'number' ? formatMagnitude(line) : ''}`.trim();
  }
  if (type === 'TOTAL_UNDER') {
    return `Under ${typeof line === 'number' ? formatMagnitude(line) : ''}`.trim();
  }
  if (type === 'MONEYLINE') return `${abbreviation} ML`.trim();
  if (type === 'SURVIVOR') return `Survivor · ${abbreviation}`.trim();
  return abbreviation;
}
