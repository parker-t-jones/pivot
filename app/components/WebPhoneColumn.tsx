import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { theme } from '../lib/theme';

/** Phone-width column on web. Native returns children with no extra view. */
export function WebPhoneColumn({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') {
    return children;
  }

  return (
    <View style={styles.stage}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  column: {
    flex: 1,
    maxWidth: 420,
    width: '100%',
  },
});
