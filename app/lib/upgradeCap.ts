/** Free-tier caps that open the paywall. `upgradePrompt.ts` matches this list. */
export const UPGRADE_CAP_CODES = [
  'league_limit_free',
  'manual_lineup_limit_free',
  'stake_limit_free',
] as const;

export function isUpgradeCapCode(code: string): boolean {
  return (UPGRADE_CAP_CODES as readonly string[]).includes(code);
}

/** Shown above the paywall headline. Only the weekly bet cap has one. */
export function upgradeContextLine(code: string | null | undefined): string | null {
  if (code === 'stake_limit_free') return "You've tracked 3 bets this week.";
  return null;
}
