/**
 * The AirPlay boundary (PLAN.md Section 2, "Swap-ready architecture principle") — `AirPlayPlaybackSource`
 * depends on this interface, never on the native module, so the source stays unit-testable and a
 * different route implementation is a local change.
 *
 * Deliberately free of native imports: `PlaybackSource.ts` imports this file, and both are covered by
 * plain (non-device) tests. The native-backed implementation lives in `airPlayRouteNative.ts`.
 */
export interface AirPlayRouteController {
  /** Whether iOS currently discovers at least one AirPlay target. Synchronous snapshot, so `canPlay`
   *  can stay synchronous; the value changes over time, hence `subscribe`. */
  isTargetAvailable(): boolean;
  /** Display name of the active AirPlay output, or `null` when audio isn't routed to one. Intended for
   *  Section 10's "Cast to {target}" CTA copy. */
  activeRouteName(): string | null;
  /** Fires on availability changes. Returns an unsubscribe function. */
  subscribe(listener: (available: boolean) => void): () => void;
  /** Presents the system AirPlay picker. Resolves when the sheet was presented, not when the user has
   *  chosen — iOS exposes no completion for the choice itself. */
  presentRoutePicker(): Promise<boolean>;
}

/**
 * Stands in wherever AirPlay cannot exist: Simulator-only JS tests, Android, web, or a build where the
 * native module isn't linked. Reports "no target", which makes `AirPlayPlaybackSource.canPlay` false and
 * lets `resolvePlaybackSource` fall through to deep-link exactly as it did before Sprint 8.
 */
export const unavailableAirPlayRouteController: AirPlayRouteController = {
  isTargetAvailable: () => false,
  activeRouteName: () => null,
  subscribe: () => () => {
    // Availability never changes here, so nothing was ever attached to detach.
  },
  presentRoutePicker: async () => false,
};
