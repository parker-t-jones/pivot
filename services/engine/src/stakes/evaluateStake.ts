import type { EvaluatorContext, Stake, Trigger } from './types.js';
import { evaluateOpponentRostered } from './evaluators/opponentRostered.js';
import { evaluateOneScoreLate } from './evaluators/oneScoreLate.js';
import { evaluatePickTrailing2h } from './evaluators/pickTrailing2h.js';
import { evaluatePlayerProp } from './evaluators/playerProp.js';
import { evaluateRostered } from './evaluators/rostered.js';
import { evaluateSpreadSwing } from './evaluators/spreadSwing.js';
import { evaluateTeamProp } from './evaluators/teamProp.js';
import { evaluateTotalSwing } from './evaluators/totalSwing.js';

/** Dispatches a stake to its evaluator. The runner's bet pass calls it for every bet on a play. */
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
    case 'PLAYER_EVENT':
      return evaluatePlayerProp(stake, ctx);
    case 'TEAM_TOTAL_OVER':
    case 'TEAM_TOTAL_UNDER':
    case 'FIRST_TO_SCORE':
      return evaluateTeamProp(stake, ctx);
    case 'FG_OVER':
    case 'FG_UNDER':
      // A game-wide FG total has no activity rule: it is tracked in-app only.
      return stake.subject.type === 'TEAM' ? evaluateTeamProp(stake, ctx) : [];
    default: {
      const unexpected: never = stake.condition;
      return unexpected;
    }
  }
}
