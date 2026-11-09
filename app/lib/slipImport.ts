import { ApiRequestError, apiClient } from './apiClient';
import { formatMagnitude } from './addPickLine';
import {
  EMPTY_DRAFT,
  buildPickInput,
  samePickInput,
  type DraftGame,
  type DraftPlayer,
  type PickDraft,
} from './pickDraft';
import type { PlayerMarketKey } from './pickMarkets';
import type { PickInput } from './picksClient';

/** One leg of `POST /picks/import`, as the API matched it. */
export type ImportedLeg =
  | {
      status: 'ready';
      /** The leg as the slip printed it. */
      text: string;
      pick: PickInput;
      game: DraftGame;
      player: DraftPlayer | null;
    }
  | { status: 'flagged'; text: string; reason: string };

export interface SlipImportResult {
  kind: 'single' | 'parlay';
  legs: ImportedLeg[];
  imports_left: number;
}

/** A leg Pivot could not match. The user adds it by hand or dismisses it. */
export interface FlaggedLeg {
  key: string;
  text: string;
  reason: string;
}

/** Sends one screenshot (base64 or a data URL). Nothing is saved until the user saves the pick. */
export async function importSlip(image: string): Promise<SlipImportResult> {
  return await apiClient.post<SlipImportResult>('/picks/import', { image });
}

/** `/health` says whether the server has a model key. Missing or failing reads as off. */
export async function fetchSlipImportEnabled(): Promise<boolean> {
  try {
    const health = await apiClient.get<{ slipImport?: string }>('/health');
    return health.slipImport === 'enabled';
  } catch {
    return false;
  }
}

/** The API's own sentence for import errors (limit, unreadable, too large), else a fallback. */
export function slipImportErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code.startsWith('slip_')) return error.message;
  return 'We couldn’t import that screenshot. Try again, or add the pick yourself.';
}

export const IMPORT_EDIT_REASON = 'We couldn’t match this pick. Add it yourself.';

function overUnderRole(type: string): PickDraft['totalRole'] {
  return type.endsWith('_OVER') ? 'over' : 'under';
}

function teamIdFor(leg: { pick: PickInput; game: DraftGame; player: DraftPlayer | null }) {
  if (leg.pick.teamId) return leg.pick.teamId;
  const abbreviation = leg.player?.team?.abbreviation.trim().toUpperCase();
  if (!abbreviation) return null;
  if (leg.game.home_team.trim().toUpperCase() === abbreviation)
    return leg.game.home_team_id ?? null;
  if (leg.game.away_team.trim().toUpperCase() === abbreviation)
    return leg.game.away_team_id ?? null;
  return null;
}

/**
 * The draft the Add a pick steps would have built for this leg, so the review, Back, and Edit
 * work exactly as for a pick entered by hand. Null when the draft would not save the same pick.
 */
export function draftFromImportedLeg(
  leg: Extract<ImportedLeg, { status: 'ready' }>,
): PickDraft | null {
  const { pick, game, player } = leg;
  const condition = pick.condition;
  const base: PickDraft = { ...EMPTY_DRAFT, game, teamId: teamIdFor(leg), player };
  const segment = 'segment' in condition ? (condition.segment ?? null) : null;
  const magnitude = 'line' in condition ? formatMagnitude(Math.abs(condition.line)) : '';
  let draft: PickDraft | null = null;

  switch (condition.type) {
    case 'MONEYLINE':
      draft = { ...base, kind: 'MONEYLINE' };
      break;
    case 'SPREAD': {
      const spreadRole = condition.line < 0 ? 'favorite' : 'underdog';
      draft =
        segment === null
          ? { ...base, kind: 'SPREAD', spreadRole, lineText: magnitude }
          : {
              ...base,
              kind: 'TEAM_PROP',
              teamMarket: 'SEGMENT_SPREAD',
              period: segment,
              spreadRole,
              lineText: magnitude,
            };
      break;
    }
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER':
      draft =
        segment === null
          ? {
              ...base,
              kind: 'TOTAL',
              totalRole: overUnderRole(condition.type),
              lineText: magnitude,
            }
          : {
              ...base,
              kind: 'TEAM_PROP',
              teamMarket: 'SEGMENT_TOTAL',
              period: segment,
              totalRole: overUnderRole(condition.type),
              lineText: magnitude,
            };
      break;
    case 'TEAM_TOTAL_OVER':
    case 'TEAM_TOTAL_UNDER':
      draft = {
        ...base,
        kind: 'TEAM_PROP',
        teamMarket: 'TEAM_TOTAL',
        period: segment,
        totalRole: overUnderRole(condition.type),
        lineText: magnitude,
      };
      break;
    case 'FG_OVER':
    case 'FG_UNDER':
      draft = {
        ...base,
        kind: 'TEAM_PROP',
        teamMarket: pick.teamId ? 'TEAM_FG' : 'GAME_FG',
        teamId: pick.teamId ?? null,
        period: segment,
        totalRole: overUnderRole(condition.type),
        lineText: magnitude,
      };
      break;
    case 'FIRST_TO_SCORE':
      draft = { ...base, kind: 'TEAM_PROP', teamMarket: 'FIRST_TO_SCORE', period: null };
      break;
    case 'STAT_OVER':
    case 'STAT_UNDER':
      draft = {
        ...base,
        kind: 'PLAYER_PROP',
        playerMarket: condition.stat as PlayerMarketKey,
        totalRole: overUnderRole(condition.type),
        lineText: magnitude,
      };
      break;
    case 'PLAYER_EVENT':
      draft = {
        ...base,
        kind: 'PLAYER_PROP',
        playerMarket: condition.event === 'ANY_TD' ? 'ANYTIME_TD' : 'FIRST_TD',
        eventSide: condition.side === 'YES' ? 'yes' : 'no',
      };
      break;
    default:
      draft = null;
  }
  if (draft === null) return null;
  const rebuilt = buildPickInput(draft);
  return rebuilt !== null && samePickInput(rebuilt, pick) ? draft : null;
}
