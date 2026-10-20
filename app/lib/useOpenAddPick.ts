import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { openAddPick } from './addPickDrawer';
import { useDesktopTier } from './useDesktopTier';

/** Wide web keeps the current screen up. Every narrower window uses the full-screen route. */
export function useOpenAddPick(): () => void {
  const router = useRouter();
  const tier = useDesktopTier();
  return useCallback(() => {
    if (tier === 'wide') {
      openAddPick();
      return;
    }
    router.push('/(app)/add-stake');
  }, [router, tier]);
}
