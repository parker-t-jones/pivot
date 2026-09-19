import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { FILLED_BUTTON_RECIPE } from '../lib/controlRecipes';
import { theme } from '../lib/theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Border fill + primary text — Now Active when no broadcast can be opened. */
  inactive?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Optional label override (e.g. type-trial face on Now Active CTA). */
  labelStyle?: StyleProp<TextStyle>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  inactive = false,
  accessibilityLabel,
  style,
  labelStyle,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading || inactive;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        inactive && styles.inactive,
        !inactive && isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={inactive ? theme.colors.textPrimary : theme.colors.onAccent} />
      ) : (
        <Text style={[styles.label, inactive && styles.inactiveLabel, labelStyle]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    ...FILLED_BUTTON_RECIPE,
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    justifyContent: 'center',
  },
  disabled: {
    opacity: theme.opacity.disabled,
  },
  inactive: {
    backgroundColor: theme.colors.border,
  },
  inactiveLabel: {
    color: theme.colors.textPrimary,
  },
  label: {
    color: theme.colors.onAccent,
    fontSize: theme.type.button.size,
    fontWeight: theme.type.button.weight,
  },
  pressed: {
    backgroundColor: theme.colors.accentPressed,
  },
});
