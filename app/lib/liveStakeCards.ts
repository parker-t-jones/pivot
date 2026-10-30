import type { DestinationResolution } from '@pivot/shared/broadcast';

import type { StakeRef } from './board';
import {
  liveClockLabel,
  periodBreakLabel,
  watchBroadcastLabel,
  watchCta,
  type CurrentFlag,
  type GameBroadcast,
} from './gameDisplay';
import type { LineupGameGroup } from './homeState';
import { isDefensePosition } from './teamDisplay';
import type { LiveGame } from './schedule';

/** How many stake chips a live card shows before collapsing the rest into `+n`. */
export const LIVE_STAKE_CHIP_CAP = 4;

export type LiveStakeEyebrow = 'NOW ACTIVE' | 'LIVE · YOUR GAME';

export interface LiveStakeChip {
  key: string;
  text: string;
  tone: 'on_field' | 'sideline' | 'neutral';
}

export interface FantasyChipPlayer {
  playerId: string;
  firstName: string;
  lastName: string;
  position: string;
  teamAbbreviation: string;
}

export interface BetChipSource {
  id: string;
  eyebrow: 'BET' | 'POOL';
  /** `formatStakeLabel` text, e.g. `"SEA ML"` or `"Survivor · JAX"`. */
  label: string;
}

export interface LiveStakeCardModel {
  game: LiveGame;
  eyebrow: LiveStakeEyebrow | null;
  /** Filled amber button when a stake in this game is active. Outlined otherwise. */
  active: boolean;
  chips: LiveStakeChip[];
  extraChips: number;
  buttonLabel: string;
  /** False for "Not on your services" and "On {raw}", which are text, not a button. */
  opensLink?: boolean;
  alternates?: readonly GameBroadcast[];
}

/**
 * Top-card rule.
 *
 * A game with an active stake is one `GET /flags/current` returned (priority_score > 0 and
 * `flagged`). Those sort the way that route already sorts: priority_score descending, then
 * game_id ascending. The first of them is the top card, labeled NOW ACTIVE.
 *
 * When none of the staked live games is flagged, they keep `GET /games/live` order:
 * scheduled_start ascending, then game_id ascending. The first is the top card, labeled
 * LIVE · YOUR GAME. Unflagged games have no priority_score — the engine only scores a game
 * once a stake is active — so kickoff order is the ranking the client already has.
 */
export function rankLiveStakeCards(input: {
  liveGames: readonly LiveGame[];
  stakeGameIds: ReadonlySet<string>;
  active: readonly { gameId: string; priorityScore: number }[];
}): { game: LiveGame; active: boolean; priorityScore: number }[] {
  const activeById = new Map(input.active.map((row) => [row.gameId, row.priorityScore]));
  const included = input.liveGames.filter(
    (game) => input.stakeGameIds.has(game.game_id) || activeById.has(game.game_id),
  );
  return included
    .map((game) => {
      const priorityScore = activeById.get(game.game_id);
      return {
        game,
        active: priorityScore !== undefined,
        priorityScore: priorityScore ?? 0,
      };
    })
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.active && b.active && a.priorityScore !== b.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      if (a.active && b.active) return compareGameIds(a.game.game_id, b.game.game_id);
      const byKickoff = Date.parse(a.game.scheduled_start) - Date.parse(b.game.scheduled_start);
      return byKickoff !== 0 ? byKickoff : compareGameIds(a.game.game_id, b.game.game_id);
    });
}

function compareGameIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function watchButtonLabel(
  broadcasts: readonly GameBroadcast[],
  airings: readonly { network: string }[],
  destination?: DestinationResolution,
): string {
  const cta = watchCta(broadcasts, airings, destination);
  if (cta.kind === 'watch') return watchBroadcastLabel(cta.broadcast);
  if (cta.kind === 'airing') {
    if (destination?.kind === 'unavailable' || destination?.kind === 'unknown_network') {
      return cta.text;
    }
    if (cta.text.startsWith('On ')) return `Watch on ${cta.text.slice(3)}`;
    return cta.text;
  }
  return 'Watch';
}

function fantasyChipText(
  player: FantasyChipPlayer,
  game: LiveGame,
  onField: boolean,
): { text: string; tone: 'on_field' | 'sideline' } {
  const defense = isDefensePosition(player.position);
  const nickname =
    player.teamAbbreviation === game.home_team
      ? game.home_team_name
      : player.teamAbbreviation === game.away_team
        ? game.away_team_name
        : player.teamAbbreviation;
  const name = defense
    ? `${nickname} D/ST`
    : `${player.firstName} ${player.lastName} ${player.position}`.trim();
  return {
    text: `${name} · ${onField ? 'ON FIELD' : 'SIDELINE'}`,
    tone: onField ? 'on_field' : 'sideline',
  };
}

function betChipText(bet: BetChipSource): string {
  if (bet.eyebrow === 'POOL') {
    const team = bet.label.replace(/^Survivor\s·\s/, '').trim();
    return `POOL · ${team}`;
  }
  return `BET · ${bet.label}`;
}

/** Halftime and end of quarter. The card stays LIVE · YOUR GAME and every chip is SIDELINE. */
export function isPeriodBreak(game: LiveGame): boolean {
  return periodBreakLabel(game.quarter, game.time_remaining_sec, game.possession_team) !== null;
}

export function liveStakeChips(input: {
  game: LiveGame;
  players: readonly FantasyChipPlayer[];
  bets: readonly BetChipSource[];
  /**
   * `flagged_players` on this game's `/flags/current` row. A fantasy chip is ON FIELD only when
   * that player is in the set. Ignored during a period break. Bets stay neutral either way.
   */
  activePlayerIds?: ReadonlySet<string>;
}): { chips: LiveStakeChip[]; extraChips: number } {
  const periodBreak = isPeriodBreak(input.game);
  const fantasy = input.players.map((player) => {
    const onField = !periodBreak && (input.activePlayerIds?.has(player.playerId) ?? false);
    const chip = fantasyChipText(player, input.game, onField);
    return { key: `fantasy:${player.playerId}`, text: chip.text, tone: chip.tone };
  });
  const bets = input.bets.map((bet) => ({
    key: `bet:${bet.id}`,
    text: betChipText(bet),
    tone: 'neutral' as const,
  }));
  const all = [...fantasy, ...bets];
  if (all.length <= LIVE_STAKE_CHIP_CAP) return { chips: all, extraChips: 0 };
  return {
    chips: all.slice(0, LIVE_STAKE_CHIP_CAP),
    extraChips: all.length - LIVE_STAKE_CHIP_CAP,
  };
}

export function fieldSideAbbreviations(game: LiveGame): { left: string; right: string } {
  if (game.possession_team === game.home_team) {
    return { left: game.home_team, right: game.away_team };
  }
  if (game.possession_team === game.away_team) {
    return { left: game.away_team, right: game.home_team };
  }
  return { left: game.away_team, right: game.home_team };
}

/** Clock line shared by the live card gauge and the YOUR PICKS header. */
export function liveCardClock(game: LiveGame): string {
  return liveClockLabel(game.quarter, game.time_remaining_sec, game.possession_team);
}

export interface LiveStakeFlag {
  game_id: string;
  priority_score: number;
  opponent_label?: string;
  /** Triggering fantasy stakes. Absent on older callers; an empty list marks no fantasy chip. */
  flagged_players?: readonly Pick<CurrentFlag['flagged_players'][number], 'player_id'>[];
}

export function buildLiveStakeCards(input: {
  liveGames: readonly LiveGame[];
  stakeGameIds: ReadonlySet<string>;
  activeFlags: readonly LiveStakeFlag[];
  playersByGameId: ReadonlyMap<string, readonly FantasyChipPlayer[]>;
  betsByGameId: ReadonlyMap<string, readonly BetChipSource[]>;
  watchByGameId: ReadonlyMap<
    string,
    {
      broadcasts: readonly GameBroadcast[];
      airings: readonly { network: string }[];
      destination?: DestinationResolution;
    }
  >;
}): LiveStakeCardModel[] {
  const breakIds = new Set(
    input.liveGames.filter((game) => isPeriodBreak(game)).map((game) => game.game_id),
  );
  const ownActive = input.activeFlags.filter(
    (flag) => flag.opponent_label === undefined && !breakIds.has(flag.game_id),
  );
  const ranked = rankLiveStakeCards({
    liveGames: input.liveGames,
    stakeGameIds: input.stakeGameIds,
    active: ownActive.map((flag) => ({
      gameId: flag.game_id,
      priorityScore: flag.priority_score,
    })),
  });
  const playersByFlag = new Map(
    ownActive.map((flag) => [
      flag.game_id,
      new Set((flag.flagged_players ?? []).map((player) => player.player_id)),
    ]),
  );
  return ranked.map((row, index) => {
    const watch = input.watchByGameId.get(row.game.game_id);
    const destination = watch?.destination;
    const cta = watchCta(watch?.broadcasts ?? [], watch?.airings ?? [], destination);
    const chips = liveStakeChips({
      game: row.game,
      players: input.playersByGameId.get(row.game.game_id) ?? [],
      bets: input.betsByGameId.get(row.game.game_id) ?? [],
      activePlayerIds: playersByFlag.get(row.game.game_id),
    });
    const eyebrow: LiveStakeEyebrow | null =
      index === 0 ? (row.active ? 'NOW ACTIVE' : 'LIVE · YOUR GAME') : null;
    return {
      game: row.game,
      eyebrow,
      active: row.active,
      chips: chips.chips,
      extraChips: chips.extraChips,
      buttonLabel: watchButtonLabel(watch?.broadcasts ?? [], watch?.airings ?? [], destination),
      opensLink:
        destination?.kind === 'unavailable' || destination?.kind === 'unknown_network'
          ? false
          : true,
      alternates: cta.kind === 'watch' ? (cta.alternates ?? []) : [],
    };
  });
}

export function playersFromLineupGroup(group: LineupGameGroup): FantasyChipPlayer[] {
  return group.players.map((player) => ({
    playerId: player.player_id,
    firstName: player.first_name,
    lastName: player.last_name,
    position: player.position,
    teamAbbreviation: player.team_abbreviation,
  }));
}

export function betChipsFromRefs(refs: readonly StakeRef[]): Map<string, BetChipSource[]> {
  const byGame = new Map<string, BetChipSource[]>();
  for (const ref of refs) {
    if (ref.kind !== 'bet') continue;
    const list = byGame.get(ref.gameId) ?? [];
    list.push({
      id: ref.stakeId ?? `${ref.gameId}:${ref.label ?? ref.teamId}`,
      eyebrow: ref.eyebrow ?? 'BET',
      label: ref.label ?? ref.teamId,
    });
    byGame.set(ref.gameId, list);
  }
  return byGame;
}
