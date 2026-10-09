/**
 * Canonical Lineup-tab order and slot labels.
 *
 * `GET /leagues/:id/lineup` orders by `created_at` only. Rows that share a slot
 * string then follow that unstable order, so a star refetch can swap them.
 * This sort is a total order: slot family, numeric suffix, then player id.
 * It does not read `is_star`.
 *
 * Flex variants are the ones `mapRosterToLineupSlots` accepts:
 * FLEX, SUPER_FLEX, WRRB_FLEX, REC_FLEX.
 */

export interface LineupOrderRow {
  position_in_lineup: string;
  slot_type: string;
  player: { player_id: string };
}

/** Display labels. Numeric suffixes are stripped; unknown bases pass through uppercased. */
const SLOT_LABELS: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  FLEX: 'FLEX',
  SUPER_FLEX: 'SF',
  K: 'K',
  KICKER: 'K',
  DEF: 'DEF',
  DEFENSE: 'DEF',
};

/**
 * Family rank. KICKER/DEFENSE alias onto K/DEF so a raw display string still
 * sorts with the real slot. Unknowns sit after DEF and before bench/IR.
 */
const STARTER_RANK: Record<string, number> = {
  QB: 0,
  RB: 1,
  WR: 2,
  TE: 3,
  FLEX: 4,
  SUPER_FLEX: 5,
  WRRB_FLEX: 6,
  REC_FLEX: 7,
  K: 8,
  DEF: 9,
};

const STARTER_ALIASES: Record<string, string> = {
  KICKER: 'K',
  DEFENSE: 'DEF',
};

const UNKNOWN_RANK = 10;
const BENCH_RANK = 11;

/** Within the bench/IR family. Anything else with `slot_type: 'bench'` follows these. */
const BENCH_SUB_RANK: Record<string, number> = {
  BN: 0,
  BENCH: 0,
  IR: 1,
  TAXI: 2,
};

const OTHER_BENCH_SUB = 3;

interface SortKey {
  family: number;
  sub: number;
  base: string;
  ordinal: number;
  playerId: string;
}

export function slotLabel(raw: string): string {
  const parsed = parseSlot(raw);
  if (!parsed) return raw.trim().toUpperCase();
  return SLOT_LABELS[parsed.token] ?? parsed.token;
}

export function orderLineupSlots<T extends LineupOrderRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareKeys(sortKey(a), sortKey(b)));
}

function parseSlot(raw: string): { token: string; ordinal: number } | null {
  const match = /^([A-Za-z_]+)(\d+)?$/.exec(raw.trim());
  if (!match?.[1]) return null;
  const ordinal = match[2] ? Number.parseInt(match[2], 10) : 0;
  return { token: match[1].toUpperCase(), ordinal };
}

function sortKey(row: LineupOrderRow): SortKey {
  const parsed = parseSlot(row.position_in_lineup);
  const token = parsed?.token ?? row.position_in_lineup.trim().toUpperCase();
  const ordinal = parsed?.ordinal ?? 0;
  const starterBase = STARTER_ALIASES[token] ?? token;
  const benchSub = BENCH_SUB_RANK[token];
  const benchLike = row.slot_type === 'bench' || benchSub !== undefined;

  if (benchLike) {
    return {
      family: BENCH_RANK,
      sub: benchSub ?? OTHER_BENCH_SUB,
      base: benchSub === undefined ? token : '',
      ordinal,
      playerId: row.player.player_id,
    };
  }

  const family = STARTER_RANK[starterBase];
  if (family === undefined) {
    return {
      family: UNKNOWN_RANK,
      sub: 0,
      base: token,
      ordinal,
      playerId: row.player.player_id,
    };
  }

  return {
    family,
    sub: 0,
    base: '',
    ordinal,
    playerId: row.player.player_id,
  };
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (a.family !== b.family) return a.family - b.family;
  if (a.sub !== b.sub) return a.sub - b.sub;
  if (a.base !== b.base) return a.base < b.base ? -1 : 1;
  if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
  if (a.playerId !== b.playerId) return a.playerId < b.playerId ? -1 : 1;
  return 0;
}
