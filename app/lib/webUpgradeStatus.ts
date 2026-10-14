/** Read-only Pro line for the web upgrade sheet. There is no web purchase. */
export function webUpgradeStatus(isPro: boolean): string {
  return isPro ? "You're on Pro" : 'Pivot Pro is available in the iOS app';
}
