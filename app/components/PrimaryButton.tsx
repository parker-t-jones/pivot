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
  accessibilityLabel,
  style,
  labelStyle,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.onAccent} />
      ) : (
        <Text style={[styles.label, labelStyle]}>{label}</Text>
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
  label: {
    color: theme.colors.onAccent,
    fontSize: theme.type.button.size,
    fontWeight: theme.type.button.weight,
  },
  pressed: {
    backgroundColor: theme.colors.accentPressed,
  },
});
