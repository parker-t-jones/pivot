/**
 * Desktop Watchlist removal. The row hides immediately. The DELETE waits until
 * the undo window ends, the user leaves, or another row is removed. Undo never
 * deletes. A failed DELETE puts the row back.
 */
export const STAKE_UNDO_MS = 5000;

export interface DeferredRemoval {
  /** Row waiting on the undo toast. */
  pendingId: string | null;
  /** Rows hidden from the table, including the pending one and any commit in flight. */
  hiddenIds: readonly string[];
}

export const EMPTY_REMOVAL: DeferredRemoval = { pendingId: null, hiddenIds: [] };

export interface RemovalStep {
  state: DeferredRemoval;
  /** Previous pending row that must be deleted now. */
  commitId: string | null;
}

export function beginRemoval(state: DeferredRemoval, id: string): RemovalStep {
  const commitId = state.pendingId != null && state.pendingId !== id ? state.pendingId : null;
  const hiddenIds = state.hiddenIds.filter((hidden) => hidden !== id);
  return {
    state: { pendingId: id, hiddenIds: [...hiddenIds, id] },
    commitId,
  };
}

/** Drops the pending row out of the hidden set and cancels its delete. */
export function undoRemoval(state: DeferredRemoval): RemovalStep {
  if (state.pendingId == null) return { state, commitId: null };
  const pendingId = state.pendingId;
  return {
    state: {
      pendingId: null,
      hiddenIds: state.hiddenIds.filter((hidden) => hidden !== pendingId),
    },
    commitId: null,
  };
}

/** Toast expired, navigation, or tab close. The pending delete should be sent. */
export function expireRemoval(state: DeferredRemoval): RemovalStep {
  return {
    state: { ...state, pendingId: null },
    commitId: state.pendingId,
  };
}

/** The DELETE failed. The row comes back. */
export function failRemoval(state: DeferredRemoval, id: string): DeferredRemoval {
  return {
    pendingId: state.pendingId === id ? null : state.pendingId,
    hiddenIds: state.hiddenIds.filter((hidden) => hidden !== id),
  };
}
