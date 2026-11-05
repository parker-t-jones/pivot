export type SubscriptionTier = 'free' | 'pro';

type Listener = () => void;

let serverTier: SubscriptionTier = 'free';
let localEntitlementActive = false;
const listeners = new Set<Listener>();

/** Settings copy. Local Pro wins until `GET /me` catches up after a purchase. */
export function settingsPlanLabel(
  server: SubscriptionTier,
  entitlementActive: boolean,
): 'Pro plan' | 'Free plan' {
  return server === 'pro' || entitlementActive ? 'Pro plan' : 'Free plan';
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function noteServerTier(tier: SubscriptionTier): void {
  if (tier === serverTier) return;
  serverTier = tier;
  emit();
}

/** RevenueCat `pro` entitlement on this device, before the webhook writes `users.subscription_tier`. */
export function noteLocalEntitlement(active: boolean): void {
  if (active === localEntitlementActive) return;
  localEntitlementActive = active;
  emit();
}

export function isLocalEntitlementActive(): boolean {
  return localEntitlementActive;
}

export function currentSettingsPlanLabel(): 'Pro plan' | 'Free plan' {
  return settingsPlanLabel(serverTier, localEntitlementActive);
}

export function subscribeSettingsPlan(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
