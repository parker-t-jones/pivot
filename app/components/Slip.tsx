import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { theme } from '../lib/theme';

interface SlipProps {
  children: ReactNode;
  /** Modal-specific overrides (e.g. paywall maxHeight / padding / width) — not part of the surface recipe. */
  style?: StyleProp<ViewStyle>;
  /**
   * When provided, render a `Pressable` so the slip can block backdrop taps (UpgradeSheet passes
   * `onPress={() => {}}`). Otherwise a plain `View`.
   */
  onPress?: () => void;
  /**
   * Optional offset drop shadow for floating slips. Defaults off so the paywall (panelGlow only)
   * has no visual change.
   */
  elevated?: boolean;
}

/**
 * Floating surface shared by the Pro paywall (U1), tutorial cards (U5), and Watchlist week card
 * (U7). Surface recipe lifted from `UpgradeSheet`'s former `card` style — background, accent
 * stroke, radius, panelGlow. Perforation is U5 (`SlipPerforation`), not here.
 */
export function Slip({ children, style, onPress, elevated = false }: SlipProps) {
  const surfaceStyle = [styles.surface, elevated && styles.elevated, style];

  if (onPress !== undefined) {
    return (
      <Pressable onPress={onPress} style={surfaceStyle}>
        {children}
      </Pressable>
    );
  }

  return <View style={surfaceStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    ...theme.effects.panelGlow,
  },
  elevated: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
});
