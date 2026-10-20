import type { ReactNode, Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { TEXT_FIELD_RECIPE } from '../lib/controlRecipes';
import { theme } from '../lib/theme';

type TextFieldProps = TextInputProps & {
  ref?: Ref<TextInput>;
  /**
   * HTML `name` on web. react-native-web does not forward `name`, so the ref
   * callback sets it on the DOM input. Ignored on iOS.
   */
  name?: string;
  /** Sits inside the field on the trailing edge. Omitted → the input is unchanged. */
  trailing?: ReactNode;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  if (ref && typeof ref === 'object') {
    (ref as { current: T | null }).current = value;
  }
}

function applyDomName(node: TextInput | null, name: string | undefined) {
  if (!name || node == null) return;
  const element = node as unknown as { setAttribute?: (key: string, value: string) => void };
  if (typeof element.setAttribute === 'function') {
    element.setAttribute('name', name);
  }
}

export function TextField({
  style,
  placeholderTextColor,
  trailing,
  ref,
  name,
  ...props
}: TextFieldProps) {
  const input = (
    <TextInput
      ref={(node) => {
        assignRef(ref, node);
        applyDomName(node, name);
      }}
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
