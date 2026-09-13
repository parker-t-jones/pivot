import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { FILLED_BUTTON_RECIPE } from '../lib/controlRecipes';
import { theme } from '../lib/theme';

interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
}: SecondaryButtonProps) {
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
        <ActivityIndicator color={theme.colors.textPrimary} />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    ...FILLED_BUTTON_RECIPE,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: theme.colors.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
  disabled: {
    opacity: theme.opacity.disabled,
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.button.size,
    fontFamily: theme.type.button.fontFamily,
  },
  pressed: {
    backgroundColor: theme.colors.accentMuted,
  },
});
