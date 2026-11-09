import { formatPickLabel, shortPlayerName } from '@pivot/shared/stakeLabel';

import { addPickSlipPickText, type LegKind } from './addPickFlow';
import {
  SPREAD_LINE_BASELINE,
  SPREAD_LINE_BOUNDS,
  TOTAL_LINE_BASELINE,
  TOTAL_LINE_BOUNDS,
  spreadLineInput,
  spreadReadout,
  totalReadout,
  type SpreadRole,
  type TotalRole,
} from './addPickLine';
import {
  PERIOD_LABEL,
  periodKey,
  playerMarket,
  statBaseline,
  statBounds,
  teamMarket,
  teamMarketBaseline,
  teamMarketBounds,
  validateHalfLine,
  type LineBounds,
  type Period,
  type PlayerMarketKey,
  type TeamMarketKey,
} from './pickMarkets';
import {
  fieldGoalReadout,
  firstToScoreReadout,
  playerEventReadout,
  segmentSpreadReadout,
  segmentTotalReadout,
  statReadout,
  teamTotalReadout,
} from './pickReadout';
import type { BetCondition, PickInput } from './picksClient';
import { validateLine } from './stakes';
import { teamName } from './teamColors';

/** The game fields a draft needs. `ScheduleGame` satisfies it. */
export interface DraftGame {
  game_id: string;
  status: string;
  scheduled_start: string;
  home_team_id?: string;
  away_team_id?: string;
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
}

/** The player fields a draft needs. `PlayerSearchResult` satisfies it. */
export interface DraftPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string;
  team: { abbreviation: string } | null;
}

export type EventSide = 'yes' | 'no';

/** One pick being built: a single, or the current parlay leg. */
export interface PickDraft {
  kind: LegKind | 'SURVIVOR' | null;
  game: DraftGame | null;
  teamId: string | null;
  player: DraftPlayer | null;
  playerMarket: PlayerMarketKey | null;
  teamMarket: TeamMarketKey | null;
  /** `undefined` until a segment-only market has one. `null` is the full game. */
  period: Period | undefined;
  spreadRole: SpreadRole | null;
  totalRole: TotalRole | null;
  eventSide: EventSide | null;
  /** The magnitude field, unsigned. */
  lineText: string;
}

export const EMPTY_DRAFT: PickDraft = {
  kind: null,
  game: null,
  teamId: null,
  player: null,
  playerMarket: null,
  teamMarket: null,
  period: undefined,
  spreadRole: null,
  totalRole: null,
  eventSide: null,
  lineText: '',
};

/** Same draft with the line cleared, e.g. after the game, side, or market changes. */
export function withLineReset(draft: PickDraft): PickDraft {
  return { ...draft, spreadRole: null, totalRole: null, eventSide: null, lineText: '' };
}

export type LineRoleSet = 'spread' | 'overUnder' | 'yesNo';

export interface LineConfig {
  roleSet: LineRoleSet;
  role: string | null;
  /** Null: no number to enter (TD yes/no). */
  stepper: { bounds: LineBounds; baseline: number } | null;
  /** Null: no period control. */
  periods: readonly Period[] | null;
}

function overUnderRole(draft: PickDraft): string | null {
  return draft.totalRole;
}

/** What the line step shows for this draft. Null: the draft has no line step. */
export function draftLineConfig(draft: PickDraft): LineConfig | null {
  switch (draft.kind) {
    case 'SPREAD':
      return {
        roleSet: 'spread',
        role: draft.spreadRole,
        stepper: { bounds: SPREAD_LINE_BOUNDS, baseline: SPREAD_LINE_BASELINE },
        periods: null,
      };
    case 'TOTAL':
      return {
        roleSet: 'overUnder',
        role: overUnderRole(draft),
        stepper: { bounds: TOTAL_LINE_BOUNDS, baseline: TOTAL_LINE_BASELINE },
        periods: null,
      };
    case 'PLAYER_PROP': {
      if (draft.playerMarket === null) return null;
      const market = playerMarket(draft.playerMarket);
      if (market.kind === 'event') {
        return { roleSet: 'yesNo', role: draft.eventSide, stepper: null, periods: null };
      }
      return {
        roleSet: 'overUnder',
        role: overUnderRole(draft),
        stepper: { bounds: statBounds(market.stat), baseline: statBaseline(market.stat) },
        periods: null,
      };
    }
    case 'TEAM_PROP': {
      if (draft.teamMarket === null) return null;
      const market = teamMarket(draft.teamMarket);
      if (market.roles === null) return null;
      const period = draft.period === undefined ? (market.periods[0] ?? null) : draft.period;
      return {
        roleSet: market.roles,
        role: market.roles === 'spread' ? draft.spreadRole : overUnderRole(draft),
        stepper: {
          bounds: teamMarketBounds(market.key),
          baseline: teamMarketBaseline(market.key, period),
        },
        periods: market.periods.length > 0 ? market.periods : null,
      };
    }
    default:
      return null;
  }
}

export type LineCheck = { ok: true; line: number } | { ok: false; message: string };

/**
 * The validated line, signed where it matters (spreads). Null until the role (and, for a
 * segment-only market, the period) is chosen, or when the draft has no number.
 */
export function draftLine(draft: PickDraft): LineCheck | null {
  const config = draftLineConfig(draft);
  if (config === null || config.stepper === null || config.role === null) return null;
  if (config.periods !== null && draft.period === undefined) return null;
  if (draft.kind === 'SPREAD' && draft.spreadRole !== null) {
    const check = validateLine('SPREAD', spreadLineInput(draft.spreadRole, draft.lineText));
    if (!check.ok) return check;
    return check.line === undefined
      ? { ok: false, message: 'Enter a line.' }
      : { ok: true, line: check.line };
  }
  if (draft.kind === 'TOTAL') {
    const check = validateLine('TOTAL_OVER', draft.lineText);
    if (!check.ok) return check;
    return check.line === undefined
      ? { ok: false, message: 'Enter a line.' }
      : { ok: true, line: check.line };
  }
  const check = validateHalfLine(draft.lineText, config.stepper.bounds);
  if (!check.ok) return check;
  if (config.roleSet === 'spread') {
    return { ok: true, line: draft.spreadRole === 'favorite' ? -check.line : check.line };
  }
  return check;
}

/** The line step is done: role, period, and a valid number (or a yes/no side). */
export function draftLineReady(draft: PickDraft): boolean {
  const config = draftLineConfig(draft);
  if (config === null) return false;
  if (config.role === null) return false;
  if (config.periods !== null && draft.period === undefined) return false;
  if (config.stepper === null) return true;
  return draftLine(draft)?.ok === true;
}

function segmentField(period: Period | undefined): { segment?: Exclude<Period, null> } {
  return period == null ? {} : { segment: period };
}

function overUnder<O extends string, U extends string>(
  role: TotalRole | null,
  over: O,
  under: U,
): O | U | null {
  if (role === null) return null;
  return role === 'over' ? over : under;
}

/** The `POST /picks` pick for a finished draft. Null until every step is done. */
export function buildPickInput(draft: PickDraft): PickInput | null {
  const game = draft.game;
  if (game === null || draft.kind === null) return null;
  const gameId = game.game_id;
  const teamId = draft.teamId ?? undefined;
  const line = draftLine(draft);
  const lineValue = line?.ok === true ? line.line : null;
  const withTeam = (condition: BetCondition): PickInput | null =>
    teamId === undefined ? null : { gameId, teamId, condition };

  switch (draft.kind) {
    case 'SPREAD':
      return lineValue === null ? null : withTeam({ type: 'SPREAD', line: lineValue });
    case 'TOTAL': {
      const type = overUnder(draft.totalRole, 'TOTAL_OVER', 'TOTAL_UNDER');
      return type === null || lineValue === null
        ? null
        : { gameId, condition: { type, line: lineValue } };
    }
    case 'MONEYLINE':
      return withTeam({ type: 'MONEYLINE', side: 'TEAM' });
    case 'SURVIVOR':
      return withTeam({ type: 'SURVIVOR' });
    case 'PLAYER_PROP': {
      if (draft.player === null || draft.playerMarket === null) return null;
      const playerId = draft.player.player_id;
      const market = playerMarket(draft.playerMarket);
      if (market.kind === 'event') {
        if (draft.eventSide === null) return null;
        return {
          gameId,
          playerId,
          condition: {
            type: 'PLAYER_EVENT',
            event: market.event,
            side: draft.eventSide === 'yes' ? 'YES' : 'NO',
          },
        };
      }
      const type = overUnder(draft.totalRole, 'STAT_OVER', 'STAT_UNDER');
      if (type === null || lineValue === null) return null;
      return { gameId, playerId, condition: { type, stat: market.stat, line: lineValue } };
    }
    case 'TEAM_PROP': {
      if (draft.teamMarket === null) return null;
      if (draft.teamMarket === 'FIRST_TO_SCORE') return withTeam({ type: 'FIRST_TO_SCORE' });
      if (lineValue === null || draft.period === undefined) return null;
      const segment = segmentField(draft.period);
      switch (draft.teamMarket) {
        case 'TEAM_TOTAL': {
          const type = overUnder(draft.totalRole, 'TEAM_TOTAL_OVER', 'TEAM_TOTAL_UNDER');
          return type === null ? null : withTeam({ type, line: lineValue, ...segment });
        }
        case 'SEGMENT_SPREAD':
          return withTeam({ type: 'SPREAD', line: lineValue, ...segment });
        case 'SEGMENT_TOTAL': {
          const type = overUnder(draft.totalRole, 'TOTAL_OVER', 'TOTAL_UNDER');
          return type === null
            ? null
            : { gameId, condition: { type, line: lineValue, ...segment } };
        }
        case 'GAME_FG':
        case 'TEAM_FG': {
          const type = overUnder(draft.totalRole, 'FG_OVER', 'FG_UNDER');
          if (type === null) return null;
          const condition: BetCondition = { type, line: lineValue, ...segment };
          return draft.teamMarket === 'TEAM_FG' ? withTeam(condition) : { gameId, condition };
        }
      }
    }
  }
  return null;
}

export function draftTeamAbbreviation(draft: PickDraft): string {
  const game = draft.game;
  if (game === null || draft.teamId === null) return '';
  if (draft.teamId === game.home_team_id) return game.home_team;
  if (draft.teamId === game.away_team_id) return game.away_team;
  return '';
}

/** "49ers", from the team colors table, then the API's team name. */
export function draftTeamNickname(draft: PickDraft): string {
  const abbreviation = draftTeamAbbreviation(draft);
  const game = draft.game;
  return (
    teamName(abbreviation) ??
    (game && draft.teamId === game.home_team_id
      ? game.home_team_name
      : game && draft.teamId === game.away_team_id
        ? game.away_team_name
        : abbreviation)
  );
}

/** Plain-English readout of a finished line, or null while it is incomplete. */
export function draftReadout(draft: PickDraft): string | null {
  const input = buildPickInput(draft);
  if (input === null) return null;
  const nickname = draftTeamNickname(draft);
  const condition = input.condition;
  const period = draft.period ?? null;
  switch (condition.type) {
    case 'SPREAD':
      if (draft.spreadRole === null) return null;
      return condition.segment
        ? segmentSpreadReadout(
            nickname,
            draft.spreadRole,
            Math.abs(condition.line),
            condition.segment,
          )
        : spreadReadout(nickname, draft.spreadRole, Math.abs(condition.line));
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER': {
      const role = condition.type === 'TOTAL_OVER' ? 'over' : 'under';
      return condition.segment
        ? segmentTotalReadout(role, condition.line, condition.segment)
        : totalReadout(role, condition.line);
    }
    case 'STAT_OVER':
    case 'STAT_UNDER': {
      if (draft.player === null || draft.playerMarket === null) return null;
      const market = playerMarket(draft.playerMarket);
      if (market.kind !== 'stat') return null;
      return statReadout(
        draft.player.last_name,
        condition.type === 'STAT_OVER' ? 'over' : 'under',
        condition.line,
        market.unit,
      );
    }
    case 'PLAYER_EVENT':
      if (draft.player === null) return null;
      return playerEventReadout(
        draft.player.last_name,
        condition.event,
        condition.side === 'YES' ? 'yes' : 'no',
      );
    case 'TEAM_TOTAL_OVER':
    case 'TEAM_TOTAL_UNDER':
      return teamTotalReadout(
        nickname,
        condition.type === 'TEAM_TOTAL_OVER' ? 'over' : 'under',
        condition.line,
        period,
      );
    case 'FG_OVER':
    case 'FG_UNDER':
      return fieldGoalReadout(
        input.teamId === undefined ? null : nickname,
        condition.type === 'FG_OVER' ? 'over' : 'under',
        condition.line,
        period,
      );
    case 'FIRST_TO_SCORE':
      return firstToScoreReadout(nickname);
    default:
      return null;
  }
}

/** Badge on the slip's PICK row: the player's or the picked team's abbreviation. */
export function draftPickBadge(draft: PickDraft): string | null {
  if (draft.kind === 'PLAYER_PROP') return draft.player?.team?.abbreviation ?? null;
  const abbreviation = draftTeamAbbreviation(draft);
  return abbreviation.length > 0 ? abbreviation : null;
}

function teamsOf(game: DraftGame): { teamId: string; abbreviation: string }[] {
  const teams: { teamId: string; abbreviation: string }[] = [];
  if (game.home_team_id) teams.push({ teamId: game.home_team_id, abbreviation: game.home_team });
  if (game.away_team_id) teams.push({ teamId: game.away_team_id, abbreviation: game.away_team });
  return teams;
}

/** The label the Watchlist and pushes use for a saved pick. */
export function pickInputLabel(
  input: PickInput,
  game: DraftGame,
  player: DraftPlayer | null,
): string {
  return formatPickLabel(
    {
      condition: input.condition,
      subject: input.playerId
        ? { type: 'PLAYER' }
        : input.teamId
          ? { type: 'TEAM', teamId: input.teamId }
          : { type: 'GAME' },
      playerName: player ? shortPlayerName(player.first_name, player.last_name) : null,
    },
    teamsOf(game),
  );
}

/** The slip's PICK text. Fills in as steps are done; null stays a placeholder. */
export function draftPickText(draft: PickDraft): string | null {
  if (
    draft.kind === 'SPREAD' ||
    draft.kind === 'TOTAL' ||
    draft.kind === 'MONEYLINE' ||
    draft.kind === 'SURVIVOR'
  ) {
    const line = draftLine(draft);
    return addPickSlipPickText({
      kind: draft.kind,
      team: draftTeamAbbreviation(draft),
      totalSide: draft.totalRole === 'under' ? 'TOTAL_UNDER' : 'TOTAL_OVER',
      lineOk: line?.ok === true,
      lineText: draft.lineText,
      lineInput:
        draft.kind === 'SPREAD' && draft.spreadRole !== null
          ? spreadLineInput(draft.spreadRole, draft.lineText)
          : draft.lineText.trim(),
    });
  }
  const input = buildPickInput(draft);
  if (input !== null && draft.game !== null) return pickInputLabel(input, draft.game, draft.player);
  if (draft.kind === 'PLAYER_PROP' && draft.player !== null) {
    const name = shortPlayerName(draft.player.first_name, draft.player.last_name);
    return draft.playerMarket === null
      ? name
      : `${name} · ${playerMarket(draft.playerMarket).label}`;
  }
  if (draft.kind === 'TEAM_PROP' && draft.teamMarket !== null) {
    const abbreviation = draftTeamAbbreviation(draft);
    const period =
      draft.period === undefined || draft.period === null
        ? ''
        : ` ${PERIOD_LABEL[periodKey(draft.period)]}`;
    const label = teamMarket(draft.teamMarket).label;
    return abbreviation.length > 0 ? `${abbreviation}${period} · ${label}` : null;
  }
  return null;
}

/** Same pick twice in one parlay: the API answers 409 `slip_duplicate_leg`, so catch it first. */
export function samePickInput(a: PickInput, b: PickInput): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
