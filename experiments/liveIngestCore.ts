/**
 * Shared core for `live-ingest-service.ts` (standalone, Redis-backed) and
 * `dev-server-with-live-ingest.ts` (in-process, shares the API server's own `GameStateStore`
 * instance — no Redis needed). See either file's header for why this exists.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EspnPlaySource } from '@pivot/ingestion';
import { applyPlayToState, type PlayEvent } from '@pivot/engine';
import type { GameStateStore } from '@pivot/dispatcher';
import type { GameState } from '@pivot/shared';

interface GameRow {
  id: string;
  home_team_id: string;
  away_team_id: string;
}
interface TeamRow {
  id: string;
  abbreviation: string;
}

export function makeSupabase(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey);
}

export async function resolveGame(
  supabase: SupabaseClient,
  espnId: string,
): Promise<{ internalGameId: string; abbrToUuid: Map<string, string> } | null> {
  const { data: gameRow, error: gameError } = await supabase
    .from('games')
    .select('id, home_team_id, away_team_id')
    .eq('sportradar_id', `seed:espn:${espnId}`)
    .maybeSingle();
  if (gameError) throw gameError;
  if (!gameRow) return null;
  const game = gameRow as GameRow;

  const { data: teamRows, error: teamError } = await supabase
    .from('teams')
    .select('id, abbreviation')
    .in('id', [game.home_team_id, game.away_team_id]);
  if (teamError) throw teamError;

  const abbrToUuid = new Map<string, string>();
  for (const t of (teamRows ?? []) as TeamRow[]) {
    abbrToUuid.set(t.abbreviation, t.id);
  }
  return { internalGameId: game.id, abbrToUuid };
}

/** Translate a `PlayEvent`'s ESPN-abbreviation team ids into our Supabase team UUIDs, and its
 *  ESPN event-id `gameId` into our internal `games.id`. `applyPlayToState` treats team ids
 *  opaquely, so this is the one place the translation (Section 8 decision #2/#3) needs to happen. */
export function translatePlay(
  play: PlayEvent,
  internalGameId: string,
  abbrToUuid: Map<string, string>,
): PlayEvent {
  const home = abbrToUuid.get(play.homeTeamId) ?? play.homeTeamId;
  const away = abbrToUuid.get(play.awayTeamId) ?? play.awayTeamId;
  const possession =
    play.possessionTeamId === null
      ? null
      : abbrToUuid.get(play.possessionTeamId) ?? play.possessionTeamId;
  return {
    ...play,
    gameId: internalGameId,
    homeTeamId: home,
    awayTeamId: away,
    possessionTeamId: possession,
  };
}

export async function markStatus(
  supabase: SupabaseClient,
  internalGameId: string,
  status: 'in_progress' | 'final',
): Promise<void> {
  const { error } = await supabase.from('games').update({ status }).eq('id', internalGameId);
  if (error) console.error(`[live-ingest] failed to mark ${internalGameId} ${status}:`, error);
}

export async function runOne(
  supabase: SupabaseClient,
  gameStateStore: GameStateStore,
  espnId: string,
): Promise<void> {
  const resolved = await resolveGame(supabase, espnId);
  if (!resolved) {
    console.error(
      `[live-ingest] no seeded game found for ESPN id ${espnId} (sportradar_id seed:espn:${espnId})`,
    );
    return;
  }
  const { internalGameId, abbrToUuid } = resolved;
  console.log(
    `[live-ingest] espn ${espnId} -> game ${internalGameId}, teams: ${[...abbrToUuid.keys()].join(', ')}`,
  );

  let previous: GameState | null = null;
  let markedInProgress = false;
  let playCount = 0;

  const source = new EspnPlaySource({ eventId: espnId });
  await source.subscribe(async (rawPlay) => {
    const play = translatePlay(rawPlay, internalGameId, abbrToUuid);
    const state = applyPlayToState(previous, play);
    previous = state;
    playCount += 1;
    await gameStateStore.setGameState(internalGameId, state);

    if (!markedInProgress && state.status === 'in_progress') {
      markedInProgress = true;
      await markStatus(supabase, internalGameId, 'in_progress');
      console.log(`[live-ingest] ${espnId} marked in_progress in DB`);
    }
    if (state.status === 'final') {
      await markStatus(supabase, internalGameId, 'final');
      console.log(`[live-ingest] ${espnId} marked final in DB`);
    }

    console.log(
      `[live-ingest] ${espnId} play #${playCount}  Q${state.quarter} ${state.timeRemainingSec}s  ` +
        `${state.scoreAway}-${state.scoreHome}  poss=${rawPlay.possessionTeamId ?? '-'}  ` +
        `down=${state.down ?? '-'} dist=${state.distance ?? '-'} rz=${state.inRedZone}`,
    );
  });

  console.log(`[live-ingest] ${espnId} subscription ended (game final or disconnected)`);
}
