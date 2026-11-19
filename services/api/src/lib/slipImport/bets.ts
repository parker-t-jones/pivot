/**
 * Per-bet grouping for multi-bet screenshot import. Pure, so the route, the confirm pass, and the
 * offline eval share one definition of "how many bets", "same read", and "needs review".
 */
import { resolveTeam } from './mapSlip.js';
import { NFL_SLIP_TEAMS } from './nflTeams.js';
import type { ModelSlipRead, SlipBetType, SlipLeg, SlipRead } from './schema.js';

export interface SlipBetGroup {
  bet_type: SlipBetType;
  legs: SlipLeg[];
}

/** How the confirm pass ended, when it ran. Absent when the primary read was one bet. */
export type SlipConfirmation = 'agreed' | 'disagreed' | 'failed';

/** A read plus what the confirm pass (if any) concluded. Never logged or stored. */
export type ConfirmedSlipRead = SlipRead & { confirmation?: SlipConfirmation };

/** The bet type a group of legs implies. The model's own `bet_type` is checked against this. */
export function betTypeForLegs(count: number): SlipBetType {
  return count > 1 ? 'parlay' : 'single';
}

/** Flattens the model's per-bet answer. Empty bets are kept as zero-leg spans (a review signal). */
export function fromModelRead(read: ModelSlipRead): SlipRead {
  return {
    is_bet_slip: read.is_bet_slip,
    bet_count: read.bet_count,
    legs: read.bets.flatMap((bet) => bet.legs),
    bets: read.bets.map((bet) => ({ bet_type: bet.bet_type, leg_count: bet.legs.length })),
  };
}

/**
 * The read's bets with their legs. A read saved before multi-bet import (no `bets`) is one group
 * when it reported at most one bet; with more, its grouping is unknown and this returns null.
 */
export function slipBets(read: SlipRead): SlipBetGroup[] | null {
  if (read.bets === undefined) {
    if (read.bet_count > 1) return null;
    return [{ bet_type: betTypeForLegs(read.legs.length), legs: read.legs }];
  }
  const groups: SlipBetGroup[] = [];
  let offset = 0;
  for (const bet of read.bets) {
    groups.push({ bet_type: bet.bet_type, legs: read.legs.slice(offset, offset + bet.leg_count) });
    offset += bet.leg_count;
  }
  return groups;
}

/** Bets that have at least one leg. */
export function nonEmptyBets(read: SlipRead): SlipBetGroup[] | null {
  return slipBets(read)?.filter((bet) => bet.legs.length > 0) ?? null;
}

/**
 * True when either signal says the screenshot holds more than one bet: the model's own count or
 * its grouping. Legacy clients get the multiple-bets 422 for these; the confirm pass runs on them.
 */
export function isMultipleBetRead(read: SlipRead): boolean {
  if (!read.is_bet_slip) return false;
  if (read.bet_count > 1) return true;
  return (nonEmptyBets(read)?.length ?? 0) > 1;
}

/**
 * The read disagrees with itself: its count doesn't match its grouping, a bet has no legs, or a
 * bet's type doesn't match its leg count (a one-leg "parlay" may have dropped a leg). Any of these
 * sends a multi-bet import to review instead of preselecting its legs.
 */
export function isInconsistentRead(read: SlipRead): boolean {
  if (!read.is_bet_slip) return false;
  const groups = slipBets(read);
  if (groups === null) return true;
  if (groups.length !== read.bet_count) return true;
  return groups.some(
    (bet) => bet.legs.length === 0 || bet.bet_type !== betTypeForLegs(bet.legs.length),
  );
}

/** Case, punctuation, and spacing don't count: "A.J. Brown" equals "AJ Brown". */
function normalizeName(value: string | null): string {
  if (value === null) return '';
  return value
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The team as it decides the pick. A player leg's team is left out: the player is matched by
 * name, and a printed team only breaks ties, so a blank or differently written team on a player
 * leg doesn't change the pick. Any other leg's team is compared as the NFL team it names, so
 * "CHI", "CHI Bears" and "Chicago Bears" are the same team; a name that isn't an NFL team is
 * compared as written.
 */
function teamKey(leg: SlipLeg): string {
  if (leg.player !== null) return '';
  const team = resolveTeam(leg.team, NFL_SLIP_TEAMS);
  return team ? `team:${team.id}` : normalizeName(leg.team);
}

/**
 * The side as it decides the pick. A touchdown scorer leg with no side is a YES bet, and an
 * "N+" line with no side is an OVER bet (the same defaults `mapSlip.ts` applies), so a read that
 * leaves those blank agrees with one that fills them in.
 */
function sideKey(leg: SlipLeg): SlipLeg['side'] {
  if (leg.side !== null) return leg.side;
  if (leg.market === 'ANYTIME_TD' || leg.market === 'FIRST_TD') return 'YES';
  if (leg.plus_style) return 'OVER';
  return null;
}

/** The fields that decide which pick a leg becomes. Printed text and odds don't count. */
function legKey(leg: SlipLeg): string {
  return JSON.stringify([
    leg.market,
    leg.stat,
    normalizeName(leg.player),
    teamKey(leg),
    sideKey(leg),
    leg.line,
    leg.plus_style,
    leg.period,
  ]);
}

function betKey(bet: SlipBetGroup): string {
  return JSON.stringify([bet.bet_type, bet.legs.map(legKey).sort()]);
}

/**
 * The disagreement rule for the confirm pass (multi-bet import). Two reads agree only when both
 * are bet slips, neither is inconsistent, and they hold the same bets: the same number, and for
 * each bet the same type and the same legs on every pick-deciding field (market, stat, player,
 * team, side, line, N+ style, period), compared as the pick they become (see `teamKey` and
 * `sideKey`). Order of bets and of legs within a bet doesn't matter. Anything that would change
 * a pick still disagrees: a false disagreement only costs a review, a false agreement could
 * import a wrong grouping.
 */
export function slipReadsAgree(a: SlipRead, b: SlipRead): boolean {
  if (!a.is_bet_slip || !b.is_bet_slip) return false;
  if (isInconsistentRead(a) || isInconsistentRead(b)) return false;
  const left = nonEmptyBets(a);
  const right = nonEmptyBets(b);
  if (left === null || right === null || left.length !== right.length) return false;
  const keys = (bets: SlipBetGroup[]) => bets.map(betKey).sort();
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

/**
 * A multi-bet import the user must check leg by leg, with nothing preselected: the confirm pass
 * failed or disagreed, or the read is inconsistent.
 */
export function needsReview(read: ConfirmedSlipRead): boolean {
  if (read.confirmation === 'failed' || read.confirmation === 'disagreed') return true;
  return isInconsistentRead(read);
}
