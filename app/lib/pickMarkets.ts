import { STAT_LINE_RANGE, type PlayerEvent, type Segment, type StatKey } from '@pivot/shared/picks';

/**
 * Markets offered in "Add a pick" for player props and team/game props (docs/P2-PICKS-MODEL.md
 * §1). The API validates the same ranges; these only drive the steppers and the inline error.
 */

export interface LineBounds {
  min: number;
  max: number;
}

export type PlayerMarket =
  | { key: StatKey; kind: 'stat'; stat: StatKey; label: string; unit: string }
  | { key: 'ANYTIME_TD' | 'FIRST_TD'; kind: 'event'; event: PlayerEvent; label: string };

export type PlayerMarketKey = PlayerMarket['key'];

const stat = (key: StatKey, label: string, unit: string): PlayerMarket => ({
  key,
  kind: 'stat',
  stat: key,
  label,
  unit,
});

const PLAYER_MARKETS: Record<PlayerMarketKey, PlayerMarket> = {
  PASS_YDS: stat('PASS_YDS', 'Passing yards', 'passing yards'),
  PASS_COMP: stat('PASS_COMP', 'Completions', 'completions'),
  PASS_ATT: stat('PASS_ATT', 'Pass attempts', 'pass attempts'),
  PASS_TD: stat('PASS_TD', 'Passing TDs', 'passing touchdowns'),
  INT_THROWN: stat('INT_THROWN', 'Interceptions thrown', 'interceptions thrown'),
  RUSH_YDS: stat('RUSH_YDS', 'Rushing yards', 'rushing yards'),
  RUSH_ATT: stat('RUSH_ATT', 'Rushing attempts', 'rushing attempts'),
  REC_YDS: stat('REC_YDS', 'Receiving yards', 'receiving yards'),
  RECEPTIONS: stat('RECEPTIONS', 'Receptions', 'receptions'),
  ANY_TD: stat('ANY_TD', 'TDs scored', 'touchdowns'),
  FG_MADE: stat('FG_MADE', 'Field goals made', 'made field goals'),
  KICK_PTS: stat('KICK_PTS', 'Kicking points', 'kicking points'),
  ANYTIME_TD: { key: 'ANYTIME_TD', kind: 'event', event: 'ANY_TD', label: 'Anytime TD' },
  FIRST_TD: { key: 'FIRST_TD', kind: 'event', event: 'FIRST_TD', label: 'First TD' },
};

const TD_MARKETS: readonly PlayerMarketKey[] = ['ANYTIME_TD', 'FIRST_TD', 'ANY_TD'];

const MARKETS_BY_POSITION: Record<string, readonly PlayerMarketKey[]> = {
  QB: [
    'PASS_YDS',
    'PASS_TD',
    'PASS_COMP',
    'PASS_ATT',
    'INT_THROWN',
    'RUSH_YDS',
    'RUSH_ATT',
    ...TD_MARKETS,
  ],
  RB: ['RUSH_YDS', 'RUSH_ATT', 'REC_YDS', 'RECEPTIONS', ...TD_MARKETS],
  WR: ['REC_YDS', 'RECEPTIONS', 'RUSH_YDS', ...TD_MARKETS],
  TE: ['REC_YDS', 'RECEPTIONS', ...TD_MARKETS],
  K: ['FG_MADE', 'KICK_PTS'],
};

/** Skill-position markets for any other offensive position. */
const FALLBACK_MARKETS: readonly PlayerMarketKey[] = [
  'RUSH_YDS',
  'RUSH_ATT',
  'REC_YDS',
  'RECEPTIONS',
  ...TD_MARKETS,
];

/** A team defense is not a player, so it has no props. */
export function playerHasProps(position: string): boolean {
  return position.trim().toUpperCase() !== 'DEF';
}

export function playerMarketsFor(position: string): PlayerMarket[] {
  if (!playerHasProps(position)) return [];
  const keys = MARKETS_BY_POSITION[position.trim().toUpperCase()] ?? FALLBACK_MARKETS;
  return keys.map((key) => PLAYER_MARKETS[key]);
}

export function playerMarket(key: PlayerMarketKey): PlayerMarket {
  return PLAYER_MARKETS[key];
}

/** Placeholder and the number an untouched field steps from. A typical line for the stat. */
const STAT_BASELINE: Record<StatKey, number> = {
  PASS_YDS: 224.5,
  PASS_COMP: 21.5,
  PASS_ATT: 33.5,
  PASS_TD: 1.5,
  INT_THROWN: 0.5,
  RUSH_YDS: 49.5,
  RUSH_ATT: 14.5,
  REC_YDS: 49.5,
  RECEPTIONS: 4.5,
  ANY_TD: 1.5,
  FG_MADE: 1.5,
  KICK_PTS: 7.5,
};

export function statBounds(key: StatKey): LineBounds {
  return STAT_LINE_RANGE[key];
}

export function statBaseline(key: StatKey): number {
  return STAT_BASELINE[key];
}

/** `null` is the full game, OT included. */
export type Period = Segment | null;

export type TeamMarketKey =
  | 'TEAM_TOTAL'
  | 'FIRST_TO_SCORE'
  | 'SEGMENT_SPREAD'
  | 'SEGMENT_TOTAL'
  | 'GAME_FG'
  | 'TEAM_FG';

export interface TeamMarket {
  key: TeamMarketKey;
  label: string;
  explainer: string;
  /** `side`: pick a team on the game row. `game`: pick the whole game. */
  mode: 'side' | 'game';
  /** How the line reads. `null`: no line (first to score). */
  roles: 'spread' | 'overUnder' | null;
  /** Periods offered, in order. Empty: no period control. */
  periods: readonly Period[];
}

const QUARTERS_AND_HALVES: readonly Segment[] = ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2'];
const ANY_PERIOD: readonly Period[] = [null, ...QUARTERS_AND_HALVES];

export const TEAM_MARKETS: readonly TeamMarket[] = [
  {
    key: 'TEAM_TOTAL',
    label: 'Team total',
    explainer: "Over or under one team's points",
    mode: 'side',
    roles: 'overUnder',
    periods: ANY_PERIOD,
  },
  {
    key: 'FIRST_TO_SCORE',
    label: 'First team to score',
    explainer: 'Pick the team that scores first',
    mode: 'side',
    roles: null,
    periods: [],
  },
  {
    key: 'SEGMENT_SPREAD',
    label: 'Quarter or half spread',
    explainer: 'Pick a team to cover the line in one quarter or half',
    mode: 'side',
    roles: 'spread',
    periods: QUARTERS_AND_HALVES,
  },
  {
    key: 'SEGMENT_TOTAL',
    label: 'Quarter or half total',
    explainer: 'Over or under the combined score in one quarter or half',
    mode: 'game',
    roles: 'overUnder',
    periods: QUARTERS_AND_HALVES,
  },
  {
    key: 'GAME_FG',
    label: 'Total field goals',
    explainer: 'Over or under the field goals both teams make',
    mode: 'game',
    roles: 'overUnder',
    periods: ANY_PERIOD,
  },
  {
    key: 'TEAM_FG',
    label: 'Team field goals',
    explainer: 'Over or under the field goals one team makes',
    mode: 'side',
    roles: 'overUnder',
    periods: ANY_PERIOD,
  },
];

export function teamMarket(key: TeamMarketKey): TeamMarket {
  const market = TEAM_MARKETS.find((option) => option.key === key);
  if (!market) throw new Error(`Unknown team market ${key}`);
  return market;
}

/**
 * The period a market starts on: the full game where it is offered (or there is no period
 * control). A segment-only market starts unset, so Continue waits for it.
 */
export function defaultPeriod(market: TeamMarket): Period | undefined {
  return market.periods.length === 0 || market.periods.includes(null) ? null : undefined;
}

export const PERIOD_LABEL: Record<Segment | 'FULL', string> = {
  FULL: 'Game',
  Q1: '1Q',
  Q2: '2Q',
  Q3: '3Q',
  Q4: '4Q',
  H1: '1H',
  H2: '2H',
};

export function periodKey(period: Period): Segment | 'FULL' {
  return period ?? 'FULL';
}

export function periodFromKey(key: string): Period {
  return key === 'FULL' ? null : (key as Segment);
}

function isQuarter(period: Period): boolean {
  return period === 'Q1' || period === 'Q2' || period === 'Q3' || period === 'Q4';
}

export function teamMarketBounds(key: TeamMarketKey): LineBounds {
  switch (key) {
    case 'SEGMENT_SPREAD':
      return { min: 0.5, max: 50 };
    case 'GAME_FG':
    case 'TEAM_FG':
      return { min: 0.5, max: 10 };
    default:
      return { min: 0.5, max: 70 };
  }
}

export function teamMarketBaseline(key: TeamMarketKey, period: Period): number {
  const quarter = isQuarter(period);
  switch (key) {
    case 'TEAM_TOTAL':
      return period === null ? 21.5 : quarter ? 3.5 : 10.5;
    case 'SEGMENT_SPREAD':
      return quarter ? 0.5 : 2.5;
    case 'SEGMENT_TOTAL':
      return quarter ? 10.5 : 21.5;
    case 'GAME_FG':
      return period === null ? 3.5 : quarter ? 0.5 : 1.5;
    case 'TEAM_FG':
      return period === null ? 1.5 : 0.5;
    case 'FIRST_TO_SCORE':
      return 0.5;
  }
}

/** Half-point line inside `bounds`. The message names the range in plain words. */
export function validateHalfLine(
  input: string,
  bounds: LineBounds,
): { ok: true; line: number } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: 'Enter a line.' };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: 'Enter a number.' };
  if (Math.abs(value * 2 - Math.round(value * 2)) > 1e-6) {
    return { ok: false, message: 'Use steps of 0.5.' };
  }
  if (value < bounds.min || value > bounds.max) {
    return { ok: false, message: `Line must be between ${bounds.min} and ${bounds.max}.` };
  }
  return { ok: true, line: value };
}
