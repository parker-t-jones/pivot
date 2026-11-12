export type SubscriptionTier = 'free' | 'pro';

type Listener = () => void;

let serverTier: SubscriptionTier = 'free';
let localEntitlementActive = false;
export const ACTIVATION_WINDOW_MS = 3 * 60 * 1000;
let activationUntil = 0;
let activationTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<Listener>();

/** Only the server tier grants Pro. */
export function settingsPlanLabel(server: SubscriptionTier): 'Pro plan' | 'Free plan' {
  return server === 'pro' ? 'Pro plan' : 'Free plan';
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function noteServerTier(tier: SubscriptionTier): void {
  if (tier === 'pro') clearActivation();
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
  return settingsPlanLabel(serverTier);
}

export function subscribeSettingsPlan(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called only after a successful purchase or restore with an active entitlement. */
export function startActivation(): void {
  clearTimeout(activationTimer);
  activationUntil = Date.now() + ACTIVATION_WINDOW_MS;
  activationTimer = setTimeout(clearActivation, ACTIVATION_WINDOW_MS);
  emit();
}

export function clearActivation(): void {
  clearTimeout(activationTimer);
  activationUntil = 0;
  emit();
}

export function isActivatingPro(): boolean {
  return serverTier !== 'pro' && Date.now() < activationUntil;
}

export function currentPlanStatus(): 'pro' | 'activating' | 'free' {
  return serverTier === 'pro' ? 'pro' : isActivatingPro() ? 'activating' : 'free';
}
