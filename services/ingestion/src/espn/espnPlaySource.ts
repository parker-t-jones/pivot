import type { PlayEvent, PlaySource } from '@pivot/engine';
import { NoOpErrorReporter, type ErrorReporter } from '@pivot/shared';
import { espnClient, type EspnClient } from './espnClient.js';
import { reportShapeFailure, ShapeFailureReportThrottle } from './errors.js';
import { mapEspnPlay, resolveGameContext, type EspnGameContext } from './mapEspnPlay.js';
import type { EspnDrive, EspnPlay, EspnSummary } from './espnTypes.js';

const DEFAULT_POLL_INTERVAL_MS = 5000;
/** First failed poll waits 10s (`5s * 2^1`), then 20s, 40s, then the cap. */
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 60_000;

function backoffMs(consecutiveFailures: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** consecutiveFailures);
}

export interface EspnPlaySourceOptions {
  /** ESPN's event id for the game to poll (e.g. `'401873308'`). Resolving our own `gameId` to this
   *  is deliberately out of scope here — see the ESPN adapter decoupling plan's "Team and game ID
   *  resolution" section; a future caller supplies it, the same way `ReplayPlaySourceOptions.gameId`
   *  is supplied rather than looked up. */
  eventId: string;
  /** Default 5s, matching the probe this polling loop is lifted from. */
  pollIntervalMs?: number;
  /** Default `NoOpErrorReporter` — boots without Sentry configured, mirroring
   *  `createPushNotifier`'s `NoOpPushNotifier` default when no push driver is set. */
  errorReporter?: ErrorReporter;
  /** Injectable for tests; defaults to the real `espnClient` hitting ESPN's live API. */
  client?: Pick<EspnClient, 'getSummary'>;
  /** Injectable for tests; defaults to a fresh throttle owned by this instance, so Sentry-report
   *  throttling persists across polls for this game but starts clean for each new instance. */
  shapeFailureThrottle?: ShapeFailureReportThrottle;
}

function isFinal(summary: EspnSummary): boolean {
  const statusType = summary.header?.competitions?.[0]?.status?.type;
  return Boolean(statusType?.completed) || statusType?.state === 'post';
}

/** A play plus the drive it came from — `mapEspnPlay` needs the drive for possession. */
interface FlattenedPlay {
  play: EspnPlay;
  drive: EspnDrive;
}

/** Flattens completed drives + the in-progress drive into one chronological play list, lifted from
 *  `experiments/espn-latency-probe.ts`'s `flattenPlays`. */
function flattenPlays(summary: EspnSummary): FlattenedPlay[] {
  const flattened: FlattenedPlay[] = [];
  for (const drive of summary.drives?.previous ?? []) {
    for (const play of drive.plays ?? []) {
      flattened.push({ play, drive });
    }
  }
  const current = summary.drives?.current;
  if (current) {
    for (const play of current.plays ?? []) {
      flattened.push({ play, drive: current });
    }
  }
  return flattened;
}

/**
 * The production `PlaySource` (PLAN.md Section 2's swap-ready boundary). Polls ESPN's summary
 * endpoint on an interval, dedupes by play id, and emits normalized `PlayEvent`s in order — the
 * polling and dedupe logic is the probe's `pollGame`, lifted with its `console.error`-and-retry
 * handling for a bad poll preserved; the ESPN-specific parsing/mapping it did inline now lives in
 * `mapEspnPlay`/`resolveGameContext` behind `espnClient`'s validated boundary.
 */
export class EspnPlaySource implements PlaySource {
  readonly id = 'espn' as const;
  private disconnected = false;
  private readonly pollIntervalMs: number;
  private readonly errorReporter: ErrorReporter;
  private readonly client: Pick<EspnClient, 'getSummary'>;
  private readonly shapeFailureThrottle: ShapeFailureReportThrottle;
  private consecutiveFailures = 0;

  constructor(private readonly options: EspnPlaySourceOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.errorReporter = options.errorReporter ?? new NoOpErrorReporter();
    this.client = options.client ?? espnClient;
    this.shapeFailureThrottle = options.shapeFailureThrottle ?? new ShapeFailureReportThrottle();
  }

  async subscribe(handler: (play: PlayEvent) => Promise<void>): Promise<void> {
    const seenPlayIds = new Set<string>();
    let context: EspnGameContext | null = null;

    while (!this.disconnected) {
      const result = await this.client.getSummary(this.options.eventId);

      if (!result.ok) {
        if (result.kind === 'invalid_shape') {
          reportShapeFailure(
            this.errorReporter,
            {
              eventId: this.options.eventId,
              signature: 'shape-mismatch:getSummary',
              reason: result.reason,
              issues: result.issues,
            },
            this.shapeFailureThrottle,
          );
        } else {
          console.error(`[espn-ingestion] ${result.reason}, retrying...`);
        }
        await this.sleepAfterFailure();
        continue;
      }

      const summary = result.data;

      if (context === null) {
        context = resolveGameContext(summary, this.options.eventId);
        if (context === null) {
          reportShapeFailure(
            this.errorReporter,
            {
              eventId: this.options.eventId,
              signature: 'missing-team-context',
              reason: 'summary header did not identify both competing teams',
            },
            this.shapeFailureThrottle,
          );
          await this.sleepAfterFailure();
          continue;
        }
      }

      this.consecutiveFailures = 0;

      const gameIsFinal = isFinal(summary);
      const flattened = flattenPlays(summary);
      const lastIndex = flattened.length - 1;

      for (const [i, { play, drive }] of flattened.entries()) {
        if (this.disconnected) return;
        if (seenPlayIds.has(play.id)) continue;
        seenPlayIds.add(play.id);

        const isFinalPlay = gameIsFinal && i === lastIndex;
        await handler(mapEspnPlay(play, drive, context, isFinalPlay));
      }

      if (gameIsFinal) return;
      if (this.disconnected) return;
      await this.sleep();
    }
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }

  private sleep(): Promise<void> {
    return this.delay(this.pollIntervalMs);
  }

  private sleepAfterFailure(): Promise<void> {
    this.consecutiveFailures += 1;
    return this.delay(backoffMs(this.consecutiveFailures));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
