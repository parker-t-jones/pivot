import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { TEXT_BUTTON_HIT_SLOP } from '../lib/controlRecipes';
import { theme } from '../lib/theme';

type TextButtonTone = 'accent' | 'muted' | 'danger';
type TextButtonSize = 'button' | 'small' | 'smallStrong';

interface TextButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: TextButtonTone;
  size?: TextButtonSize;
  underline?: boolean;
  /** `slop` keeps layout tight (headers, action rows). `padding` uses a visible 44pt min height. */
  hitArea?: 'slop' | 'padding';
  accessibilityRole?: 'button' | 'link';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export function TextButton({
  label,
  onPress,
  disabled = false,
  tone = 'accent',
  size = 'button',
  underline = false,
  hitArea = 'slop',
  accessibilityRole = 'button',
  accessibilityLabel,
  style,
  labelStyle,
}: TextButtonProps) {
  const type = theme.type[size];

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      hitSlop={hitArea === 'slop' ? TEXT_BUTTON_HIT_SLOP : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        hitArea === 'padding' && styles.padded,
        disabled && styles.disabled,
        pressed && !disabled && tone === 'danger' && styles.dangerPressed,
        style,
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            {
              color: toneColor(tone),
              fontSize: type.size,
              fontWeight: type.weight,
            },
            underline && styles.underline,
            pressed && !disabled && tone === 'accent' && styles.accentPressed,
            pressed && !disabled && tone === 'muted' && styles.mutedPressed,
            labelStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function toneColor(tone: TextButtonTone): string {
  switch (tone) {
    case 'danger':
      return theme.colors.danger;
    case 'muted':
      return theme.colors.textSecondary;
    case 'accent':
      return theme.colors.accent;
  }
}

const styles = StyleSheet.create({
  accentPressed: {
    color: theme.colors.accentPressed,
  },
  dangerPressed: {
    opacity: theme.opacity.disabled,
  },
  disabled: {
    opacity: theme.opacity.disabled,
  },
  mutedPressed: {
    color: theme.colors.textPrimary,
  },
  padded: {
    justifyContent: 'center',
    minHeight: 44,
  },
  underline: {
    textDecorationLine: 'underline',
  },
});
