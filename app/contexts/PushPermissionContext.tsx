import * as Notifications from 'expo-notifications';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { registerForPushNotificationsAsync } from '../lib/pushNotifications';
import { useSession } from './SessionContext';

/** `'checking'` is this context's own loading state (reading the OS permission on mount) — distinct
 *  from `Notifications.PermissionStatus`'s three real values, which is exactly what gates Sprint 6
 *  Phase 5's pre-permission screen (`'undetermined'` only — see `(app)/_layout.tsx`). */
type PushPermissionStatus = 'checking' | Notifications.PermissionStatus;

interface PushPermissionContextValue {
  status: PushPermissionStatus;
  /** Shows the iOS system prompt (only call this from user-initiated intent — PLAN.md Section 10
   *  step 5 — never on cold start with no user context), then registers the token if granted. */
  requestAndRegister: () => Promise<void>;
}

const PushPermissionContext = createContext<PushPermissionContextValue | undefined>(undefined);

/**
 * Sprint 6 Phase 5. Tracks the OS notification-permission status for the `(app)` group's redirect
 * gate (undetermined -> pre-permission screen) and owns triggering registration — both the explicit
 * user-initiated flow (`requestAndRegister`, from the pre-permission screen's CTA) and the silent
 * background one for a device that was already granted in a previous session (decision #3's
 * SecureStore cache is what keeps that second case a no-op most of the time).
 *
 * Scoped to the `(app)` group (mounted in `(app)/_layout.tsx`, nested inside `SessionProvider`) —
 * permission is only meaningful once there's a signed-in user to register a token for.
 */
export function PushPermissionProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const [status, setStatus] = useState<PushPermissionStatus>('checking');

  const registerInBackground = useCallback(async () => {
    if (!user) return;
    try {
      await registerForPushNotificationsAsync(user.id);
    } catch (error) {
      console.warn('[push] registration failed', error);
    }
  }, [user]);

  useEffect(() => {
    let isMounted = true;

    Notifications.getPermissionsAsync()
      .then(({ status: osStatus }) => {
        if (!isMounted) return;
        setStatus(osStatus);
        if (osStatus === 'granted') {
          void registerInBackground();
        }
      })
      .catch((error: unknown) => {
        console.warn('[push] failed to read notification permission status', error);
        if (isMounted) setStatus(Notifications.PermissionStatus.DENIED);
      });

    return () => {
      isMounted = false;
    };
  }, [registerInBackground]);

  const requestAndRegister = useCallback(async () => {
    const { status: osStatus } = await Notifications.requestPermissionsAsync();
    setStatus(osStatus);
    if (osStatus === 'granted') {
      await registerInBackground();
    }
  }, [registerInBackground]);

  const value = useMemo<PushPermissionContextValue>(
    () => ({ status, requestAndRegister }),
    [status, requestAndRegister],
  );

  return <PushPermissionContext.Provider value={value}>{children}</PushPermissionContext.Provider>;
}

export function usePushPermission() {
  const value = useContext(PushPermissionContext);
  if (!value) {
    throw new Error('usePushPermission must be used within PushPermissionProvider');
  }
  return value;
}
