import type { EvaluatorContext, Stake, Trigger } from './types.js';
import { evaluateOpponentRostered } from './evaluators/opponentRostered.js';
import { evaluateOneScoreLate } from './evaluators/oneScoreLate.js';
import { evaluatePickTrailing2h } from './evaluators/pickTrailing2h.js';
import { evaluateRostered } from './evaluators/rostered.js';
import { evaluateSpreadSwing } from './evaluators/spreadSwing.js';
import { evaluateTotalSwing } from './evaluators/totalSwing.js';

/** Dispatches a stake to its evaluator. Nothing in the engine calls it yet. */
export function evaluateStake(stake: Stake, ctx: EvaluatorContext): Trigger[] {
  switch (stake.condition.type) {
    case 'ROSTERED':
      return evaluateRostered(stake, ctx);
    case 'OPPONENT_ROSTERED':
      return evaluateOpponentRostered(stake, ctx);
    case 'MONEYLINE':
      return evaluateOneScoreLate(stake, ctx);
    case 'SURVIVOR':
      return [...evaluateOneScoreLate(stake, ctx), ...evaluatePickTrailing2h(stake, ctx)];
    case 'SPREAD':
      return evaluateSpreadSwing(stake, ctx);
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER':
      return evaluateTotalSwing(stake, ctx);
    case 'STAT_OVER':
    case 'STAT_UNDER':
      return [];
    default: {
      const unexpected: never = stake.condition;
      return unexpected;
    }
  }
}
