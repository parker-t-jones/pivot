const VAPID_VARS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

export interface VapidEnv {
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}

/** Names of the VAPID variables that are unset or empty. Empty means Web Push is on. */
export function missingVapidVars(source: VapidEnv): string[] {
  return VAPID_VARS.filter((name) => {
    const value = source[name];
    return value === undefined || value.trim() === '';
  });
}

export function webPushStatus(source: VapidEnv): 'enabled' | 'disabled' {
  return missingVapidVars(source).length === 0 ? 'enabled' : 'disabled';
}

/** One warning per missing variable. A complete set logs nothing. */
export function warnIfWebPushDisabled(
  source: VapidEnv,
  warn: (message: string) => void = console.warn,
): void {
  for (const name of missingVapidVars(source)) {
    warn(`Web Push disabled: missing ${name}`);
  }
}
