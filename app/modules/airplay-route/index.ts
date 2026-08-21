import { requireOptionalNativeModule } from 'expo';

export interface AirPlayRouteSubscription {
  remove(): void;
}

/** Mirrors `AirPlayRouteModule.swift`'s definition. See that file for the semantics of each call. */
export interface AirPlayRouteNativeModule {
  isTargetAvailable(): boolean;
  activeRouteName(): string | null;
  presentRoutePicker(): Promise<boolean>;
  addListener(
    event: 'onTargetAvailabilityChange',
    listener: (payload: { available: boolean }) => void,
  ): AirPlayRouteSubscription;
}

/**
 * `null` wherever the native module isn't linked — Android, web, and any JS-only test environment.
 * Optional (rather than `requireNativeModule`) so importing this file can never throw: the
 * `AirPlayRouteController` boundary degrades to "no AirPlay target" instead of crashing playback
 * resolution.
 */
export const airPlayRouteNativeModule =
  requireOptionalNativeModule<AirPlayRouteNativeModule>('AirPlayRoute');
