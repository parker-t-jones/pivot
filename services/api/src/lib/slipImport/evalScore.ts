/**
 * Scoring for the bet slip import eval (#12). Pure, so it is unit tested; the runner is
 * `services/api/src/slipImportEval.ts`.
 */
import { resolveTeam, type SlipTeam } from './mapSlip.js';
import { NFL_SLIP_TEAMS } from './nflTeams.js';
import { SLIP_BET_TYPES, type SlipBetSpan, type SlipLeg, type SlipRead } from './schema.js';

/** The fields a reviewer writes in `<name>.expected.json`. Text and odds are not scored. */
export const SCORED_FIELDS = [
  'market',
  'stat',
  'player',
  'team',
  'side',
  'line',
  'plus_style',
  'period',
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export type ExpectedLeg = Pick<SlipLeg, ScoredField>;

export interface ExpectedSlip {
  bet_count: number;
  /** Every leg, in printed order, across all bets. */
  legs: ExpectedLeg[];
  /** Defaults to true: most eval images are real slips. Set false for a non-slip or unreadable
   *  image used to check that the reader doesn't invent legs for it. */
  is_bet_slip?: boolean;
  /** How `legs` splits into bets, when the expected file says (the `bets` format). Without it,
   *  a slip with `bet_count <= 1` is one bet and a larger count has unknown grouping. */
  bets?: SlipBetSpan[];
}

/**
 * Reads a reviewer's `<name>.expected.json`. Two formats are accepted:
 * - flat (the original): `{ "bet_count": 1, "legs": [...] }`
 * - grouped (multi-bet import): `{ "bets": [{ "bet_type": "parlay", "legs": [...] }, ...] }`,
 *   where `bet_count` is optional and, when present, must equal the number of bets.
 * Both may carry `is_bet_slip`. Anything else throws, naming the file.
 */
export function normalizeExpected(raw: unknown, name = 'expected file'): ExpectedSlip {
  const fail = (why: string): never => {
    throw new Error(`${name}: ${why}`);
  };
  if (typeof raw !== 'object' || raw === null) return fail('expected a JSON object');
  const value = raw as Record<string, unknown>;
  const rawIsBetSlip = value['is_bet_slip'];
  if (rawIsBetSlip !== undefined && typeof rawIsBetSlip !== 'boolean')
    fail('is_bet_slip must be true or false');
  const isBetSlip = typeof rawIsBetSlip === 'boolean' ? rawIsBetSlip : undefined;
  const withSlip = (slip: ExpectedSlip): ExpectedSlip =>
    isBetSlip === undefined ? slip : { ...slip, is_bet_slip: isBetSlip };
  const bets = value['bets'];
  if (bets !== undefined) {
    if (value['legs'] !== undefined) fail('use either "bets" or "legs", not both');
    if (!Array.isArray(bets)) return fail('"bets" must be an array');
    const spans: SlipBetSpan[] = [];
    const legs: ExpectedLeg[] = [];
    for (const [index, bet] of bets.entries()) {
      const entry = bet as { bet_type?: unknown; legs?: unknown };
      if (!SLIP_BET_TYPES.includes(entry?.bet_type as (typeof SLIP_BET_TYPES)[number]))
        fail(`bets[${index}].bet_type must be "single" or "parlay"`);
      if (!Array.isArray(entry.legs) || entry.legs.length === 0)
        fail(`bets[${index}].legs must be a non-empty array`);
      const betLegs = entry.legs as ExpectedLeg[];
      const type = entry.bet_type as SlipBetSpan['bet_type'];
      if ((type === 'parlay') !== betLegs.length > 1)
        fail(`bets[${index}] is a ${type} with ${betLegs.length} leg(s)`);
      spans.push({ bet_type: type, leg_count: betLegs.length });
      legs.push(...betLegs);
    }
    const count = value['bet_count'];
    if (count !== undefined && count !== bets.length)
      fail(`bet_count ${String(count)} does not match ${bets.length} bets`);
    return withSlip({ bet_count: bets.length, legs, bets: spans });
  }
  const flatLegs = value['legs'];
  const flatCount = value['bet_count'];
  if (!Array.isArray(flatLegs)) return fail('needs "legs" (flat) or "bets" (grouped)');
  if (typeof flatCount !== 'number') return fail('the flat format needs "bet_count"');
  return withSlip({ bet_count: flatCount, legs: flatLegs as ExpectedLeg[] });
}

export interface FieldTally {
  correct: number;
  total: number;
}

export interface EvalTally {
  slips: number;
  legCountCorrect: number;
  betCountCorrect: number;
  isBetSlipCorrect: number;
  fields: Record<ScoredField, FieldTally>;
}

export function emptyTally(): EvalTally {
  const fields = Object.fromEntries(
    SCORED_FIELDS.map((field) => [field, { correct: 0, total: 0 }]),
  ) as Record<ScoredField, FieldTally>;
  return { slips: 0, legCountCorrect: 0, betCountCorrect: 0, isBetSlipCorrect: 0, fields };
}

/** Case, punctuation, and spacing don't count against a name: "A.J. Brown" equals "AJ Brown". */
function normalize(value: string | null): string | null {
  if (value === null) return null;
  return value
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function same(field: ScoredField, got: SlipLeg | undefined, want: ExpectedLeg): boolean {
  if (got === undefined) return false;
  if (field === 'team') {
    if (got.team === null && want.team === null) return true;
    const actual = resolveTeam(got.team, EVAL_TEAMS);
    const expected = resolveTeam(want.team, EVAL_TEAMS);
    return actual !== null && expected !== null && actual.id === expected.id;
  }
  if (field === 'player') return normalize(got[field]) === normalize(want[field]);
  return got[field] === want[field];
}

/**
 * Adds one slip to the tally. Legs are compared in printed order; a missing leg counts as wrong
 * on every field, so a dropped leg lowers every field's accuracy.
 */
export function scoreSlip(
  tally: EvalTally,
  got: SlipRead,
  want: ExpectedSlip,
  assignment?: (number | null)[],
): void {
  tally.slips += 1;
  if (got.legs.length === want.legs.length) tally.legCountCorrect += 1;
  if (got.bet_count === want.bet_count) tally.betCountCorrect += 1;
  if (got.is_bet_slip === (want.is_bet_slip ?? true)) tally.isBetSlipCorrect += 1;
  want.legs.forEach((expected, index) => {
    for (const field of SCORED_FIELDS) {
      const entry = tally.fields[field];
      entry.total += 1;
      const actualIndex = assignment ? assignment[index] : index;
      if (
        same(
          field,
          actualIndex === null || actualIndex === undefined ? undefined : got.legs[actualIndex],
          expected,
        )
      )
        entry.correct += 1;
    }
  });
}

export function formatTally(tally: EvalTally): string {
  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
  const lines = [
    `slips: ${tally.slips}`,
    `leg count right: ${tally.legCountCorrect}/${tally.slips} (${pct(tally.legCountCorrect, tally.slips)})`,
    `bet count right: ${tally.betCountCorrect}/${tally.slips} (${pct(tally.betCountCorrect, tally.slips)})`,
    `is_bet_slip right: ${tally.isBetSlipCorrect}/${tally.slips} (${pct(tally.isBetSlipCorrect, tally.slips)})`,
    ...SCORED_FIELDS.map((field) => {
      const { correct, total } = tally.fields[field];
      return `${field.padEnd(10)} ${correct}/${total} (${pct(correct, total)})`;
    }),
  ];
  return lines.join('\n');
}

/** Static NFL fixture; never queries the database. */
export const EVAL_TEAMS: readonly SlipTeam[] = NFL_SLIP_TEAMS;

export function fieldAccuracy(tally: EvalTally): number {
  const fields = Object.values(tally.fields);
  const total = fields.reduce((n, f) => n + f.total, 0);
  return total ? fields.reduce((n, f) => n + f.correct, 0) / total : 0;
}

/** Checked numeric array access for the assignment algorithm's bounded indexes. */
function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error('Invalid assignment index');
  return value;
}

/** Maximum weight bipartite assignment (Hungarian algorithm), including dummy missing legs. */
export function bestLegAssignment(got: SlipRead, want: ExpectedSlip): (number | null)[] {
  const n = Math.max(got.legs.length, want.legs.length);
  const u = Array<number>(n + 1).fill(0),
    v = [...u],
    p = [...u],
    way = [...u];
  const cost = (i: number, j: number) => {
    const expected = want.legs[i - 1];
    return expected ? -SCORED_FIELDS.filter((f) => same(f, got.legs[j - 1], expected)).length : 0;
  };
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array<number>(n + 1).fill(Infinity),
      used = Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = at(p, j0);
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = cost(i0, j) - at(u, i0) - at(v, j);
          if (cur < at(min, j)) {
            min[j] = cur;
            way[j] = j0;
          }
          if (at(min, j) < delta) {
            delta = at(min, j);
            j1 = j;
          }
        }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          const row = at(p, j);
          u[row] = at(u, row) + delta;
          v[j] = at(v, j) - delta;
        } else min[j] = at(min, j) - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = at(way, j0);
      p[j0] = at(p, j1);
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment: (number | null)[] = want.legs.map(() => null);
  for (let j = 1; j <= n; j++)
    if (at(p, j) <= want.legs.length && j <= got.legs.length) assignment[at(p, j) - 1] = j - 1;
  return assignment;
}

export function scoreUnordered(tally: EvalTally, got: SlipRead, want: ExpectedSlip): void {
  scoreSlip(tally, got, want, bestLegAssignment(got, want));
}

export function wrongFields(got: SlipRead, want: ExpectedSlip) {
  return want.legs.flatMap((leg, index) =>
    SCORED_FIELDS.filter((f) => !same(f, got.legs[index], leg)).map((field) => ({
      leg: index,
      field,
      expected: leg[field],
      got: got.legs[index]?.[field] ?? null,
    })),
  );
}
