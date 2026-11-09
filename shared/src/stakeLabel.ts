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

const STAT_LABEL: Record<string, string> = {
  PASS_YDS: 'pass yds',
  PASS_COMP: 'completions',
  PASS_ATT: 'pass attempts',
  PASS_TD: 'pass TDs',
  INT_THROWN: 'interceptions',
  RUSH_YDS: 'rush yds',
  RUSH_ATT: 'rush attempts',
  REC_YDS: 'rec yds',
  RECEPTIONS: 'receptions',
  ANY_TD: 'TDs',
  FG_MADE: 'FGs made',
  KICK_PTS: 'kicking pts',
};

const SEGMENT_LABEL: Record<string, string> = {
  Q1: '1Q',
  Q2: '2Q',
  Q3: '3Q',
  Q4: '4Q',
  H1: '1H',
  H2: '2H',
};

export interface PickLabelSource {
  condition: {
    type: string;
    line?: number | null;
    stat?: string;
    event?: string;
    side?: string;
    segment?: string;
  };
  subject: { type: string; teamId?: string | null };
  /** Player props: the player's name, e.g. `"B. Robinson"`. */
  playerName?: string | null;
}

/** `"B. Robinson"` from a first and last name. */
export function shortPlayerName(firstName: string, lastName: string): string {
  const initial = firstName.trim().charAt(0);
  return initial.length > 0 ? `${initial}. ${lastName.trim()}` : lastName.trim();
}

/**
 * Label for any pick, including props and quarter/half lines. The existing four types with no
 * segment read exactly as `formatStakeLabel`. Never states progress: push titles use it.
 */
export function formatPickLabel(pick: PickLabelSource, teams: readonly StakeTeam[]): string {
  const { condition } = pick;
  const type = condition.type;
  const teamId = pick.subject.teamId ?? '';
  const team =
    teams.find((t) => t.teamId === teamId)?.abbreviation ?? (teamId.length > 0 ? teamId : '');
  const segment = condition.segment ? (SEGMENT_LABEL[condition.segment] ?? '') : '';
  const line = typeof condition.line === 'number' ? formatMagnitude(condition.line) : '';
  const player = pick.playerName ?? '';
  const join = (...parts: string[]): string => parts.filter((part) => part.length > 0).join(' ');

  switch (type) {
    case 'STAT_OVER':
    case 'STAT_UNDER':
      return join(
        player,
        type === 'STAT_OVER' ? 'over' : 'under',
        line,
        STAT_LABEL[condition.stat ?? ''] ?? '',
      );
    case 'PLAYER_EVENT': {
      const yes = condition.side !== 'NO';
      if (condition.event === 'FIRST_TD') return join(player, yes ? 'first TD' : 'not first TD');
      return join(player, yes ? 'anytime TD' : 'no TD');
    }
    case 'TEAM_TOTAL_OVER':
    case 'TEAM_TOTAL_UNDER':
      return join(team, segment, 'team total', type === 'TEAM_TOTAL_OVER' ? 'over' : 'under', line);
    case 'FIRST_TO_SCORE':
      return join(team, 'to score first');
    case 'FG_OVER':
    case 'FG_UNDER':
      return join(
        pick.subject.type === 'TEAM' ? team : 'Total',
        segment,
        'FGs',
        type === 'FG_OVER' ? 'over' : 'under',
        line,
      );
    case 'SPREAD':
      if (segment && typeof condition.line === 'number') {
        return join(team, segment, formatSignedLine(condition.line));
      }
      break;
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER':
      if (segment) return join(segment, type === 'TOTAL_OVER' ? 'Over' : 'Under', line);
      break;
    default:
      break;
  }
  return formatStakeLabel(
    {
      condition: { type, line: condition.line ?? null },
      subject: { type: pick.subject.type, teamId: pick.subject.teamId ?? null },
    },
    teams,
  );
}
