import { airPlayRouteNativeModule } from '../modules/airplay-route';
import { unavailableAirPlayRouteController, type AirPlayRouteController } from './airPlayRoute';

/**
 * Native-backed `AirPlayRouteController`. Isolated in its own file so the native import stays out of
 * `PlaybackSource.ts` / `switching.ts`, both of which are unit-tested outside a device runtime.
 *
 * Returns `unavailableAirPlayRouteController` when the module isn't linked (Android, web, JS tests),
 * so callers never branch on platform themselves.
 */
export function createAirPlayRouteController(): AirPlayRouteController {
  const native = airPlayRouteNativeModule;
  if (!native) return unavailableAirPlayRouteController;

  return {
    isTargetAvailable: () => native.isTargetAvailable(),
    activeRouteName: () => native.activeRouteName(),
    subscribe: (listener) => {
      const subscription = native.addListener('onTargetAvailabilityChange', ({ available }) =>
        listener(available),
      );
      return () => subscription.remove();
    },
    presentRoutePicker: () => native.presentRoutePicker(),
  };
}
