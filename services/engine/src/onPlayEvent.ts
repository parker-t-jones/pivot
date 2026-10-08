import type { FlagEvent, GameState, UserLineupCache } from '@pivot/shared';
import { defaultClock, type Clock } from './clock.js';
import { applyPlayToState } from './applyPlayToState.js';
import { computeFlagState } from './computeFlagState.js';
import { diffFlagStates } from './diffFlagStates.js';
import { isInterestingStateChange } from './isInterestingStateChange.js';
import type { EventDispatcher } from './eventDispatcher.js';
import type { GameStateProvider } from './gameStateProvider.js';
import type { PlayEvent } from './playEvent.js';

/**
 * The slice of Sprint 3's `LineupCacheProvider` the engine needs (just the reader). Declared here,
 * structurally, rather than importing `@pivot/api` so the engine doesn't depend on the API
 * package (and so Sprint 3 code is untouched). Both `InMemoryLineupCache` and `RedisLineupCache`
 * satisfy it; production wiring (Sprint 5) passes the real provider (decision: structural reuse).
 */
export interface LineupCacheReader {
  getLineupCache(userId: string, week: number): Promise<UserLineupCache | null>;
}

export interface OnPlayEventDeps {
  lineupCache: LineupCacheReader;
  gameState: GameStateProvider;
  dispatcher: EventDispatcher;
  clock?: Clock;
}

/** Copies poll timing onto the event when the play has it. Absent fields stay absent. */
function withPlayTiming(event: FlagEvent, play: PlayEvent): FlagEvent {
  if (play.wallclock === undefined && play.seenAt === undefined) return event;
  return {
    ...event,
    ...(play.wallclock !== undefined ? { playWallclock: play.wallclock } : {}),
    ...(play.seenAt !== undefined ? { seenAt: play.seenAt } : {}),
  };
}

/** Users whose lineup includes either team. Decision 8: a backgrounded user is still a candidate. */
async function getUsersWithStakeIn(
  gameState: GameStateProvider,
  state: GameState,
): Promise<string[]> {
  const [homeStakes, awayStakes] = await Promise.all([
    gameState.getUsersWithStakeIn(state.homeTeamId),
    gameState.getUsersWithStakeIn(state.awayTeamId),
  ]);
  return [...new Set([...homeStakes, ...awayStakes])];
}

/**
 * Engine entry point (PLAN.md Section 8 "Play event handler"). Not pure — it reads/writes game &
 * flag state through injected providers and emits flag events to the dispatcher. Orchestrates the
 * pure functions (`applyPlayToState`, `isInterestingStateChange`, `computeFlagState`,
 * `diffFlagStates`).
 *
 * Deviations from Section 8's snippet, all in scope for Sprint 4:
 * - `redis` → injected `GameStateProvider` (Redis impl deferred to Sprint 5).
 * - `redis.getLineupCache` → injected `LineupCacheReader` (Sprint 3).
 * - `scheduleFlagEvent(event, state)` (deferred stream-lag queue) → `dispatcher.dispatch(event)`
 *   (Sprint 5 builds the deferred queue + rate limiting).
 * - `currentWeek()` → `play.week` (week is play metadata, not game state — decision #5).
 *
 * User flag state is only persisted when a diff produces an event. A priority-only drift inside
 * ±3, including bonus reasons, is measured against the last *evented* state. A change of side
 * (`offense_active` / `defense_active`) or of the players on that side is always an event, so
 * that stored state does not keep the previous side of the ball.
 */
export async function onPlayEvent(deps: OnPlayEventDeps, play: PlayEvent): Promise<void> {
  const clock = deps.clock ?? defaultClock;

  // 1. Update game state.
  const oldState = await deps.gameState.getGameState(play.gameId);
  const newState = applyPlayToState(oldState, play, clock);
  await deps.gameState.setGameState(play.gameId, newState);

  // 2. Filter out non-interesting plays.
  if (!isInterestingStateChange(oldState, newState)) return;

  // 3. Find users whose lineup includes this game, active socket or not (Decision 8).
  const candidateUsers = await getUsersWithStakeIn(deps.gameState, newState);

  // 4. Recompute flag state per candidate and emit deltas.
  await Promise.all(
    candidateUsers.map(async (userId) => {
      const lineup = await deps.lineupCache.getLineupCache(userId, play.week);
      if (!lineup) return;

      const oldFlagState = await deps.gameState.getUserFlagState(userId, play.gameId);
      const newFlagState = computeFlagState(lineup, newState, clock);

      const event = diffFlagStates(userId, oldFlagState, newFlagState);
      if (!event) return;

      await deps.gameState.setUserFlagState(userId, play.gameId, newFlagState);
      await deps.dispatcher.dispatch(withPlayTiming(event, play), play.playId);
    }),
  );
  await deps.dispatcher.endPlay?.(play.gameId);
}
