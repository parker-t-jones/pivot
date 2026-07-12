import type { GameState, UserLineupCache } from '@fantasy-focus/shared';
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
 * structurally, rather than importing `@fantasy-focus/api` so the engine doesn't depend on the API
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

/** Section 8 "User candidate selection": stakeholders in either team who are currently active. */
async function getActiveUsersWithStakeIn(
  gameState: GameStateProvider,
  state: GameState,
): Promise<string[]> {
  const [homeStakes, awayStakes, active] = await Promise.all([
    gameState.getUsersWithStakeIn(state.homeTeamId),
    gameState.getUsersWithStakeIn(state.awayTeamId),
    gameState.getActiveUsers(),
  ]);
  const stakeholders = new Set([...homeStakes, ...awayStakes]);
  const activeSet = new Set(active);
  return [...stakeholders].filter((userId) => activeSet.has(userId));
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
 * User flag state is only persisted when a diff produces an event, exactly as Section 8 specifies:
 * sub-threshold priority drift is measured against the last *evented* state.
 */
export async function onPlayEvent(deps: OnPlayEventDeps, play: PlayEvent): Promise<void> {
  const clock = deps.clock ?? defaultClock;

  // 1. Update game state.
  const oldState = await deps.gameState.getGameState(play.gameId);
  const newState = applyPlayToState(oldState, play, clock);
  await deps.gameState.setGameState(play.gameId, newState);

  // 2. Filter out non-interesting plays.
  if (!isInterestingStateChange(oldState, newState)) return;

  // 3. Find active users with a stake in this game.
  const candidateUsers = await getActiveUsersWithStakeIn(deps.gameState, newState);

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
      await deps.dispatcher.dispatch(event);
    }),
  );
}
