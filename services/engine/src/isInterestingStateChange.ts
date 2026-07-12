import type { GameState } from '@fantasy-focus/shared';

/**
 * Pure filter (PLAN.md Section 8 "Interesting state change filter"): true when a state transition
 * could plausibly change any user's flag. Deliberately ignores `timeRemainingSec`/`updatedAt` — the
 * clock ticking on every play never changes a flag, so recomputing on it would be pure noise.
 */
export function isInterestingStateChange(old: GameState | null, neu: GameState): boolean {
  if (!old) return true;
  return (
    old.possessionTeamId !== neu.possessionTeamId ||
    old.unitOnField !== neu.unitOnField ||
    old.inRedZone !== neu.inRedZone ||
    old.scoreHome !== neu.scoreHome ||
    old.scoreAway !== neu.scoreAway ||
    old.quarter !== neu.quarter ||
    old.status !== neu.status
  );
}
