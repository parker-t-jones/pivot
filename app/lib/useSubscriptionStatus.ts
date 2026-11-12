import { useEffect, useState } from 'react';
import { fetchMe } from './me';
import {
  currentPlanStatus,
  isLocalEntitlementActive,
  subscribeSettingsPlan,
} from './subscriptionPlan';

const RETRY_MS = 5_000;

/** Shared by Settings and the Upgrade sheet; retries stop with the activation window. */
export function useSubscriptionStatus(enabled = true) {
  const [, render] = useState(0);
  const status = currentPlanStatus();
  useEffect(() => subscribeSettingsPlan(() => render((value) => value + 1)), []);
  useEffect(() => {
    if (!enabled || status !== 'activating') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const retry = async () => {
      try {
        await fetchMe();
      } catch {
        // The bounded activation window still expires if the network is unavailable.
      }
      if (!cancelled && currentPlanStatus() === 'activating') timer = setTimeout(retry, RETRY_MS);
    };
    void retry();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, status]);
  return { status, entitlementActive: isLocalEntitlementActive() };
}
