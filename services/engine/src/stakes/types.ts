import type { GameState, UserLineupCache } from '@pivot/shared';

export type StakeSource =
  | 'SLEEPER_ROSTER'
  | 'SLEEPER_OPPONENT'
  | 'MANUAL'
  | 'KALSHI_MARKET'
  | 'SHARED_LIST';

export type StakeSubject =
  | { type: 'PLAYER'; playerId: string; teamId: string }
  | { type: 'TEAM'; teamId: string }
  | { type: 'GAME'; gameId: string };

export type StakeCondition =
  | { type: 'ROSTERED' } // fantasy: any involvement matters
  | { type: 'OPPONENT_ROSTERED' } // fantasy: watch to worry
  | { type: 'STAT_OVER'; stat: StatKey; line: number } // props, pick'em
  | { type: 'STAT_UNDER'; stat: StatKey; line: number }
  | { type: 'MONEYLINE'; side: 'TEAM' }
  | { type: 'SPREAD'; line: number } // from subject team's perspective
  | { type: 'TOTAL_OVER'; line: number }
  | { type: 'TOTAL_UNDER'; line: number }
  | { type: 'SURVIVOR' };

export type StatKey =
  | 'RUSH_YDS'
  | 'REC_YDS'
  | 'PASS_YDS'
  | 'RECEPTIONS'
  | 'RUSH_ATT'
  | 'PASS_TD'
  | 'ANY_TD';

export interface Stake {
  id: string;
  userId: string;
  season: number;
  week: number;
  gameId: string; // resolved at creation
  subject: StakeSubject;
  condition: StakeCondition;
  source: StakeSource;
  sourceRef?: string; // e.g. Kalshi ticker, Sleeper league id
  weight: number; // user-adjustable importance, default 1
  createdAt: string;
}

export type TriggerCode =
  | 'POSSESSION_START'
  | 'RED_ZONE'
  | 'OPP_RED_ZONE'
  | 'PROP_NEAR'
  | 'PROP_DANGER'
  | 'PROP_LIVE_POSSESSION'
  | 'ONE_SCORE_LATE'
  | 'PICK_TRAILING_2H'
  | 'SPREAD_SWING'
  | 'TOTAL_SWING'
  | 'GAME_FINAL';

export type TriggerKind = 'NUDGE' | 'REVEAL';

export interface Trigger {
  stakeId: string;
  gameId: string;
  code: TriggerCode;
  kind: TriggerKind;
  leverage: number;
  dedupeKey: string;
}

/** Plan §3. Nudges can fire immediately; reveals wait for reveal timing. */
export const TRIGGER_KIND: Record<TriggerCode, TriggerKind> = {
  POSSESSION_START: 'NUDGE',
  RED_ZONE: 'NUDGE',
  OPP_RED_ZONE: 'NUDGE',
  PROP_NEAR: 'REVEAL',
  PROP_DANGER: 'REVEAL',
  PROP_LIVE_POSSESSION: 'NUDGE',
  ONE_SCORE_LATE: 'REVEAL',
  PICK_TRAILING_2H: 'REVEAL',
  SPREAD_SWING: 'REVEAL',
  TOTAL_SWING: 'REVEAL',
  GAME_FINAL: 'REVEAL',
};

export interface EvaluatorContext {
  gameId: string;
  game: GameState;
  lineup: UserLineupCache;
  /** Opponent starters, same shape as `lineup`. Built in S2c. Absent until then. */
  opponent?: UserLineupCache;
  playerStats?: unknown; // reserved for S4
}

export type StakeEvaluator = (stake: Stake, ctx: EvaluatorContext) => Trigger[];
