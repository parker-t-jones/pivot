import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { TEXT_FIELD_RECIPE } from '../lib/controlRecipes';
import { theme } from '../lib/theme';

export function TextField({ style, placeholderTextColor, ...props }: TextInputProps) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={placeholderTextColor ?? theme.colors.textTertiary}
      style={[styles.field, style]}
    />
  );
}

const styles = StyleSheet.create({
  field: TEXT_FIELD_RECIPE,
});
