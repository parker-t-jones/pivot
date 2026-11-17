/** Offline condition/team projection of the real mapper, not a player or schedule lookup. */
import { isDeepStrictEqual } from 'node:util';
import { isMultipleBetRead, slipBets } from './bets.js';
import { EVAL_TEAMS, bestLegAssignment, type ExpectedLeg, type ExpectedSlip } from './evalScore.js';
import { buildCondition, resolveTeam } from './mapSlip.js';
import type { SlipLeg, SlipRead } from './schema.js';

export interface LegOutcome {
  leg: number;
  outcome: 'match' | 'flagged' | 'silent_wrong';
  team_differs: 'blank' | 'different' | null;
}
export interface ImportOutcome {
  legs: LegOutcome[];
  /**
   * `unreadable` and `false_accept` stop leg scoring. `rejected_multiple_bets` is what a legacy
   * client (iOS 1.1.0, no multi-bet capability) gets: a refusal of a single-bet slip. It no longer
   * stops leg scoring, because a multi-bet client imports that read. `silent_wrong_grouping` is
   * an accepted read, not sent to review, whose legs are split into bets differently from the
   * slip: a multi-bet client would preselect the wrong bets.
   */
  slips: ('rejected_multiple_bets' | 'unreadable' | 'false_accept' | 'silent_wrong_grouping')[];
  /** Whether the read split legs into bets as the slip does. Null when either side's grouping is
   *  unknown (a pre-grouping read or a flat expected file with `bet_count > 1`). */
  grouping: 'correct' | 'wrong' | null;
  /** The multi-bet client would show this import for review with nothing preselected. */
  review: boolean;
  /** The expected slip has more than one bet. */
  multi_bet: boolean;
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
    review: 0,
    grouping_correct: 0,
    grouping_wrong: 0,
    silent_wrong_grouping: 0,
    multi_bet_slips: 0,
    multi_bet_grouping_correct: 0,
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

/** Bet index of every leg, from per-bet leg counts. */
function betOfLeg(counts: number[]): number[] {
  return counts.flatMap((count, bet) => Array.from({ length: count }, () => bet));
}

/** The expected per-bet leg counts, or null when the expected file doesn't say. */
function expectedCounts(want: ExpectedSlip): number[] | null {
  if (want.bets) return want.bets.map((bet) => bet.leg_count);
  return want.bet_count <= 1 ? [want.legs.length] : null;
}

/**
 * Whether the read splits legs into bets the way the slip does. Legs are matched by the same
 * best assignment as the order-insensitive scorecard; the grouping is right when every expected
 * leg has a read leg, the leg and bet counts match, and the bets correspond one to one (each
 * expected bet's legs all sit in one read bet, and no read bet mixes two expected bets). Bet
 * types follow from leg counts, so a right grouping has right bet types.
 */
export function scoreGrouping(got: SlipRead, want: ExpectedSlip): 'correct' | 'wrong' | null {
  const wantCounts = expectedCounts(want);
  const gotBets = slipBets(got);
  if (wantCounts === null || gotBets === null) return null;
  const gotCounts = gotBets.map((bet) => bet.legs.length).filter((count) => count > 0);
  if (gotCounts.length !== wantCounts.length || got.legs.length !== want.legs.length)
    return 'wrong';
  const wantBet = betOfLeg(wantCounts);
  const gotBet = betOfLeg(gotBets.map((bet) => bet.legs.length));
  const assignment = bestLegAssignment(got, want);
  const forward = new Map<number, number>();
  const backward = new Map<number, number>();
  for (const [index, actual] of assignment.entries()) {
    if (actual === null || actual === undefined) return 'wrong';
    const w = wantBet[index];
    const g = gotBet[actual];
    if (w === undefined || g === undefined) return 'wrong';
    if ((forward.get(w) ?? g) !== g || (backward.get(g) ?? w) !== w) return 'wrong';
    forward.set(w, g);
    backward.set(g, w);
  }
  return 'correct';
}

/**
 * Scores what the multi-bet client would import. Positional legs, like the raw scorecard. A
 * slip refusal or false accept takes precedence over leg scoring. In review (`options.review`),
 * nothing is preselected and the user is told to check each leg, so a wrong leg counts as
 * flagged, not silently wrong.
 */
export function scoreImportOutcome(
  got: SlipRead,
  want: ExpectedSlip,
  options: { review?: boolean } = {},
): ImportOutcome {
  const review = options.review ?? false;
  const multi_bet = (want.bets?.length ?? want.bet_count) > 1;
  const slips: ImportOutcome['slips'] = [];
  const none = { legs: [], slips, grouping: null, review: false, multi_bet };
  if (!(want.is_bet_slip ?? true)) {
    if (got.is_bet_slip) slips.push('false_accept');
    return none;
  }
  if (!got.is_bet_slip || got.legs.length === 0) {
    slips.push('unreadable');
    return none;
  }
  if (isMultipleBetRead(got) && want.bet_count <= 1) slips.push('rejected_multiple_bets');
  const grouping = scoreGrouping(got, want);
  if (grouping === 'wrong' && !review) slips.push('silent_wrong_grouping');
  const legs = Array.from({ length: Math.max(got.legs.length, want.legs.length) }, (_, index) =>
    scoreLeg(got.legs[index], want.legs[index], index),
  ).map((leg) =>
    review && leg.outcome === 'silent_wrong' ? { ...leg, outcome: 'flagged' as const } : leg,
  );
  return { legs, slips, grouping, review, multi_bet };
}

export function addImportOutcome(tally: ImportTally, outcome: ImportOutcome): void {
  for (const leg of outcome.legs) {
    tally[leg.outcome]++;
    if (leg.team_differs === 'blank') tally.team_differs_blank++;
    if (leg.team_differs === 'different') tally.team_differs_different++;
  }
  for (const slip of outcome.slips) tally[slip]++;
  if (outcome.review) tally.review++;
  if (outcome.grouping === 'correct') tally.grouping_correct++;
  if (outcome.grouping === 'wrong') tally.grouping_wrong++;
  if (outcome.multi_bet) {
    tally.multi_bet_slips++;
    if (outcome.grouping === 'correct') tally.multi_bet_grouping_correct++;
  }
}
