/**
 * Session-scoped "user closed gate-forced connect" flag for the zero-leagues gate.
 *
 * Must be readable **synchronously** in the same turn as Close → navigate. React `useState`
 * alone loses a race: `router.replace` updates expo-router (external store) and can re-render
 * the gate with stale `connectDeferred === false` before the state update commits — Home
 * flashes, then the gate bounces back to connect-team.
 *
 * Module scope also survives a LeaguesGateProvider remount within the same JS session.
 * Force-quit clears it with the JS context (cold start re-prompts). Not AsyncStorage.
 */

let connectDeferred = false;

export function deferConnectForSession(): void {
  connectDeferred = true;
}

export function isConnectDeferredForSession(): boolean {
  return connectDeferred;
}

export function clearConnectDeferredForSession(): void {
  connectDeferred = false;
}

/** Test-only — reset between cases. */
export function resetConnectDeferredForSessionForTests(): void {
  connectDeferred = false;
}
