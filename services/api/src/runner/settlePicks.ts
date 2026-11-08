import { pickProgress, settledResult, slipSummary } from '@pivot/engine';
import type { GamePlayerStats, GameState, PickProgress, SettledResult } from '@pivot/shared';
import { isBetCondition } from '../lib/betIndex.js';
import { STAKE_ROW_COLUMNS, toStake, type StakeRowLike } from '../lib/pickRows.js';
import { loadPropPlayers } from '../lib/propPlayers.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';

/**
 * Final results for one game's picks (docs/P2-PICKS-MODEL.md §5). Runs when the runner sees the
 * final summary. Writes only rows with no result yet, so a repeat run (restart, second poll)
 * changes nothing. Live progress is never written.
 */

export interface SettleResult {
  picks: number;
  slips: number;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The final state to settle on: the summary's linescores win over a play-derived score. */
export function finalGameState(game: GameState, stats: GamePlayerStats): GameState {
  const hasLines = stats.linescores.home.length > 0 && stats.linescores.away.length > 0;
  return {
    ...game,
    status: 'final',
    ...(hasLines
      ? { scoreHome: sum(stats.linescores.home), scoreAway: sum(stats.linescores.away) }
      : {}),
  };
}

interface SettledRow extends StakeRowLike {
  result: string | null;
}

function legProgress(result: string | null): PickProgress {
  return result === null ? { status: 'live' } : { status: result as SettledResult };
}

export async function settleGamePicks(
  supabase: SupabaseServiceClient,
  game: GameState,
  stats: GamePlayerStats,
  now: Date = new Date(),
): Promise<SettleResult> {
  const finalState = finalGameState(game, stats);
  const { data, error } = await supabase
    .from('stakes')
    .select(`${STAKE_ROW_COLUMNS}, result`)
    .eq('game_id', game.gameId)
    .is('result', null);
  if (error) throw new Error(error.message);

  const stakes = ((data ?? []) as SettledRow[])
    .filter((row) => isBetCondition(row.condition))
    .flatMap((row) => {
      const stake = toStake(row);
      return stake ? [stake] : [];
    });
  const players = await loadPropPlayers(
    supabase,
    stakes.flatMap((stake) => (stake.subject.type === 'PLAYER' ? [stake.subject.playerId] : [])),
  );

  let picks = 0;
  const slipIds = new Set<string>();
  for (const stake of stakes) {
    const player =
      stake.subject.type === 'PLAYER' ? players.get(stake.subject.playerId) : undefined;
    const progress = pickProgress(stake, {
      game: finalState,
      playerStats: stats,
      ...(player ? { player } : {}),
    });
    const result = settledResult(progress.status);
    if (result === null) continue;
    const { error: updateError } = await supabase
      .from('stakes')
      .update({
        result,
        result_value: progress.current ?? null,
        settled_at: now.toISOString(),
      })
      .eq('id', stake.id)
      .is('result', null);
    if (updateError) throw new Error(updateError.message);
    picks += 1;
    if (stake.slipId !== undefined) slipIds.add(stake.slipId);
  }

  let slips = 0;
  for (const slipId of slipIds) {
    if (await settleSlip(supabase, slipId, now)) slips += 1;
  }
  return { picks, slips };
}

/**
 * A slip settles once every leg has a result, or as soon as one leg has lost (the other legs'
 * games may still be playing). Returns whether a result was written.
 */
export async function settleSlip(
  supabase: SupabaseServiceClient,
  slipId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabase.from('stakes').select('id, result').eq('slip_id', slipId);
  if (error) throw new Error(error.message);
  const legs = (data ?? []) as { id: string; result: string | null }[];
  if (legs.length === 0) return false;

  const summary = slipSummary(legs.map((leg) => legProgress(leg.result)));
  const result = settledResult(summary.status);
  if (result === null) return false;

  const { error: updateError } = await supabase
    .from('pick_slips')
    .update({ result, settled_at: now.toISOString() })
    .eq('id', slipId)
    .is('result', null);
  if (updateError) throw new Error(updateError.message);
  return true;
}
