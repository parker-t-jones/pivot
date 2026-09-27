function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `IncrementalResumptionTracker` calls `onResolved` without awaiting it.
 * `noteResolution` returns a promise. Attach the catch here so a rejected enqueue is logged
 * and does not reject the play handler.
 */
export function observeResolution(
  gameId: string,
  pending: Promise<void>,
  log: (line: string) => void = console.error,
): void {
  pending.catch((error: unknown) => {
    log(`[runner] noteResolution failed ${gameId}: ${failureReason(error)}`);
  });
}
