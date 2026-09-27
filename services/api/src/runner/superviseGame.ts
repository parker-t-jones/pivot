/** Same curve as an ESPN poll failure in `followGame`: 10s, 20s, 40s, then 60s. */
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 60_000;

export function supervisorBackoffMs(consecutiveFailures: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** consecutiveFailures);
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

/**
 * One game. A throw is logged and that game restarts with backoff.
 * A clean return (final, disconnect, or lost lock) is not a failure.
 */
export async function superviseGame(deps: {
  eventId: string;
  signal: AbortSignal;
  run: () => Promise<void>;
  log?: (line: string) => void;
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const log = deps.log ?? console.error;
  const wait = deps.delay ?? delay;
  let failures = 0;
  while (!deps.signal.aborted) {
    try {
      await deps.run();
      return;
    } catch (error) {
      if (deps.signal.aborted) return;
      failures += 1;
      log(`[runner] game loop failed ${deps.eventId}: ${failureReason(error)}`);
      await wait(supervisorBackoffMs(failures), deps.signal);
    }
  }
}
