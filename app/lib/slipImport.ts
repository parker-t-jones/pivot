import { ApiRequestError, apiClient } from './apiClient';
import { formatMagnitude } from './addPickLine';
import {
  EMPTY_DRAFT,
  buildPickInput,
  pickInputLabel,
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

export type ImportedBetType = 'single' | 'parlay';

/** One separate bet on the screenshot, with its legs in printed order. */
export interface ImportedBet {
  bet_type: ImportedBetType;
  legs: ImportedLeg[];
}

export interface SlipImportResult {
  /** Every leg across all bets, flat, as the original contract returns it. */
  kind: ImportedBetType;
  legs: ImportedLeg[];
  imports_left: number;
  /** Present when the API supports multi-bet import: the legs grouped per bet. */
  bets?: ImportedBet[];
  /** The API wasn't sure how the screenshot splits into bets: preselect nothing. */
  review?: boolean;
}

/**
 * Tells the API this client can review several bets from one screenshot. A query parameter on
 * purpose: an API without multi-bet import ignores it (a body field would be refused, and a
 * custom header would fail the web CORS preflight), and then answers with the original contract.
 */
export const SLIP_IMPORT_PATH = '/picks/import?multi_bet=v1';

/** A leg Pivot could not match. The user adds it by hand or dismisses it. */
export interface FlaggedLeg {
  key: string;
  text: string;
  reason: string;
}

/** Sends one screenshot (base64 or a data URL). Nothing is saved until the user saves the pick. */
export async function importSlip(image: string): Promise<SlipImportResult> {
  return await apiClient.post<SlipImportResult>(SLIP_IMPORT_PATH, { image });
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

/**
 * Goes to the multi-bet review (bets grouped under headers) instead of the one-bet flow: the
 * screenshot has several bets, or the API asked for a leg-by-leg check. An answer without `bets`
 * (an older API) always takes the one-bet flow.
 */
export function isMultiBetImport(result: SlipImportResult): boolean {
  return result.bets !== undefined && (result.bets.length > 1 || result.review === true);
}

/** A leg the user can choose in the multi-bet review. */
export interface ImportChoiceLeg {
  key: string;
  /** The pick as Pivot labels it, e.g. "SF ML". */
  label: string;
  /** The leg as the slip printed it. */
  printed: string;
  input: PickInput;
}

export interface ImportBetChoice {
  key: string;
  bet_type: ImportedBetType;
  /** Legs on the slip, ready or not, for the header's count. */
  legCount: number;
  legs: ImportChoiceLeg[];
  flagged: FlaggedLeg[];
}

/**
 * The multi-bet review's model. Ready legs whose draft would not save the same pick are flagged,
 * as in the one-bet flow. `nextKey` makes keys unique across imports.
 */
export function importBetChoices(
  bets: readonly ImportedBet[],
  nextKey: () => string,
): ImportBetChoice[] {
  return bets.map((bet) => {
    const legs: ImportChoiceLeg[] = [];
    const flagged: FlaggedLeg[] = [];
    for (const leg of bet.legs) {
      const key = nextKey();
      if (leg.status === 'flagged') {
        flagged.push({ key, text: leg.text, reason: leg.reason });
      } else if (draftFromImportedLeg(leg) === null) {
        flagged.push({ key, text: leg.text, reason: IMPORT_EDIT_REASON });
      } else {
        legs.push({
          key,
          label: pickInputLabel(leg.pick, leg.game, leg.player),
          printed: leg.text,
          input: leg.pick,
        });
      }
    }
    return { key: nextKey(), bet_type: bet.bet_type, legCount: bet.legs.length, legs, flagged };
  });
}

/** "Bet 1 · Parlay · 3 legs", "Bet 2 · Single". */
export function importBetHeader(
  index: number,
  bet: Pick<ImportBetChoice, 'bet_type' | 'legCount'>,
) {
  return bet.bet_type === 'parlay'
    ? `Bet ${index + 1} · Parlay · ${bet.legCount} legs`
    : `Bet ${index + 1} · Single`;
}

/** Every ready leg's key, in order. */
export function importChoiceKeys(bets: readonly ImportBetChoice[]): string[] {
  return bets.flatMap((bet) => bet.legs.map((leg) => leg.key));
}

/**
 * What to preselect: everything when the user can save it all (Pro, or enough free picks left)
 * and the API is sure of the grouping; otherwise nothing, so the user chooses each leg.
 */
export function initialImportSelection(
  bets: readonly ImportBetChoice[],
  freeLeft: number | null,
  review: boolean,
): string[] {
  const keys = importChoiceKeys(bets);
  if (review) return [];
  if (freeLeft !== null && keys.length > freeLeft) return [];
  return keys;
}

export type ImportSave =
  | { kind: 'pick'; betKey: string; input: PickInput }
  | { kind: 'slip'; betKey: string; inputs: PickInput[] };

/**
 * One save per bet with any selected leg: a single pick for one leg, a parlay slip for two or
 * more. Each leg uses one pick toward the free cap, whichever bet it is in.
 */
export function planImportSaves(
  bets: readonly ImportBetChoice[],
  selected: readonly string[],
): ImportSave[] {
  const chosen = new Set(selected);
  return bets.flatMap((bet): ImportSave[] => {
    const inputs = bet.legs.filter((leg) => chosen.has(leg.key)).map((leg) => leg.input);
    const [only] = inputs;
    if (only === undefined) return [];
    if (inputs.length === 1) return [{ kind: 'pick', betKey: bet.key, input: only }];
    return [{ kind: 'slip', betKey: bet.key, inputs }];
  });
}
