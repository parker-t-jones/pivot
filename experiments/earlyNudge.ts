/**
 * EXPERIMENT (issue #6, R1) — not production code.
 *
 * Pure half of `replay-early-nudge.ts`: given a game's recorded summary snapshots, when would the
 * possession nudge go out today, and when would it go out if it fired on the possession-ending play
 * (the first play whose `end.team` names a new team)?
 *
 * "Today" is not re-derived. It drives the real `IncrementalResumptionTracker`, the real
 * `ResumptionGatedDispatcher`, and the real `applyPlayToState` in the order
 * `services/api/src/runner/playSession.ts` calls them, with a fake clock set to each play's
 * `seenAt`. The one stand-in is `onPlayEvent`: instead of real stakes, every team has one synthetic
 * user whose flag is on while that team's offense is on the field ("your RB's team has the ball").
 */

import {
  IncrementalResumptionTracker,
  RESUMPTION_CEILING_MS,
  applyPlayToState,
  classifyPlayType,
  type PlayEvent,
  type ResumptionResolution,
  type TeamId,
} from '@pivot/engine';
import {
  ResumptionGatedDispatcher,
  type FlagEventQueue,
  type GateDecision,
} from '@pivot/dispatcher';
import type { FlagEvent, GameState } from '@pivot/shared';

/** One play as it appeared in one snapshot. */
export interface SnapshotPlay {
  /** `mapEspnPlay` of this snapshot's version of the play: what the runner would see. */
  event: PlayEvent;
  /** `end.team.id` translated to the same team id space as `event`, or `null` when ESPN omitted it. */
  endTeamId: TeamId | null;
  typeText: string;
  text: string;
  /** `displayResult` of the drive the play is filed under in this snapshot. */
  driveResult: string | null;
}

export interface Snapshot {
  receivedAtMs: number;
  /**
   * The previous poll of this game was too long ago (the recorder was down), so plays first seen
   * here have an inflated `seenAt`. They count as backfill.
   */
  afterGap?: boolean;
  /** Chronological, deduplicated by play id. */
  plays: readonly SnapshotPlay[];
}

/** A play the first time it showed up: the version the runner acts on. */
export interface Arrival extends SnapshotPlay {
  index: number;
  seenAtMs: number;
  /** First seen in the game's first snapshot or right after a recorder gap: `seenAtMs` is not real. */
  backfilled: boolean;
  wallclockMs: number | null;
  /**
   * First seen more than `STALE_FEED_MS` after its wallclock although the recorder was polling: a
   * safety net for a feed or recorder stall the gap check missed. It distorts both models equally.
   */
  staleFeed: boolean;
}

export const STALE_FEED_MS = 10 * 60 * 1000;

export interface PlayHistory {
  /** Distinct consecutive `end.team` values across snapshots, first-seen first. */
  endTeams: (TeamId | null)[];
  /** The version in the last snapshot, or `null` when ESPN later deleted the play. */
  final: SnapshotPlay | null;
}

export function buildArrivals(snapshots: readonly Snapshot[]): {
  arrivals: Arrival[];
  history: Map<string, PlayHistory>;
} {
  const arrivals: Arrival[] = [];
  const history = new Map<string, PlayHistory>();
  snapshots.forEach((snapshot, snapshotIndex) => {
    for (const play of snapshot.plays) {
      const id = play.event.playId;
      const entry = history.get(id);
      if (!entry) {
        history.set(id, { endTeams: [play.endTeamId], final: null });
        const wallclockMs = play.event.wallclock ? Date.parse(play.event.wallclock) : NaN;
        arrivals.push({
          ...play,
          index: arrivals.length,
          seenAtMs: snapshot.receivedAtMs,
          backfilled: snapshotIndex === 0 || snapshot.afterGap === true,
          wallclockMs: Number.isNaN(wallclockMs) ? null : wallclockMs,
          staleFeed:
            !Number.isNaN(wallclockMs) && snapshot.receivedAtMs - wallclockMs > STALE_FEED_MS,
        });
      } else if (entry.endTeams[entry.endTeams.length - 1] !== play.endTeamId) {
        entry.endTeams.push(play.endTeamId);
      }
    }
  });
  const last = snapshots[snapshots.length - 1];
  for (const play of last?.plays ?? []) {
    const entry = history.get(play.event.playId);
    if (entry) entry.final = play;
  }
  return { arrivals, history };
}

/** A nudge under end-of-play detection. */
export interface EarlyNudge {
  team: TeamId;
  from: TeamId;
  index: number;
  seenAtMs: number;
  /** `end_team` when the play's `end.team` said so; `drive_fallback` when `end` was missing. */
  source: 'end_team' | 'drive_fallback';
}

/**
 * Walks arrivals once, tracking who has the ball after each play: `end.team` when present, else
 * the drive's team. A nudge fires on the first play that hands the ball to someone else. Procedural
 * entries (timeouts, period ends) are skipped: ESPN's team fields on them are unreliable.
 */
export function detectEarly(arrivals: readonly Arrival[]): EarlyNudge[] {
  const nudges: EarlyNudge[] = [];
  let ball: TeamId | null = null;
  for (const arrival of arrivals) {
    if (arrival.event.possessionTeamId === null) continue;
    const after = arrival.endTeamId ?? arrival.event.possessionTeamId;
    if (ball !== null && after !== ball) {
      nudges.push({
        team: after,
        from: ball,
        index: arrival.index,
        seenAtMs: arrival.seenAtMs,
        source: arrival.endTeamId === null ? 'drive_fallback' : 'end_team',
      });
    }
    ball = after;
  }
  return nudges;
}

export type WindowOutcome = ResumptionResolution['outcome'] | 'OPEN';

/** A possession change as today's tracker sees it. */
export interface PossessionWindow {
  from: TeamId;
  to: TeamId;
  precedingIndex: number;
  revealingIndex: number;
  /** The arrival whose `observe` opened the window (first play naming the new team). */
  openedIndex: number;
  outcome: WindowOutcome;
  resolvedAtMs: number | null;
}

/** A synthetic `flag_added` and what the real gate did with it. */
export interface TodayPush {
  team: TeamId;
  dispatchIndex: number;
  decision: GateDecision | 'never_released';
  /** When it would reach the queue (the dispatcher tick adds up to 500ms in both models). */
  pushAtMs: number | null;
  resolution: ResumptionResolution['outcome'] | null;
}

export interface TodayResult {
  windows: PossessionWindow[];
  pushes: TodayPush[];
}

function flagState(gameId: string, flagged: boolean, at: number): FlagEvent['newState'] {
  return { gameId, flagged, priorityScore: flagged ? 1 : 0, reasons: [], computedAt: at };
}

/** Today's pipeline over one game's arrivals. */
export async function simulateToday(
  gameId: string,
  arrivals: readonly Arrival[],
): Promise<TodayResult> {
  let now = 0;
  const enqueuedAt = new Map<string, number>();
  const queue: FlagEventQueue = {
    enqueue: async (event) => {
      enqueuedAt.set(event.id, now);
    },
    due: async () => [],
    remove: async () => undefined,
  };
  const gated = new Map<
    string,
    {
      decision: GateDecision;
      holdMs: number;
      at: number;
      resolution: ResumptionResolution['outcome'] | null;
    }
  >();
  const gate = new ResumptionGatedDispatcher({
    queue,
    clock: () => now,
    onGated: (record) => {
      gated.set(record.event.id, {
        decision: record.decision,
        holdMs: record.holdMs,
        at: now,
        resolution: record.resolution?.outcome ?? null,
      });
    },
  });

  const indexById = new Map(arrivals.map((arrival) => [arrival.event.playId, arrival.index]));
  const windows: PossessionWindow[] = [];
  let open: { window: PossessionWindow; openedAtMs: number } | null = null;
  let currentIndex = -1;
  const pending: Promise<void>[] = [];

  const tracker = new IncrementalResumptionTracker(gameId, {
    onWindowOpened: (id, opened) => {
      gate.noteWindowOpened(id);
      const window: PossessionWindow = {
        from: opened.precedingPlay.play.possessionTeamId ?? '',
        to: arrivals[currentIndex]?.event.possessionTeamId ?? '',
        precedingIndex: indexById.get(opened.precedingPlay.play.playId) ?? -1,
        revealingIndex: indexById.get(opened.revealingPlay.play.playId) ?? -1,
        openedIndex: currentIndex,
        outcome: 'OPEN',
        resolvedAtMs: null,
      };
      windows.push(window);
      open = { window, openedAtMs: opened.revealingPlay.observedAt };
    },
    onResolved: (id, resolution) => {
      if (open) {
        open.window.outcome = resolution.outcome;
        open.window.resolvedAtMs = now;
      }
      open = null;
      pending.push(gate.noteResolution(id, resolution));
    },
  });
  const flush = async (): Promise<void> => {
    await Promise.all(pending.splice(0));
  };

  let state: GameState | null = null;
  let flaggedTeam: TeamId | null = null;
  const dispatched: { id: string; team: TeamId; index: number }[] = [];

  for (const arrival of arrivals) {
    // The ResumptionCeiling silence timer, which the runner arms when a window opens.
    const stillOpen = open as { window: PossessionWindow; openedAtMs: number } | null;
    if (stillOpen && arrival.seenAtMs - stillOpen.openedAtMs >= RESUMPTION_CEILING_MS) {
      now = stillOpen.openedAtMs + RESUMPTION_CEILING_MS;
      tracker.applyWallClockCeiling(now);
      await flush();
    }

    now = arrival.seenAtMs;
    currentIndex = arrival.index;
    const play = arrival.event;
    gate.beginPlay(gameId, play.playType);
    if (classifyPlayType(play.playType) === 'REAL_ACTION') await gate.releaseMidDrive(gameId);
    tracker.observe(play, now);
    await flush();

    // Stand-in for onPlayEvent: one user per team, flagged while that team's offense is out.
    state = applyPlayToState(state, play, () => now);
    const onTeam = state.unitOnField === 'offense' ? state.possessionTeamId : null;
    if (onTeam !== flaggedTeam) {
      if (flaggedTeam !== null) {
        await gate.dispatch(
          {
            id: `${flaggedTeam}:${play.playId}:removed`,
            userId: `user-${flaggedTeam}`,
            gameId,
            type: 'flag_removed',
            oldState: flagState(gameId, true, now),
            newState: flagState(gameId, false, now),
            scheduledFireAt: now,
          },
          play.playId,
        );
      }
      if (onTeam !== null) {
        const id = `${onTeam}:${play.playId}:added`;
        dispatched.push({ id, team: onTeam, index: arrival.index });
        await gate.dispatch(
          {
            id,
            userId: `user-${onTeam}`,
            gameId,
            type: 'flag_added',
            oldState: null,
            newState: flagState(gameId, true, now),
            scheduledFireAt: now,
          },
          play.playId,
        );
      }
      flaggedTeam = onTeam;
    }
    await gate.endPlay(gameId);
    if (state.status === 'final') await gate.releaseMidDrive(gameId);
  }
  gate.stop();

  const pushes = dispatched.map(({ id, team, index }): TodayPush => {
    const record = gated.get(id);
    const at = enqueuedAt.get(id);
    if (!record) {
      return {
        team,
        dispatchIndex: index,
        decision: 'never_released',
        pushAtMs: null,
        resolution: null,
      };
    }
    let pushAtMs = at ?? null;
    // The gate's mid-drive silence timer is a real setTimeout, which this replay never waits on.
    // A hold longer than the ceiling would have been released by that timer instead.
    if (pushAtMs !== null && record.holdMs > RESUMPTION_CEILING_MS) {
      pushAtMs = pushAtMs - record.holdMs + RESUMPTION_CEILING_MS;
    }
    return {
      team,
      dispatchIndex: index,
      decision: record.decision,
      pushAtMs,
      resolution: record.resolution,
    };
  });
  return { windows, pushes };
}

export type EndingKind =
  | 'punt'
  | 'kickoff_after_score'
  | 'turnover'
  | 'turnover_on_downs'
  | 'missed_fg'
  | 'end_of_half'
  | 'return_td'
  | 'safety'
  | 'other';

/** How the possession that a window closes ended, from the preceding play's drive result. */
export function classifyEnding(
  window: PossessionWindow,
  arrivals: readonly Arrival[],
  history: ReadonlyMap<string, PlayHistory>,
): EndingKind {
  if (window.outcome === 'ABORTED') return 'end_of_half';
  for (let i = window.precedingIndex + 1; i < window.openedIndex; i++) {
    const type = arrivals[i]?.event.playType;
    if (type === 'end_half' || type === 'end_game') return 'end_of_half';
  }
  const preceding = arrivals[window.precedingIndex];
  if (!preceding) return 'other';
  const result = (history.get(preceding.event.playId)?.final ?? preceding).driveResult ?? '';
  if (/safety/i.test(result)) return 'safety';
  if (/touchdown/i.test(result) && /punt|interception|fumble|return|blocked/i.test(result)) {
    return 'return_td';
  }
  if (/^(touchdown|field goal)$/i.test(result)) return 'kickoff_after_score';
  if (/punt/i.test(result)) return 'punt';
  if (/interception|fumble/i.test(result)) return 'turnover';
  if (/downs/i.test(result)) return 'turnover_on_downs';
  if (/missed fg|blocked fg|field goal missed/i.test(result)) return 'missed_fg';
  if (/end of (half|game)/i.test(result)) return 'end_of_half';
  return 'other';
}

/** A today window, its push, and the matching end-of-play nudge. */
export interface PossessionChange {
  window: PossessionWindow;
  kind: EndingKind;
  today: TodayPush | null;
  early: EarlyNudge | null;
  /** `today.pushAtMs - early.seenAtMs`; `null` when either side never fires. */
  gainMs: number | null;
  /**
   * `seenAt` of the new team's first offensive snap minus `early.seenAtMs`: the gain against a gate
   * that always pushed on that snap (no mid-drive hold). `null` when either side is missing.
   */
  gainVsFirstSnapMs: number | null;
  /** ESPN wallclock of the play the early nudge fires on (else the preceding play). */
  endingWallclockMs: number | null;
  /** Any play from the preceding play through the push play is backfill. */
  backfilled: boolean;
  /** Any play in that range is a `staleFeed` arrival. */
  stale: boolean;
  /** Final `displayResult` of the preceding play's drive (e.g. `Touchdown`, `Punt`). */
  precedingResult: string | null;
}

export function pairChanges(
  arrivals: readonly Arrival[],
  history: ReadonlyMap<string, PlayHistory>,
  today: TodayResult,
  early: readonly EarlyNudge[],
): { changes: PossessionChange[]; unmatchedEarly: EarlyNudge[] } {
  const used = new Set<EarlyNudge>();
  const changes = today.windows.map((window, i): PossessionChange => {
    const nextOpened = today.windows[i + 1]?.openedIndex ?? Number.POSITIVE_INFINITY;
    const push =
      window.outcome === 'ABORTED'
        ? null
        : (today.pushes.find(
            (p) =>
              p.team === window.to &&
              p.dispatchIndex >= window.openedIndex &&
              p.dispatchIndex < nextOpened,
          ) ?? null);
    const lastIndex = push?.dispatchIndex ?? window.openedIndex;
    const nudge =
      early.find(
        (n) =>
          !used.has(n) &&
          n.team === window.to &&
          n.index >= window.precedingIndex &&
          n.index <= lastIndex,
      ) ?? null;
    if (nudge) used.add(nudge);
    const endingIndex = nudge?.index ?? window.precedingIndex;
    const span = arrivals.slice(Math.max(0, window.precedingIndex), lastIndex + 1);
    const backfilled = span.some((arrival) => arrival.backfilled);
    const stale = span.some((arrival) => arrival.staleFeed);
    const preceding = arrivals[window.precedingIndex];
    return {
      window,
      kind: classifyEnding(window, arrivals, history),
      precedingResult: preceding
        ? ((history.get(preceding.event.playId)?.final ?? preceding).driveResult ?? null)
        : null,
      today: push,
      early: nudge,
      gainMs: push?.pushAtMs != null && nudge ? push.pushAtMs - nudge.seenAtMs : null,
      gainVsFirstSnapMs:
        push && nudge
          ? (arrivals[push.dispatchIndex]?.seenAtMs ?? nudge.seenAtMs) - nudge.seenAtMs
          : null,
      endingWallclockMs: arrivals[endingIndex]?.wallclockMs ?? null,
      backfilled,
      stale,
    };
  });
  return { changes, unmatchedEarly: early.filter((n) => !used.has(n)) };
}

/** Linear-interpolated percentile, `p` in [0, 1]. `null` for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** One scoreboard poll's view of one game. */
export interface ScoreboardSample {
  atMs: number;
  gameId: string;
  lastPlayId: string | null;
  possession: TeamId | null;
}

export interface ScoreboardComparison {
  sample: ScoreboardSample;
  /**
   * `summarySeenAt(lastPlay) - sample.atMs`. Positive: the scoreboard showed the play before any
   * summary did. `null` when the summary never carried that play id.
   */
  leadMs: number | null;
  /**
   * How long the summary had already shown a later play than the scoreboard's `lastPlay`
   * (`sample.atMs - seenAt(next play)`). `null` when the scoreboard was current or ahead.
   */
  staleMs: number | null;
  /** Who the summary said had the ball at `atMs` (after its latest play), for the same game. */
  summaryBall: TeamId | null;
}

/** Compares each scoreboard poll to what the summary stream had at that moment. */
export function compareScoreboard(
  samples: readonly ScoreboardSample[],
  arrivalsByGame: ReadonlyMap<string, readonly Arrival[]>,
): ScoreboardComparison[] {
  return samples.map((sample) => {
    const arrivals = arrivalsByGame.get(sample.gameId) ?? [];
    const lastPlay = arrivals.find((a) => a.event.playId === sample.lastPlayId);
    const next = lastPlay ? arrivals[lastPlay.index + 1] : undefined;
    let summaryBall: TeamId | null = null;
    for (const arrival of arrivals) {
      if (arrival.seenAtMs > sample.atMs) break;
      if (arrival.event.possessionTeamId === null) continue;
      summaryBall = arrival.endTeamId ?? arrival.event.possessionTeamId;
    }
    return {
      sample,
      leadMs: lastPlay ? lastPlay.seenAtMs - sample.atMs : null,
      staleMs: next && next.seenAtMs <= sample.atMs ? sample.atMs - next.seenAtMs : null,
      summaryBall,
    };
  });
}
