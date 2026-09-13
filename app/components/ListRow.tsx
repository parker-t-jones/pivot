import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { LIST_ROW_RECIPE } from '../lib/controlRecipes';
import { theme } from '../lib/theme';

interface ListRowProps {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Shared tappable/static surface row — connect-team league options, PlayerPicker search hits,
 * and the switching overlay's alternate-broadcast rows.
 */
export function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
  disabled = false,
  style,
}: ListRowProps) {
  const body = (
    <>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && !disabled && styles.pressed, style]}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={[styles.row, style]}>{body}</View>;
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    flexShrink: 1,
  },
  pressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  row: {
    ...LIST_ROW_RECIPE,
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'space-between',
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    fontFamily: theme.type.button.fontFamily,
  },
});
