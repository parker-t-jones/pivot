/** A Switch primary lasts until the game is final, or this long after it was set. */
export const PRIMARY_WATCH_MS = 4 * 60 * 60 * 1000;

/**
 * `last_updated_at` at `PUT /session/primary` is the set time. A later read treats the primary as
 * gone when the game is final or this window has elapsed, whichever comes first.
 */
export function primaryWatchExpired(input: {
  setAtIso: string;
  gameStatus: string | null;
  nowMs: number;
}): boolean {
  if (input.gameStatus === 'final') return true;
  const setAt = Date.parse(input.setAtIso);
  if (Number.isNaN(setAt)) return true;
  return input.nowMs - setAt >= PRIMARY_WATCH_MS;
}

export interface ResolvedPrimary {
  primaryGameId: string | null;
  primaryPriorityScore: number | null;
  /** True when a stored primary was dropped and `clear` ran. */
  expired: boolean;
}

/**
 * The read used by `GET /session` and by the dispatcher's viewing-session lookup (the push skip).
 * An expired primary is cleared in the same read so nothing has to sweep the table.
 */
export async function resolvePrimaryWatch(input: {
  userId: string;
  primaryGameId: string | null;
  primaryPriorityScore: number | null;
  setAtIso: string;
  nowMs: number;
  gameStatus: (gameId: string) => Promise<string | null>;
  /**
   * Clears only the row that was read: `user_id`, `primary_game_id`, and `last_updated_at`
   * together. A Switch that already replaced that primary must not match.
   */
  clear: (row: { userId: string; primaryGameId: string; setAtIso: string }) => Promise<void>;
}): Promise<ResolvedPrimary> {
  if (input.primaryGameId === null) {
    return {
      primaryGameId: null,
      primaryPriorityScore: input.primaryPriorityScore,
      expired: false,
    };
  }
  const status = await input.gameStatus(input.primaryGameId);
  if (
    !primaryWatchExpired({
      setAtIso: input.setAtIso,
      gameStatus: status,
      nowMs: input.nowMs,
    })
  ) {
    return {
      primaryGameId: input.primaryGameId,
      primaryPriorityScore: input.primaryPriorityScore,
      expired: false,
    };
  }
  await input.clear({
    userId: input.userId,
    primaryGameId: input.primaryGameId,
    setAtIso: input.setAtIso,
  });
  return { primaryGameId: null, primaryPriorityScore: null, expired: true };
}
