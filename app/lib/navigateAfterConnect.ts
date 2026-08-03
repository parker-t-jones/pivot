/**
 * Sprint 10 Phase 4 — shared post-connect navigation for onboarding vs Settings entry points.
 *
 * - Onboarding: continue the Section 10 chain (streaming next).
 * - Settings / non-onboarding: dismiss the full stack so Home is root (fixes Settings-stays-mounted).
 */

export interface ConnectNavRouter {
  replace: (href: '/(app)/onboarding-streaming' | '/(app)' | string) => void;
  dismissTo: (href: '/(app)' | string) => void;
}

export function navigateAfterConnect(
  router: ConnectNavRouter,
  options: { onboarding: boolean },
): void {
  if (options.onboarding) {
    router.replace('/(app)/onboarding-streaming');
    return;
  }

  resetToHomeRoot(router);
}

/** Pop everything above Home (or replace to Home if already root). */
export function resetToHomeRoot(router: ConnectNavRouter): void {
  // dismissTo pops back to an existing Home entry when present; otherwise replaces.
  router.dismissTo('/(app)');
}
