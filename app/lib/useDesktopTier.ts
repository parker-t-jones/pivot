import { Platform, useWindowDimensions } from 'react-native';

import { desktopTier, type DesktopTier } from './desktopLayout';

/**
 * Web width tier. On iOS and Android this is always `companion`, so a shared screen that
 * branches on it renders the phone tree. The width subscription does not change that tree.
 */
export function useDesktopTier(): DesktopTier {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return 'companion';
  return desktopTier(width);
}
