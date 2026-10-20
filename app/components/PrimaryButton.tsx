import {
  ActivityIndicator,
  Platform,
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
  const inactive = disabled && !loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        inactive && styles.disabled,
        inactive && Platform.OS === 'web' && styles.disabledCursor,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.onAccent} />
      ) : (
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          numberOfLines={2}
          style={[styles.label, labelStyle, inactive && styles.disabledLabel]}
        >
          {label}
        </Text>
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
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: theme.effects.panelBorderWidth,
  },
  disabledCursor: {
    cursor: 'not-allowed' as 'auto',
  },
  disabledLabel: {
    color: theme.colors.textTertiary,
  },
  label: {
    color: theme.colors.onAccent,
    fontSize: theme.type.button.size,
    fontWeight: theme.type.button.weight,
    textAlign: 'center',
    width: '100%',
  },
  pressed: {
    backgroundColor: theme.colors.accentPressed,
  },
});
