import {
  beginRemoval,
  EMPTY_REMOVAL,
  expireRemoval,
  failRemoval,
  STAKE_UNDO_MS,
  undoRemoval,
  type DeferredRemoval,
} from './deferredStakeRemoval';

/**
 * Desktop undo state. It lives outside the watchlist table so hiding a row
 * cannot unmount the toast, and a table remount cannot send the DELETE.
 * The lineup screen flushes this on navigation away and on tab close.
 */
export interface StakeUndoState extends DeferredRemoval {
  error: string | null;
}

const EMPTY: StakeUndoState = { ...EMPTY_REMOVAL, error: null };

let state: StakeUndoState = EMPTY;
let commitFn: ((id: string) => Promise<void> | void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let errorTimer: ReturnType<typeof setTimeout> | null = null;
const sent = new Set<string>();
const listeners = new Set<() => void>();

function emit(next: StakeUndoState): void {
  state = next;
  for (const listener of listeners) listener();
}

function clearTimer(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
}

function clearErrorTimer(): void {
  if (errorTimer != null) clearTimeout(errorTimer);
  errorTimer = null;
}

function armTimer(): void {
  clearTimer();
  const pendingId = state.pendingId;
  if (pendingId == null) return;
  timer = setTimeout(() => {
    timer = null;
    const step = expireRemoval(state);
    emit({ ...step.state, error: state.error });
    if (step.commitId) send(step.commitId);
  }, STAKE_UNDO_MS);
}

function send(id: string): void {
  if (sent.has(id)) return;
  const commit = commitFn;
  if (!commit) return;
  sent.add(id);
  void Promise.resolve(commit(id)).catch(() => {
    sent.delete(id);
    emit({ ...failRemoval(state, id), error: 'Could not remove that bet.' });
    clearErrorTimer();
    errorTimer = setTimeout(() => {
      errorTimer = null;
      if (state.error != null) emit({ ...state, error: null });
    }, STAKE_UNDO_MS);
  });
}

export function subscribeStakeUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStakeUndoState(): StakeUndoState {
  return state;
}

/** The watchlist table points this at the lineup screen's DELETE. The table only hides the row. */
export function bindStakeUndoCommit(commit: (id: string) => Promise<void> | void): void {
  commitFn = commit;
}

export function hideStake(id: string): void {
  clearErrorTimer();
  const step = beginRemoval(state, id);
  emit({ ...step.state, error: null });
  if (step.commitId) send(step.commitId);
  armTimer();
}

export function undoStake(): void {
  const step = undoRemoval(state);
  emit({ ...step.state, error: null });
  armTimer();
}

/** Navigation away from Watchlist. Tab close uses {@link takePendingStakeUndo}. */
export function flushStakeUndo(): void {
  const step = expireRemoval(state);
  emit({ ...step.state, error: state.error });
  clearTimer();
  if (step.commitId) send(step.commitId);
}

/**
 * Hand the pending id to a keepalive DELETE and forget it here, so the
 * in-flight `fetch` from `flushStakeUndo` is not also started on `beforeunload`.
 */
export function takePendingStakeUndo(): string | null {
  const id = state.pendingId;
  if (id == null || sent.has(id)) return null;
  sent.add(id);
  clearTimer();
  emit({ ...state, pendingId: null });
  return id;
}

export function resetStakeUndoForTests(): void {
  clearTimer();
  clearErrorTimer();
  state = EMPTY;
  commitFn = null;
  sent.clear();
  listeners.clear();
}
