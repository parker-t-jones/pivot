import { createHash } from 'node:crypto';
import {
  evaluateStake,
  type EventDispatcher,
  type PlayEvent,
  type Stake,
  type Trigger,
} from '@pivot/engine';
import type { FlagEvent, FlagState, GameState, UserLineupCache } from '@pivot/shared';
import { formatStakeLabel, type StakeTeam } from '@pivot/shared/stakeLabel';
import type { LineupCacheProvider } from '../cache/index.js';
import { isBetCondition } from '../lib/betIndex.js';
import type { Json } from '../lib/database.types.js';
import { claimFirstFire, firstFires, type FireClaimRedis } from '../lib/fireClaim.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';

const BET_CACHE_TTL_MS = 60_000;

const EMPTY_LINEUP: UserLineupCache = {
  userId: '',
  week: 0,
  teamPositions: new Map(),
  playerToTeam: new Map(),
  starPlayerIds: new Set(),
};

const STAKE_SOURCES = new Set<Stake['source']>([
  'SLEEPER_ROSTER',
  'SLEEPER_OPPONENT',
  'MANUAL',
  'KALSHI_MARKET',
  'SHARED_LIST',
]);

interface PreparedBet {
  stake: Stake;
  label: string;
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

    for (const { stake, label } of prepared) {
      const triggers = evaluateStake(stake, {
        gameId: play.gameId,
        game: gameState,
        lineup: EMPTY_LINEUP,
      });
      const claimed = await firstFires(triggers, (trigger) =>
        claimFirstFire(trigger.stakeId, trigger.code, {
          gameId: play.gameId,
          supabase: deps.supabase,
          redis: deps.redis,
        }),
      );
      for (const trigger of claimed) {
        await deps.dispatcher.dispatch(
          betEvent(trigger, stake.userId, label, play, now),
          play.playId,
        );
      }
    }
  } catch (error) {
    console.error(`[bets] pass failed game=${play.gameId} err=${failureReason(error)}`);
  }
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

interface StakeRow {
  id: string;
  user_id: string;
  season: number;
  week: number;
  game_id: string;
  subject: Json;
  condition: Json;
  source: string;
  weight: number;
  created_at: string;
}

async function loadBetStakes(
  supabase: SupabaseServiceClient,
  gameId: string,
): Promise<PreparedBet[]> {
  const { data, error } = await supabase
    .from('stakes')
    .select('id, user_id, season, week, game_id, subject, condition, source, weight, created_at')
    .eq('game_id', gameId);
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as StakeRow[]).filter((row) => isBetCondition(row.condition));
  const teamIds = [
    ...new Set(
      rows.flatMap((row) => {
        const teamId = teamIdOf(row.subject);
        return teamId === null ? [] : [teamId];
      }),
    ),
  ];
  const teams = await loadTeams(supabase, teamIds);
  const prepared: PreparedBet[] = [];
  for (const row of rows) {
    const stake = toStake(row);
    if (stake === null) continue;
    prepared.push({
      stake,
      label: formatStakeLabel(
        {
          condition: stake.condition,
          subject: {
            type: stake.subject.type,
            teamId: stake.subject.type === 'TEAM' ? stake.subject.teamId : null,
          },
        },
        teams,
      ),
    });
  }
  return prepared;
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

function teamIdOf(subject: Json): string | null {
  if (typeof subject !== 'object' || subject === null || Array.isArray(subject)) return null;
  const teamId = subject['teamId'];
  return typeof teamId === 'string' ? teamId : null;
}

function toStake(row: StakeRow): Stake | null {
  if (!STAKE_SOURCES.has(row.source as Stake['source'])) return null;
  const subject = toSubject(row.subject, row.game_id);
  const condition = toCondition(row.condition);
  if (subject === null || condition === null) return null;
  return {
    id: row.id,
    userId: row.user_id,
    season: row.season,
    week: row.week,
    gameId: row.game_id,
    subject,
    condition,
    source: row.source as Stake['source'],
    weight: row.weight,
    createdAt: row.created_at,
  };
}

function toSubject(value: Json, gameId: string): Stake['subject'] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = value['type'];
  if (type === 'GAME') return { type: 'GAME', gameId };
  const teamId = value['teamId'];
  if (type === 'TEAM' && typeof teamId === 'string') return { type: 'TEAM', teamId };
  return null;
}

function toCondition(value: Json): Stake['condition'] | null {
  if (!isBetCondition(value)) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = value['type'];
  if (type === 'MONEYLINE') return { type: 'MONEYLINE', side: 'TEAM' };
  if (type === 'SURVIVOR') return { type: 'SURVIVOR' };
  const line = value['line'];
  if (
    (type === 'SPREAD' || type === 'TOTAL_OVER' || type === 'TOTAL_UNDER') &&
    typeof line === 'number'
  ) {
    return { type, line };
  }
  return null;
}
