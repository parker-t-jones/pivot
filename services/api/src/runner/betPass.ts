import { createHash } from 'node:crypto';
import {
  evaluateStake,
  type EventDispatcher,
  type PlayEvent,
  type PropPlayer,
  type Stake,
  type Trigger,
} from '@pivot/engine';
import type { FlagEvent, FlagState, GameState, UserLineupCache } from '@pivot/shared';
import type { GamePlayerStats } from '@pivot/shared';
import { formatPickLabel, shortPlayerName, type StakeTeam } from '@pivot/shared/stakeLabel';
import type { LineupCacheProvider } from '../cache/index.js';
import { isBetCondition } from '../lib/betIndex.js';
import { claimFirstFire, firstFires, type FireClaimRedis } from '../lib/fireClaim.js';
import { STAKE_ROW_COLUMNS, toStake, type StakeRowLike } from '../lib/pickRows.js';
import { loadPropPlayers } from '../lib/propPlayers.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';

const BET_CACHE_TTL_MS = 60_000;

const EMPTY_LINEUP: UserLineupCache = {
  userId: '',
  week: 0,
  teamPositions: new Map(),
  playerToTeam: new Map(),
  starPlayerIds: new Set(),
};

export interface PreparedBet {
  stake: Stake;
  label: string;
  /** Resolved from `players` for PLAYER subjects. */
  player?: PropPlayer;
}

export interface BetStakeCache {
  get(gameId: string, now: number): PreparedBet[] | null;
  set(gameId: string, now: number, stakes: PreparedBet[]): void;
}

export function createBetStakeCache(ttlMs = BET_CACHE_TTL_MS): BetStakeCache {
  const entries = new Map<string, { at: number; stakes: PreparedBet[] }>();
  return {
    get(gameId, now) {
      const hit = entries.get(gameId);
      if (!hit || now - hit.at >= ttlMs) return null;
      return hit.stakes;
    },
    set(gameId, now, stakes) {
      entries.set(gameId, { at: now, stakes });
    },
  };
}

export function betPriorityScore(leverage: number): number {
  return Math.max(1, Math.round(leverage * 12));
}

export interface BetPassDeps {
  lineupCache: Pick<LineupCacheProvider, 'getUsersWithBet'>;
  supabase: SupabaseServiceClient;
  redis: FireClaimRedis;
  dispatcher: EventDispatcher;
  cache: BetStakeCache;
  clock?: () => number;
  /** Latest parsed summary for the game, kept by the runner. Player and team props read it. */
  playerStats?: (gameId: string) => GamePlayerStats | undefined;
}

/** Copies poll timing onto the event when the play has it. Same fields as the fantasy path. */
function withPlayTiming(event: FlagEvent, play: PlayEvent): FlagEvent {
  if (play.wallclock === undefined && play.seenAt === undefined) return event;
  return {
    ...event,
    ...(play.wallclock !== undefined ? { playWallclock: play.wallclock } : {}),
    ...(play.seenAt !== undefined ? { seenAt: play.seenAt } : {}),
  };
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Evaluates manual bets on this play and dispatches at most one `bet_in_play` per stake and code.
 * An empty `users_with_bet` set returns before any other read. Errors stay inside this pass.
 */
export async function runBetPass(
  play: PlayEvent,
  gameState: GameState,
  deps: BetPassDeps,
): Promise<void> {
  try {
    const users = await deps.lineupCache.getUsersWithBet(play.gameId);
    if (users.length === 0) return;

    const now = (deps.clock ?? Date.now)();
    let prepared = deps.cache.get(play.gameId, now);
    if (prepared === null) {
      prepared = await loadBetStakes(deps.supabase, play.gameId);
      deps.cache.set(play.gameId, now, prepared);
    }

    const stats = deps.playerStats?.(play.gameId);
    const evaluated: { trigger: Trigger; bet: PreparedBet }[] = [];
    for (const bet of prepared) {
      const triggers = evaluateStake(bet.stake, {
        gameId: play.gameId,
        game: gameState,
        lineup: EMPTY_LINEUP,
        ...(stats ? { playerStats: stats } : {}),
        ...(bet.player ? { player: bet.player } : {}),
      });
      for (const trigger of triggers) evaluated.push({ trigger, bet });
    }

    for (const { trigger, bet } of oneLegPerSlipAndCode(evaluated)) {
      const [claimed] = await firstFires([trigger], (candidate) =>
        claimFirstFire(candidate.stakeId, candidate.code, {
          gameId: play.gameId,
          supabase: deps.supabase,
          redis: deps.redis,
        }),
      );
      if (claimed === undefined) continue;
      await deps.dispatcher.dispatch(
        betEvent(claimed, bet.stake.userId, bet.label, play, now),
        play.playId,
      );
    }
  } catch (error) {
    console.error(`[bets] pass failed game=${play.gameId} err=${failureReason(error)}`);
  }
}

/**
 * A parlay's legs in this game send at most one event per trigger code: the highest-leverage leg
 * (ties keep the first). Singles pass through. A slip in several games is handled per game.
 */
export function oneLegPerSlipAndCode<T extends { trigger: Trigger; bet: PreparedBet }>(
  evaluated: readonly T[],
): T[] {
  const kept: T[] = [];
  const bySlip = new Map<string, T>();
  for (const entry of evaluated) {
    const slipId = entry.bet.stake.slipId;
    if (slipId === undefined) {
      kept.push(entry);
      continue;
    }
    const key = `${slipId}:${entry.trigger.code}`;
    const current = bySlip.get(key);
    if (current === undefined || entry.trigger.leverage > current.trigger.leverage) {
      bySlip.set(key, entry);
    }
  }
  return [...kept, ...bySlip.values()];
}

function betEvent(
  trigger: Trigger,
  userId: string,
  label: string,
  play: PlayEvent,
  now: number,
): FlagEvent {
  const priorityScore = betPriorityScore(trigger.leverage);
  const state: FlagState = {
    gameId: play.gameId,
    flagged: false,
    priorityScore,
    reasons: [],
    computedAt: now,
  };
  return withPlayTiming(
    {
      id: createHash('sha1').update(`${trigger.stakeId}:${trigger.code}`).digest('hex'),
      userId,
      gameId: play.gameId,
      type: 'bet_in_play',
      stakeId: trigger.stakeId,
      code: trigger.code,
      label,
      oldState: null,
      newState: state,
      scheduledFireAt: now,
    },
    play,
  );
}

async function loadBetStakes(
  supabase: SupabaseServiceClient,
  gameId: string,
): Promise<PreparedBet[]> {
  const { data, error } = await supabase
    .from('stakes')
    .select(STAKE_ROW_COLUMNS)
    .eq('game_id', gameId);
  if (error) throw new Error(error.message);

  const stakes = ((data ?? []) as StakeRowLike[])
    .filter((row) => isBetCondition(row.condition))
    .flatMap((row) => {
      const stake = toStake(row);
      return stake ? [stake] : [];
    });
  const teamIds = [
    ...new Set(
      stakes.flatMap((stake) => (stake.subject.type === 'TEAM' ? [stake.subject.teamId] : [])),
    ),
  ];
  const players = await loadPropPlayers(
    supabase,
    stakes.flatMap((stake) => (stake.subject.type === 'PLAYER' ? [stake.subject.playerId] : [])),
  );
  const teams = await loadTeams(supabase, teamIds);
  return stakes.map((stake) => {
    const player =
      stake.subject.type === 'PLAYER' ? players.get(stake.subject.playerId) : undefined;
    return {
      stake,
      ...(player ? { player } : {}),
      label: formatPickLabel(
        {
          condition: stake.condition,
          subject: {
            type: stake.subject.type,
            teamId: stake.subject.type === 'TEAM' ? stake.subject.teamId : null,
          },
          playerName: player ? shortPlayerName(player.firstName, player.lastName) : null,
        },
        teams,
      ),
    };
  });
}

async function loadTeams(
  supabase: SupabaseServiceClient,
  teamIds: readonly string[],
): Promise<StakeTeam[]> {
  if (teamIds.length === 0) return [];
  const { data, error } = await supabase
    .from('teams')
    .select('id, abbreviation')
    .in('id', [...teamIds]);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; abbreviation: string }[]).map((team) => ({
    teamId: team.id,
    abbreviation: team.abbreviation,
  }));
}
