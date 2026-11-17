/** Draft expected files for `--draft-expected`, in the grouped `bets` format the eval reads. */
import { betTypeForLegs, slipBets } from './bets.js';
import { SCORED_FIELDS, type ExpectedLeg } from './evalScore.js';
import type { SlipLeg, SlipRead } from './schema.js';

function scored(leg: SlipLeg): ExpectedLeg {
  return Object.fromEntries(SCORED_FIELDS.map((field) => [field, leg[field]])) as ExpectedLeg;
}

/**
 * A read as an expected file's body: `is_bet_slip` and `bets`, each with only the scored leg
 * fields. A read with unknown grouping falls back to the flat format.
 */
export function expectedDraft(read: SlipRead) {
  const bets = slipBets(read);
  if (bets === null)
    return {
      is_bet_slip: read.is_bet_slip,
      bet_count: read.bet_count,
      legs: read.legs.map(scored),
    };
  return {
    is_bet_slip: read.is_bet_slip,
    bets: bets
      .filter((bet) => bet.legs.length > 0)
      .map((bet) => ({ bet_type: betTypeForLegs(bet.legs.length), legs: bet.legs.map(scored) })),
  };
}
