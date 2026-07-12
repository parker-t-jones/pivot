import type { FlagEvent } from '@fantasy-focus/shared';
import type { Action } from './types.js';

/**
 * Minimal structural inputs `decideAction` needs (Section 8's `user: User, session: ViewingSession`
 * narrowed to just the fields the formula reads) — the full `users`/`viewing_sessions` row shapes
 * don't exist as dispatcher-side types yet (`viewing_sessions` has no migration until Phase 6), so
 * this stays structural rather than importing a not-yet-real row type (same pattern as the engine's
 * `LineupCacheReader`).
 */
export interface DecideActionUser {
  subscriptionTier: 'free' | 'pro';
  autoSwitch: boolean;
}

export interface DecideActionSession {
  primaryGameId: string | null;
  primaryPriorityScore: number | null;
}

/**
 * PLAN.md Section 8 `decideAction` — verbatim formula. Pure and I/O-free by design (sprint decision
 * #7): `delivery.ts` is responsible for enriching the returned `{type, cta}` with
 * `recommendedSource`/`deepLinkUrl` before publishing.
 */
export function decideAction(
  user: DecideActionUser,
  session: DecideActionSession,
  event: FlagEvent,
): Action {
  const currentPrimaryPriority =
    session.primaryGameId === event.gameId ? Infinity : (session.primaryPriorityScore ?? 0);

  if (event.type === 'flag_removed') {
    return { type: 'notify_only', cta: 'dismiss' };
  }

  if (currentPrimaryPriority === Infinity) {
    return { type: 'in_app_indicator', cta: null };
  }

  if (event.newState.priorityScore > currentPrimaryPriority) {
    if (user.autoSwitch) {
      return { type: 'auto_switch', cta: null };
    }
    return { type: 'prompt', cta: 'switch_primary' };
  }

  if (user.subscriptionTier === 'pro') {
    return { type: 'prompt', cta: 'add_to_split' };
  }
  return { type: 'prompt_low_priority', cta: 'switch_primary' };
}
