/**
 * Scoring for the bet slip import eval (#12). Pure, so it is unit tested; the runner is
 * `services/api/src/slipImportEval.ts`.
 */
import { resolveTeam, type SlipTeam } from './mapSlip.js';
import type { SlipLeg, SlipRead } from './schema.js';

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
  legs: ExpectedLeg[];
  /** Defaults to true: most eval images are real slips. Set false for a non-slip or unreadable
   *  image used to check that the reader doesn't invent legs for it. */
  is_bet_slip?: boolean;
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
export const EVAL_TEAMS: readonly SlipTeam[] = [
  { id: 'ARI', abbreviation: 'ARI', city: 'Arizona', name: 'Cardinals' },
  { id: 'ATL', abbreviation: 'ATL', city: 'Atlanta', name: 'Falcons' },
  { id: 'BAL', abbreviation: 'BAL', city: 'Baltimore', name: 'Ravens' },
  { id: 'BUF', abbreviation: 'BUF', city: 'Buffalo', name: 'Bills' },
  { id: 'CAR', abbreviation: 'CAR', city: 'Carolina', name: 'Panthers' },
  { id: 'CHI', abbreviation: 'CHI', city: 'Chicago', name: 'Bears' },
  { id: 'CIN', abbreviation: 'CIN', city: 'Cincinnati', name: 'Bengals' },
  { id: 'CLE', abbreviation: 'CLE', city: 'Cleveland', name: 'Browns' },
  { id: 'DAL', abbreviation: 'DAL', city: 'Dallas', name: 'Cowboys' },
  { id: 'DEN', abbreviation: 'DEN', city: 'Denver', name: 'Broncos' },
  { id: 'DET', abbreviation: 'DET', city: 'Detroit', name: 'Lions' },
  { id: 'GB', abbreviation: 'GB', city: 'Green Bay', name: 'Packers' },
  { id: 'HOU', abbreviation: 'HOU', city: 'Houston', name: 'Texans' },
  { id: 'IND', abbreviation: 'IND', city: 'Indianapolis', name: 'Colts' },
  { id: 'JAX', abbreviation: 'JAX', city: 'Jacksonville', name: 'Jaguars' },
  { id: 'KC', abbreviation: 'KC', city: 'Kansas City', name: 'Chiefs' },
  { id: 'LV', abbreviation: 'LV', city: 'Las Vegas', name: 'Raiders' },
  { id: 'LAC', abbreviation: 'LAC', city: 'Los Angeles', name: 'Chargers' },
  { id: 'LAR', abbreviation: 'LAR', city: 'Los Angeles', name: 'Rams' },
  { id: 'MIA', abbreviation: 'MIA', city: 'Miami', name: 'Dolphins' },
  { id: 'MIN', abbreviation: 'MIN', city: 'Minnesota', name: 'Vikings' },
  { id: 'NE', abbreviation: 'NE', city: 'New England', name: 'Patriots' },
  { id: 'NO', abbreviation: 'NO', city: 'New Orleans', name: 'Saints' },
  { id: 'NYG', abbreviation: 'NYG', city: 'New York', name: 'Giants' },
  { id: 'NYJ', abbreviation: 'NYJ', city: 'New York', name: 'Jets' },
  { id: 'PHI', abbreviation: 'PHI', city: 'Philadelphia', name: 'Eagles' },
  { id: 'PIT', abbreviation: 'PIT', city: 'Pittsburgh', name: 'Steelers' },
  { id: 'SF', abbreviation: 'SF', city: 'San Francisco', name: '49ers' },
  { id: 'SEA', abbreviation: 'SEA', city: 'Seattle', name: 'Seahawks' },
  { id: 'TB', abbreviation: 'TB', city: 'Tampa Bay', name: 'Buccaneers' },
  { id: 'TEN', abbreviation: 'TEN', city: 'Tennessee', name: 'Titans' },
  { id: 'WSH', abbreviation: 'WSH', city: 'Washington', name: 'Commanders' },
];

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
