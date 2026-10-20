import type { ManualStakeType } from './stakes';

export type PickKind = 'SPREAD' | 'TOTAL' | 'MONEYLINE' | 'SURVIVOR';
export type PickStep = 'type' | 'game' | 'team' | 'line' | 'confirm';

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

/** Spread is the long path, used before a type is chosen so the eyebrow still has a count. */
export function pickSteps(kind: PickKind | null): readonly PickStep[] {
  if (kind === 'TOTAL') return ['type', 'game', 'line', 'confirm'];
  if (kind === 'MONEYLINE' || kind === 'SURVIVOR') return ['type', 'game', 'team', 'confirm'];
  return ['type', 'game', 'team', 'line', 'confirm'];
}

export function addPickEyebrow(kind: PickKind | null, step: PickStep): string {
  const steps = pickSteps(kind);
  const index = Math.max(1, steps.indexOf(step) + 1);
  const progress = `STEP ${index} OF ${steps.length}`;
  if (kind == null) return `ADD A PICK · ${progress}`;
  return `ADD A PICK · ${kind} · ${progress}`;
}

export function addPickSlipLines(input: {
  kindLabel: string | null;
  gameLabel: string | null;
  sideLabel: string | null;
}): string[] {
  return [input.kindLabel, input.gameLabel, input.sideLabel].filter(
    (line): line is string => line != null && line.length > 0,
  );
}
