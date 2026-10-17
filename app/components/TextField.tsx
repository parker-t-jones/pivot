import type { ReactNode, Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { TEXT_FIELD_RECIPE } from '../lib/controlRecipes';
import { theme } from '../lib/theme';

type TextFieldProps = TextInputProps & {
  ref?: Ref<TextInput>;
  /** Sits inside the field on the trailing edge. Omitted → the input is unchanged. */
  trailing?: ReactNode;
};

export function TextField({
  style,
  placeholderTextColor,
  trailing,
  ref,
  ...props
}: TextFieldProps) {
  const input = (
    <TextInput
      ref={ref}
      {...props}
      placeholderTextColor={placeholderTextColor ?? theme.colors.textTertiary}
      style={[styles.field, trailing != null && styles.fieldWithTrailing, style]}
    />
  );

  if (trailing == null) return input;

  return (
    <View style={styles.shell}>
      {input}
      <View style={styles.trailing}>{trailing}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: TEXT_FIELD_RECIPE,
  fieldWithTrailing: {
    paddingRight: theme.spacing.lg + 44,
  },
  shell: {
    justifyContent: 'center',
  },
  trailing: {
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
