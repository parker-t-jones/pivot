/**
 * Pick conditions, progress, and parsed ESPN stats (docs/P2-PICKS-MODEL.md). The engine's
 * `stakes/types.ts` re-exports these, so this file is the single source for the shapes stored in
 * `stakes.condition`.
 */

/** Player stat a STAT_OVER / STAT_UNDER line is on. */
export type StatKey =
  | 'PASS_YDS'
  | 'PASS_COMP'
  | 'PASS_ATT'
  | 'PASS_TD'
  | 'INT_THROWN'
  | 'RUSH_YDS'
  | 'RUSH_ATT'
  | 'RUSH_REC_YDS'
  | 'REC_YDS'
  | 'RECEPTIONS'
  | 'ANY_TD'
  | 'FG_MADE'
  | 'KICK_PTS';

export const STAT_KEYS: readonly StatKey[] = [
  'PASS_YDS',
  'PASS_COMP',
  'PASS_ATT',
  'PASS_TD',
  'INT_THROWN',
  'RUSH_YDS',
  'RUSH_ATT',
  'RUSH_REC_YDS',
  'REC_YDS',
  'RECEPTIONS',
  'ANY_TD',
  'FG_MADE',
  'KICK_PTS',
];

/** Part of a game a line covers. No segment = full game including OT. Q4 excludes OT; H2 includes it. */
export type Segment = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2';

export const SEGMENTS: readonly Segment[] = ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2'];

export type PlayerEvent = 'ANY_TD' | 'FIRST_TD';

export type StakeCondition =
  | { type: 'ROSTERED' } // fantasy: any involvement matters
  | { type: 'OPPONENT_ROSTERED' } // fantasy: watch to worry
  | { type: 'STAT_OVER'; stat: StatKey; line: number } // player props
  | { type: 'STAT_UNDER'; stat: StatKey; line: number }
  | { type: 'PLAYER_EVENT'; event: PlayerEvent; side: 'YES' | 'NO' }
  | { type: 'MONEYLINE'; side: 'TEAM' }
  | { type: 'SPREAD'; line: number; segment?: Segment } // from subject team's perspective
  | { type: 'TOTAL_OVER'; line: number; segment?: Segment }
  | { type: 'TOTAL_UNDER'; line: number; segment?: Segment }
  | { type: 'TEAM_TOTAL_OVER'; line: number; segment?: Segment }
  | { type: 'TEAM_TOTAL_UNDER'; line: number; segment?: Segment }
  | { type: 'FIRST_TO_SCORE' }
  | { type: 'FG_OVER'; line: number; segment?: Segment } // GAME subject = both teams
  | { type: 'FG_UNDER'; line: number; segment?: Segment }
  | { type: 'SURVIVOR' };

export type StakeConditionType = StakeCondition['type'];

/** Inclusive line range per stat. Lines are multiples of 0.5. */
export const STAT_LINE_RANGE: Record<StatKey, { min: number; max: number }> = {
  PASS_YDS: { min: 0.5, max: 650 },
  PASS_COMP: { min: 0.5, max: 60 },
  PASS_ATT: { min: 0.5, max: 80 },
  PASS_TD: { min: 0.5, max: 8 },
  INT_THROWN: { min: 0.5, max: 8 },
  RUSH_YDS: { min: 0.5, max: 400 },
  RUSH_ATT: { min: 0.5, max: 50 },
  RUSH_REC_YDS: { min: 0.5, max: 600 },
  REC_YDS: { min: 0.5, max: 400 },
  RECEPTIONS: { min: 0.5, max: 25 },
  ANY_TD: { min: 0.5, max: 6 },
  FG_MADE: { min: 0.5, max: 10 },
  KICK_PTS: { min: 0.5, max: 30 },
};

/**
 * How far one good play moves the stat (PIVOT-STAKES-PLAN §3: rush 15, rec 25, rush + rec 20, pass 40). Counts
 * move by one. Used for "near" and for leverage.
 */
export const STAT_BIG_PLAY: Record<StatKey, number> = {
  PASS_YDS: 40,
  PASS_COMP: 1,
  PASS_ATT: 1,
  PASS_TD: 1,
  INT_THROWN: 1,
  RUSH_YDS: 15,
  RUSH_ATT: 1,
  RUSH_REC_YDS: 20,
  REC_YDS: 25,
  RECEPTIONS: 1,
  ANY_TD: 1,
  FG_MADE: 1,
  KICK_PTS: 3,
};

/**
 * `pending`: not started or no stats yet. `live`: undecided. `hit` / `missed`: decided during
 * play. `won` / `lost` / `tie`: final. `void`: the player did not play ("refunded" in copy).
 * `unavailable`: no ESPN match for the player.
 */
export type PickStatus =
  | 'pending'
  | 'live'
  | 'hit'
  | 'missed'
  | 'won'
  | 'lost'
  | 'tie'
  | 'void'
  | 'unavailable';

export interface PickProgress {
  status: PickStatus;
  /** Current value of the tracked number (stat, points, FGs, margin). */
  current?: number;
  line?: number;
  /** Still needed to clear an over, or room left under an under. Never negative. */
  needed?: number;
}

export type SettledResult = 'won' | 'lost' | 'tie' | 'void';

export interface SlipSummary {
  status: 'pending' | 'live' | 'won' | 'lost' | 'void';
  legs: number;
  /** Legs won or decided in the pick's favor during play. */
  hit: number;
  /** Legs not decided yet. */
  alive: number;
  lost: number;
  /** Tie and void legs. They drop out of the slip. */
  refunded: number;
}

export type ScoringPlayKind = 'TD' | 'FG' | 'OTHER';

export interface ParsedScoringPlay {
  /** `teams.id`, or the ESPN abbreviation when no team row matched. */
  teamId: string;
  period: number;
  kind: ScoringPlayKind;
  text: string;
}

export interface ParsedPlayerLine {
  /** `teams.id`, or the ESPN abbreviation when no team row matched. */
  teamId: string;
  displayName: string;
  stats: Partial<Record<StatKey, number>>;
}

/** One ESPN summary poll, parsed. Written to Redis `game_player_stats:{gameId}` by the runner. */
export interface GamePlayerStats {
  gameId: string;
  fetchedAt: number;
  final: boolean;
  /** Keyed by ESPN athlete id. */
  players: Record<string, ParsedPlayerLine>;
  /** Points per period: index 0 is Q1, 4 and later are OT. */
  linescores: { home: number[]; away: number[] };
  /** In game order. */
  scoringPlays: ParsedScoringPlay[];
}
