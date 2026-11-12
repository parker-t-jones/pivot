import type { TeamMarketKey } from './pickMarkets';

export type PickKind =
  | 'SPREAD'
  | 'TOTAL'
  | 'MONEYLINE'
  | 'PLAYER_PROP'
  | 'TEAM_PROP'
  | 'PARLAY'
  | 'SURVIVOR';

/** A kind that can be a parlay leg. Survivor is a pool pick, and a parlay can't nest. */
export type LegKind = Exclude<PickKind, 'SURVIVOR' | 'PARLAY'>;

/** `legs` is the parlay's own screen: the legs so far, Add a leg, and Save. */
export type PickStep = 'type' | 'player' | 'market' | 'game' | 'line' | 'confirm' | 'legs';

export const PICK_KIND_COPY: readonly {
  kind: PickKind;
  label: string;
  explainer: string;
}[] = [
  { kind: 'SPREAD', label: 'Spread', explainer: 'Pick a team to cover the line' },
  { kind: 'TOTAL', label: 'Total', explainer: 'Over or under the combined score' },
  { kind: 'MONEYLINE', label: 'Moneyline', explainer: 'Pick the winner' },
  {
    kind: 'PLAYER_PROP',
    label: 'Player prop',
    explainer: 'Over or under a player stat, or a touchdown scorer',
  },
  {
    kind: 'TEAM_PROP',
    label: 'Team & game props',
    explainer: 'Team totals, quarters and halves, first to score, field goals',
  },
  {
    kind: 'PARLAY',
    label: 'Parlay',
    explainer: 'Two or more picks saved as one (uses one free bet)',
  },
  {
    kind: 'SURVIVOR',
    label: 'Survivor',
    explainer: "Your weekly survivor pool pick (doesn't use a free bet)",
  },
];

/** The type list inside a parlay: every kind that can be a leg. */
export const LEG_KIND_COPY = PICK_KIND_COPY.filter(
  (option) => option.kind !== 'SURVIVOR' && option.kind !== 'PARLAY',
);

export function isLegKind(kind: PickKind): kind is LegKind {
  return kind !== 'SURVIVOR' && kind !== 'PARLAY';
}

/** Every bet spends a free bet, each parlay leg uses one. Survivor does not. */
const CAPPED_KINDS = new Set<PickKind>([
  'SPREAD',
  'TOTAL',
  'MONEYLINE',
  'PLAYER_PROP',
  'TEAM_PROP',
  'PARLAY',
]);

/** Bets can be added on a game in progress (live bets). A survivor pick can't. */
export function kindAllowsLive(kind: PickKind | null): boolean {
  return kind !== null && kind !== 'SURVIVOR';
}

export type PickKindAccess = 'open' | 'upgrade';

export function pickKindAccess(
  kind: PickKind,
  allowance: { isPro: boolean; freeLeft: number | null },
): PickKindAccess {
  if (!CAPPED_KINDS.has(kind)) return 'open';
  if (allowance.isPro || allowance.freeLeft == null) return 'open';
  return allowance.freeLeft > 0 ? 'open' : 'upgrade';
}

/**
 * The side is chosen on the game row, so there is no team step.
 * A player prop takes its game from the player. Before a type is chosen the eyebrow does not
 * show a total.
 */
export function pickSteps(
  kind: PickKind | null,
  teamMarket: TeamMarketKey | null = null,
): readonly PickStep[] {
  switch (kind) {
    case 'MONEYLINE':
    case 'SURVIVOR':
      return ['type', 'game', 'confirm'];
    case 'PLAYER_PROP':
      return ['type', 'player', 'market', 'line', 'confirm'];
    case 'TEAM_PROP':
      return teamMarket === 'FIRST_TO_SCORE'
        ? ['type', 'market', 'game', 'confirm']
        : ['type', 'market', 'game', 'line', 'confirm'];
    case 'PARLAY':
      return ['type', 'legs'];
    default:
      return ['type', 'game', 'line', 'confirm'];
  }
}

const KIND_EYEBROW: Record<PickKind, string> = {
  SPREAD: 'SPREAD',
  TOTAL: 'TOTAL',
  MONEYLINE: 'MONEYLINE',
  PLAYER_PROP: 'PLAYER PROP',
  TEAM_PROP: 'TEAM & GAME PROP',
  PARLAY: 'PARLAY',
  SURVIVOR: 'SURVIVOR',
};

/**
 * `parlayLeg` is the 1-based leg being built inside a parlay. On the parlay's own screen the
 * eyebrow names the parlay without a step.
 */
export function addPickEyebrow(
  kind: PickKind | null,
  step: PickStep,
  options: { teamMarket?: TeamMarketKey | null; parlayLeg?: number | null } = {},
): string {
  const leg = options.parlayLeg ?? null;
  if (step === 'legs') return 'ADD A PICK · PARLAY';
  const prefix = leg === null ? 'ADD A PICK' : `ADD A PICK · PARLAY · LEG ${leg}`;
  if (kind == null) return leg === null ? `${prefix} · STEP 1` : prefix;
  const steps = pickSteps(kind, options.teamMarket ?? null);
  const index = Math.max(1, steps.indexOf(step) + 1);
  const name = leg === null ? `${KIND_EYEBROW[kind]} · ` : '';
  return `${prefix} · ${name}STEP ${index} OF ${steps.length}`;
}

export function addPickSlipPickLabel(kind: PickKind | null): 'PICK' | 'TEAM' {
  return kind === 'SURVIVOR' ? 'TEAM' : 'PICK';
}

/** The PICK or TEAM value, once that step has something to show. Null stays a placeholder. */
export function addPickSlipPickText(input: {
  kind: PickKind | null;
  team: string;
  totalSide: 'TOTAL_OVER' | 'TOTAL_UNDER';
  lineOk: boolean;
  lineText: string;
  lineInput: string;
}): string | null {
  if (input.kind === 'TOTAL') {
    if (!input.lineOk || input.lineText.trim().length === 0) return null;
    const side = input.totalSide === 'TOTAL_OVER' ? 'Over' : 'Under';
    return `${side} ${input.lineInput}`;
  }
  if (input.team.length === 0) return null;
  if (input.kind === 'SPREAD') {
    if (!input.lineOk || input.lineText.trim().length === 0) return null;
    const signed = input.lineInput.startsWith('-')
      ? `\u2212${input.lineInput.slice(1)}`
      : input.lineInput;
    return `${input.team} ${signed}`;
  }
  if (input.kind === 'MONEYLINE' || input.kind === 'SURVIVOR') return input.team;
  return null;
}
