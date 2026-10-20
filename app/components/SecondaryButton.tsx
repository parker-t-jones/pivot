import {
  ActivityIndicator,
  Platform,
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
  /** Muted second line under the label. */
  caption?: string | null;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function SecondaryButton({
  label,
  caption = null,
  onPress,
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
}: SecondaryButtonProps) {
  const isDisabled = disabled || loading;
  const inactive = disabled && !loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? (caption ? `${label}, ${caption}` : label)}
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
        <ActivityIndicator color={theme.colors.textPrimary} />
      ) : (
        <>
          <Text style={[styles.label, inactive && styles.disabledLabel]}>{label}</Text>
          {caption ? (
            <Text style={[styles.caption, inactive && styles.disabledLabel]}>{caption}</Text>
          ) : null}
        </>
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
  caption: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
  disabled: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  disabledCursor: {
    cursor: 'not-allowed' as 'auto',
  },
  disabledLabel: {
    color: theme.colors.textTertiary,
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.button.size,
    fontWeight: theme.type.button.weight,
  },
  pressed: {
    backgroundColor: theme.colors.accentMuted,
  },
});
