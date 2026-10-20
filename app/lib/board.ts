/**
 * Pure derivations for Home's pre-game board (PIVOT-STAKES-PLAN.md §11.2/§11.3).
 *
 * Nothing here touches React or the network, and `now` is always injected, so every rule is
 * unit-testable the same way `homeState.ts` is. `loadHome` must not grow to accommodate the board —
 * the screen calls these in render via `useMemo` over data it already has.
 */
import { groupWindow, networkLabelFromAirings, type WindowLabel } from '@pivot/shared/broadcast';
import { formatStakeLabel } from '@pivot/shared/stakeLabel';
import type { HomeBranch, LineupGameGroup } from './homeState';
import type { ScheduleGame } from './schedule';
import { stakeLineEyebrow } from './stakeEyebrow';
import type { ManualStake } from './stakes';
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
 * `ScheduleGame.home_team`/`away_team`. Fantasy refs come from `lineupGroups` (one per active
 * starter). Bet refs (`kind: 'bet'`) come from `GET /stakes`; a total leaves `teamId` empty
 * so it does not pull the stripe to either side.
 */
export interface StakeRef {
  gameId: string;
  teamId: string;
  kind?: 'bet';
  stakeId?: string;
  label?: string;
  /** Survivor is POOL. Other bet types, and a live chip with no type, are BET. */
  eyebrow?: 'BET' | 'POOL';
}

/** A live `/flags/current` bet chip. `stake_id` matches `GET /stakes` `id`. */
export interface LiveBetEntry {
  stake_id: string;
  gameId: string;
  label: string;
}

const FANTASY_STAKE_TYPES = new Set(['ROSTERED', 'OPPONENT_ROSTERED']);

function gameById(weekGames: readonly ScheduleGame[]): Map<string, ScheduleGame> {
  return new Map(weekGames.map((game) => [game.game_id, game]));
}

function pickedTeamAbbreviation(stake: ManualStake, game: ScheduleGame): string {
  const teamId = stake.subject.teamId ?? '';
  if (teamId.length === 0) return '';
  if (teamId === game.home_team_id || teamId === game.home_team) return game.home_team;
  if (teamId === game.away_team_id || teamId === game.away_team) return game.away_team;
  return '';
}

function betRefForStake(stake: ManualStake, game: ScheduleGame): StakeRef {
  const teamId = pickedTeamAbbreviation(stake, game);
  const teams = [
    game.away_team_id
      ? { teamId: game.away_team_id, abbreviation: game.away_team }
      : { teamId: game.away_team, abbreviation: game.away_team },
    game.home_team_id
      ? { teamId: game.home_team_id, abbreviation: game.home_team }
      : { teamId: game.home_team, abbreviation: game.home_team },
  ];
  return {
    kind: 'bet',
    stakeId: stake.id,
    gameId: stake.game_id,
    teamId,
    label: formatStakeLabel(
      {
        condition: stake.condition,
        subject: { type: stake.subject.type, teamId: stake.subject.teamId ?? null },
      },
      teams,
    ),
    eyebrow: stakeLineEyebrow(stake.condition.type),
  };
}

/**
 * Fantasy refs plus one ref per bet on this week's board. `ROSTERED` and
 * `OPPONENT_ROSTERED` stay on the lineup. A stake id that is also in the live
 * payload is kept once, from the stake row (it has the team side).
 */
export function boardStakeRefs(input: {
  fantasyRefs: readonly StakeRef[];
  stakes: readonly ManualStake[];
  weekGames: readonly ScheduleGame[];
  liveBets: readonly LiveBetEntry[];
}): StakeRef[] {
  const games = gameById(input.weekGames);
  const bets = new Map<string, StakeRef>();

  for (const stake of input.stakes) {
    if (FANTASY_STAKE_TYPES.has(stake.condition.type)) continue;
    const game = games.get(stake.game_id);
    if (!game) continue;
    if (bets.has(stake.id)) continue;
    bets.set(stake.id, betRefForStake(stake, game));
  }

  for (const live of input.liveBets) {
    if (bets.has(live.stake_id)) continue;
    if (!games.has(live.gameId)) continue;
    bets.set(live.stake_id, {
      kind: 'bet',
      stakeId: live.stake_id,
      gameId: live.gameId,
      teamId: '',
      label: live.label,
    });
  }

  return [...input.fantasyRefs, ...bets.values()];
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
    // A total matches neither abbreviation, so it does not move the stripe. With no
    // team-sided ref at all the stripe stays unset (neutral) instead of defaulting home.
    const sided = homeStakes + awayStakes;

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
      stripeSide: sided === 0 ? null : awayStakes > homeStakes ? 'away' : 'home',
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

/** One stake line on MY CARD. A bet line uses the stake label and leaves `value` empty. */
export interface MyCardStakeLine {
  tag: 'FANTASY' | 'BET' | 'POOL';
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
 * The week's games the user has at least one rostered starter in. Live games first, then
 * upcoming by kickoff, then finals. Game id breaks a kickoff tie. Includes finals so MY CARD
 * keeps a record of games already played.
 *
 * Player lines come from `lineupGroups` as-is. That helper already dedupes by `player_id` across
 * leagues (`groupLineupByGame` / `listStakePlayersInGame`), so a player on two rosters appears
 * once per game — not once per league. Bet refs add a line on the same game, including a game
 * with no rostered starter.
 */
export function buildMyCardGames(
  rows: BoardRowData[],
  lineupGroups: LineupGameGroup[],
  betRefs: readonly StakeRef[] = [],
): MyCardGame[] {
  const betsByGame = new Map<string, StakeRef[]>();
  for (const ref of betRefs) {
    if (ref.kind !== 'bet') continue;
    const list = betsByGame.get(ref.gameId) ?? [];
    list.push(ref);
    betsByGame.set(ref.gameId, list);
  }
  if (lineupGroups.length === 0 && betsByGame.size === 0) return [];

  const playersByGame = new Map(
    lineupGroups.map((group) => [group.game.game_id, group.players] as const),
  );
  const playersGame = new Map(lineupGroups.map((group) => [group.game.game_id, group.game]));

  const games: MyCardGame[] = [];
  for (const row of rows) {
    const players = playersByGame.get(row.gameId) ?? [];
    const bets = betsByGame.get(row.gameId) ?? [];
    if (players.length === 0 && bets.length === 0) continue;

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
      stakes: [
        ...players.map((player) => ({
          tag: 'FANTASY' as const,
          label: stakeLineLabel(player, playersGame.get(row.gameId) ?? null),
          value: player.position,
        })),
        ...bets.map((bet) => ({
          tag: bet.eyebrow ?? 'BET',
          label: bet.label ?? '',
          value: '',
        })),
      ],
    });
  }

  return games.sort((a, b) => compareMyCardGames(a, b));
}

/** Live first, then games still to kick off, then finals. Kickoff, then game id, inside a group. */
function myCardGroupRank(status: MyCardGame['status']): number {
  if (status === 'in_progress') return 0;
  if (status === 'final') return 2;
  return 1;
}

export function compareMyCardGames(a: MyCardGame, b: MyCardGame): number {
  const byGroup = myCardGroupRank(a.status) - myCardGroupRank(b.status);
  if (byGroup !== 0) return byGroup;
  const byKickoff = a.kickoff.getTime() - b.kickoff.getTime();
  return byKickoff !== 0 ? byKickoff : compareGameIds(a.gameId, b.gameId);
}
