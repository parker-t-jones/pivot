type Listener = () => void;

const listeners = new Set<Listener>();
let pending = false;

/** Home refetches `GET /games` for the current week. If Home is not mounted, the next focus does. */
export function requestWeekGamesRefresh(): void {
  if (listeners.size === 0) {
    pending = true;
    return;
  }
  pending = false;
  for (const listener of listeners) listener();
}

export function subscribeWeekGamesRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True once, when a refresh was requested while nothing was listening. */
export function takePendingWeekGamesRefresh(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}
