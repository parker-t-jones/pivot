import type { ManualStakeType } from './stakes';

export type PickKind = 'SPREAD' | 'TOTAL' | 'MONEYLINE' | 'SURVIVOR';
export type PickStep = 'type' | 'game' | 'line' | 'confirm';

export const PICK_KIND_COPY: readonly {
  kind: PickKind;
  label: string;
  explainer: string;
}[] = [
  { kind: 'SPREAD', label: 'Spread', explainer: 'Pick a team to cover the line' },
  { kind: 'TOTAL', label: 'Total', explainer: 'Over or under the combined score' },
  { kind: 'MONEYLINE', label: 'Moneyline', explainer: 'Pick the winner' },
  {
    kind: 'SURVIVOR',
    label: 'Survivor',
    explainer: "Your weekly survivor pool pick (doesn't use a free bet)",
  },
];

/** Spread, total, and moneyline spend a free bet. Survivor does not. */
const CAPPED_KINDS = new Set<PickKind>(['SPREAD', 'TOTAL', 'MONEYLINE']);

export type PickKindAccess = 'open' | 'upgrade';

export function pickKindAccess(
  kind: PickKind,
  allowance: { isPro: boolean; freeLeft: number | null },
): PickKindAccess {
  if (!CAPPED_KINDS.has(kind)) return 'open';
  if (allowance.isPro || allowance.freeLeft == null) return 'open';
  return allowance.freeLeft > 0 ? 'open' : 'upgrade';
}

export function stakeTypeForKind(
  kind: PickKind,
  totalSide: 'TOTAL_OVER' | 'TOTAL_UNDER',
): ManualStakeType {
  return kind === 'TOTAL' ? totalSide : kind;
}

export function pickNeedsTeam(kind: PickKind): boolean {
  return kind !== 'TOTAL';
}

export function pickNeedsLine(kind: PickKind): boolean {
  return kind === 'SPREAD' || kind === 'TOTAL';
}

/**
 * The side is chosen on the game row, so there is no team step.
 * Spread is the long path. Before a type is chosen the eyebrow does not show a total.
 */
export function pickSteps(kind: PickKind | null): readonly PickStep[] {
  if (kind === 'MONEYLINE' || kind === 'SURVIVOR') return ['type', 'game', 'confirm'];
  return ['type', 'game', 'line', 'confirm'];
}

export function addPickEyebrow(kind: PickKind | null, step: PickStep): string {
  if (kind == null) return 'ADD A PICK · STEP 1';
  const steps = pickSteps(kind);
  const index = Math.max(1, steps.indexOf(step) + 1);
  return `ADD A PICK · ${kind} · STEP ${index} OF ${steps.length}`;
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
