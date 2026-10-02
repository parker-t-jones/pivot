/**
 * Pure derivations for Home's pre-game board (PIVOT-STAKES-PLAN.md §11.2/§11.3).
 *
 * Nothing here touches React or the network, and `now` is always injected, so every rule is
 * unit-testable the same way `homeState.ts` is. `loadHome` must not grow to accommodate the board —
 * the screen calls these in render via `useMemo` over data it already has.
 */
import { groupWindow, networkLabelFromAirings, type WindowLabel } from '@pivot/shared/broadcast';
import type { HomeBranch, LineupGameGroup } from './homeState';
import type { ScheduleGame } from './schedule';
import { isDefensePosition } from './teamDisplay';

/**
 * The two Home branches that share the pre-game presentation (PIVOT-STAKES-PLAN.md §11.3).
 *
 * They stay separate in `resolveHomeBranch` — `state3` means a stake kickoff is close enough to
 * arm the live machine and `state4` means it isn't — but they render identically, so this is the
 * one place that says so.
 */
export function isPregameBranch(branch: HomeBranch['branch'] | null): boolean {
  return branch === 'state3' || branch === 'state4';
}

export { groupWindow };

/**
 * One stake riding on one game. `teamId` is the team abbreviation, matching
 * `ScheduleGame.home_team`/`away_team`. Today these come from `lineupGroups` (one per active
 * starter); after stakes Phase 1 the same shape carries non-fantasy stakes.
 */
export interface StakeRef {
  gameId: string;
  teamId: string;
}

export interface BoardRowData {
  gameId: string;
  kickoff: Date;
  status: ScheduleGame['status'];
  awayTeamId: string;
  homeTeamId: string;
  awayTeamColor: string;
  homeTeamColor: string;
  network: string | null;
  stakeCount: number;
  /** Which side gets the 3pt stripe. Null when the user has nothing riding on this game. */
  stripeSide: 'home' | 'away' | null;
}

export interface BoardWindowGroup {
  label: WindowLabel;
  earliestKickoff: Date;
  rows: BoardRowData[];
}

/** Deterministic id ordering — numeric-aware so "g2" sorts before "g10". */
function compareGameIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Every game in the week, grouped by broadcast window. Games the user has no stake in are
 * included (that is what makes it a board rather than a watchlist), and games already played
 * this week keep their stake dots.
 */
export function buildBoardRows(
  weekGames: ScheduleGame[],
  stakeRefs: StakeRef[],
): BoardWindowGroup[] {
  const refsByGame = new Map<string, StakeRef[]>();
  for (const ref of stakeRefs) {
    const list = refsByGame.get(ref.gameId) ?? [];
    list.push(ref);
    refsByGame.set(ref.gameId, list);
  }

  const rows: BoardRowData[] = [];
  for (const game of weekGames) {
    const kickoff = new Date(game.scheduled_start);
    if (Number.isNaN(kickoff.getTime())) continue;

    const refs = refsByGame.get(game.game_id) ?? [];
    const homeStakes = refs.filter((ref) => ref.teamId === game.home_team).length;
    const awayStakes = refs.filter((ref) => ref.teamId === game.away_team).length;

    rows.push({
      gameId: game.game_id,
      kickoff,
      status: game.status,
      awayTeamId: game.away_team,
      homeTeamId: game.home_team,
      awayTeamColor: game.away_team_primary_color,
      homeTeamColor: game.home_team_primary_color,
      network: networkLabelFromAirings(game.airings),
      stakeCount: refs.length,
      // Tie goes to the home team, so the stripe is stable rather than order-dependent.
      stripeSide: refs.length === 0 ? null : awayStakes > homeStakes ? 'away' : 'home',
    });
  }

  const groups = new Map<WindowLabel, BoardRowData[]>();
  for (const row of rows) {
    const label = groupWindow(row.kickoff);
    const list = groups.get(label) ?? [];
    list.push(row);
    groups.set(label, list);
  }

  return [...groups.entries()]
    .flatMap(([label, groupRows]) => {
      const sorted = groupRows.slice().sort((a, b) => {
        const byKickoff = a.kickoff.getTime() - b.kickoff.getTime();
        return byKickoff !== 0 ? byKickoff : compareGameIds(a.gameId, b.gameId);
      });
      const first = sorted[0];
      return first ? [{ label, earliestKickoff: first.kickoff, rows: sorted }] : [];
    })
    .sort((a, b) => a.earliestKickoff.getTime() - b.earliestKickoff.getTime());
}

/** Flattens grouped rows back to slate order — for `pickFeaturedGame` / `nextKickoff`. */
export function flattenRows(groups: BoardWindowGroup[]): BoardRowData[] {
  return groups.flatMap((group) => group.rows);
}

/**
 * The hero card's game: the upcoming game the user has most riding on.
 *
 * `gameScore` (plan §4) and the engine's `priority_score` are both live-state scores built from
 * active triggers, so both are zero before kickoff. This is the pre-game substitute.
 */
export function pickFeaturedGame(rows: BoardRowData[], now: Date): BoardRowData | null {
  const nowMs = now.getTime();
  const ranked = rows
    .filter((row) => row.kickoff.getTime() > nowMs && row.stakeCount >= 1)
    .sort((a, b) => {
      if (a.stakeCount !== b.stakeCount) return b.stakeCount - a.stakeCount;
      const byKickoff = a.kickoff.getTime() - b.kickoff.getTime();
      return byKickoff !== 0 ? byKickoff : compareGameIds(a.gameId, b.gameId);
    });

  return ranked[0] ?? null;
}

/**
 * The next game to kick off anywhere in the slate, stake or not. Returns the row (not a bare
 * Date) because Home needs both the countdown target and the game itself for the no-stake
 * fallback hero.
 */
export function nextKickoff(rows: BoardRowData[], now: Date): BoardRowData | null {
  const nowMs = now.getTime();
  let soonest: BoardRowData | null = null;
  for (const row of rows) {
    if (row.kickoff.getTime() <= nowMs) continue;
    if (!soonest || row.kickoff.getTime() < soonest.kickoff.getTime()) {
      soonest = row;
    }
  }
  return soonest;
}

/** One stake line on MY CARD. Fantasy-only in U3; PROP / SPREAD / … arrive with stakes Phase 1+. */
export interface MyCardStakeLine {
  tag: 'FANTASY';
  label: string;
  value: string;
}

/**
 * One stake game on MY CARD (PIVOT-STAKES-PLAN.md §11.3). Header fields mirror the board row so
 * the segment doesn't re-derive network / stripe; `stakes` are the per-player FANTASY lines.
 */
export interface MyCardGame {
  gameId: string;
  kickoff: Date;
  status: ScheduleGame['status'];
  awayTeamId: string;
  homeTeamId: string;
  awayTeamColor: string;
  homeTeamColor: string;
  network: string | null;
  stripeSide: 'home' | 'away' | null;
  stakes: MyCardStakeLine[];
}

/** A team defense's player row is named "Defense", so it reads "{nickname} D/ST" instead. */
function stakeLineLabel(
  player: LineupGameGroup['players'][number],
  game: ScheduleGame | null,
): string {
  if (!isDefensePosition(player.position)) {
    return `${player.first_name} ${player.last_name}`.trim();
  }
  const nickname =
    player.team_abbreviation === game?.home_team
      ? game.home_team_name
      : player.team_abbreviation === game?.away_team
        ? game.away_team_name
        : null;
  return nickname ? `${nickname} D/ST` : 'D/ST';
}

/**
 * The week's games the user has at least one rostered starter in, kickoff-ascending
 * (game-id tie-break). Includes finals so MY CARD keeps a record of games already played.
 *
 * Player lines come from `lineupGroups` as-is. That helper already dedupes by `player_id` across
 * leagues (`groupLineupByGame` / `listStakePlayersInGame`), so a player on two rosters appears
 * once per game — not once per league.
 */
export function buildMyCardGames(
  rows: BoardRowData[],
  lineupGroups: LineupGameGroup[],
): MyCardGame[] {
  if (lineupGroups.length === 0) return [];

  const playersByGame = new Map(
    lineupGroups.map((group) => [group.game.game_id, group.players] as const),
  );
  const playersGame = new Map(lineupGroups.map((group) => [group.game.game_id, group.game]));

  const games: MyCardGame[] = [];
  for (const row of rows) {
    const players = playersByGame.get(row.gameId);
    if (!players || players.length === 0) continue;

    games.push({
      gameId: row.gameId,
      kickoff: row.kickoff,
      status: row.status,
      awayTeamId: row.awayTeamId,
      homeTeamId: row.homeTeamId,
      awayTeamColor: row.awayTeamColor,
      homeTeamColor: row.homeTeamColor,
      network: row.network,
      stripeSide: row.stripeSide,
      stakes: players.map((player) => ({
        tag: 'FANTASY',
        label: stakeLineLabel(player, playersGame.get(row.gameId) ?? null),
        value: player.position,
      })),
    });
  }

  return games.sort((a, b) => {
    const byKickoff = a.kickoff.getTime() - b.kickoff.getTime();
    return byKickoff !== 0 ? byKickoff : compareGameIds(a.gameId, b.gameId);
  });
}
