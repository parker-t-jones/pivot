/** Offline condition/team projection of the real mapper, not a player or schedule lookup. */
import { isDeepStrictEqual } from 'node:util';
import { EVAL_TEAMS, type ExpectedLeg, type ExpectedSlip } from './evalScore.js';
import { buildCondition, resolveTeam } from './mapSlip.js';
import type { SlipLeg, SlipRead } from './schema.js';

export interface LegOutcome {
  leg: number;
  outcome: 'match' | 'flagged' | 'silent_wrong';
  team_differs: 'blank' | 'different' | null;
}
export interface ImportOutcome {
  legs: LegOutcome[];
  slips: ('rejected_multiple_bets' | 'unreadable' | 'false_accept')[];
}
export function emptyImportTally() {
  return {
    match: 0,
    flagged: 0,
    silent_wrong: 0,
    team_differs_blank: 0,
    team_differs_different: 0,
    rejected_multiple_bets: 0,
    unreadable: 0,
    false_accept: 0,
  };
}
export type ImportTally = ReturnType<typeof emptyImportTally>;

function fullLeg(leg: ExpectedLeg): SlipLeg {
  return { text: '', matchup: [], game_date: null, odds: null, ...leg };
}

function scoreLeg(
  got: SlipLeg | undefined,
  want: ExpectedLeg | undefined,
  leg: number,
): LegOutcome {
  const result = (
    outcome: LegOutcome['outcome'],
    team_differs: LegOutcome['team_differs'] = null,
  ): LegOutcome => ({ leg, outcome, team_differs });
  if (!got) return result('flagged');
  const actual = buildCondition(got);
  const expected = want ? buildCondition(fullLeg(want)) : null;
  // Unsupported reads remain visibly flagged, including when the expected leg is unsupported.
  if (!actual.ok) return result('flagged');
  const team = resolveTeam(got.team, EVAL_TEAMS);
  const needsTeam = actual.needs === 'team' || (actual.needs === 'teamOrGame' && got.team !== null);
  if (needsTeam && !team) return result('flagged');
  if (!expected?.ok || !isDeepStrictEqual(actual.condition, expected.condition))
    return result('silent_wrong');
  const expectedTeam = resolveTeam(want?.team ?? null, EVAL_TEAMS);
  if (actual.needs === 'player') {
    if (want?.team !== null && expectedTeam?.id !== team?.id)
      return result('match', got.team === null ? 'blank' : 'different');
    return result('match');
  }
  if (needsTeam && expectedTeam && team?.id !== expectedTeam.id) return result('silent_wrong');
  return result('match');
}

/** Positional, like the raw scorecard. Slip-level refusal takes precedence over leg scoring. */
export function scoreImportOutcome(got: SlipRead, want: ExpectedSlip): ImportOutcome {
  const slips: ImportOutcome['slips'] = [];
  if (!(want.is_bet_slip ?? true)) {
    if (got.is_bet_slip) slips.push('false_accept');
    return { legs: [], slips };
  }
  if (!got.is_bet_slip || got.legs.length === 0) slips.push('unreadable');
  else if (got.bet_count > 1 && want.bet_count <= 1) slips.push('rejected_multiple_bets');
  if (slips.length) return { legs: [], slips };
  return {
    legs: Array.from({ length: Math.max(got.legs.length, want.legs.length) }, (_, index) =>
      scoreLeg(got.legs[index], want.legs[index], index),
    ),
    slips,
  };
}

export function addImportOutcome(tally: ImportTally, outcome: ImportOutcome): void {
  for (const leg of outcome.legs) {
    tally[leg.outcome]++;
    if (leg.team_differs === 'blank') tally.team_differs_blank++;
    if (leg.team_differs === 'different') tally.team_differs_different++;
  }
  for (const slip of outcome.slips) tally[slip]++;
}
