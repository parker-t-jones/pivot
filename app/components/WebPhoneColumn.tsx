import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { theme } from '../lib/theme';

/** Full window on web. Native returns children with no extra view. */
export function WebPhoneColumn({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') {
    return children;
  }

  return <View style={styles.stage}>{children}</View>;
}

const styles = StyleSheet.create({
  stage: {
    backgroundColor: theme.colors.background,
    flex: 1,
    width: '100%',
  },
});
