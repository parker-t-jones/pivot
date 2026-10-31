import { StyleSheet, Text } from 'react-native';

import { theme } from '../lib/theme';

export const DEMO_EDITING_BANNER = 'Demo account: editing is off so the live game stays in place';

export function DemoEditingBanner() {
  return <Text style={styles.banner}>{DEMO_EDITING_BANNER}</Text>;
}

const styles = StyleSheet.create({
  banner: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
});
