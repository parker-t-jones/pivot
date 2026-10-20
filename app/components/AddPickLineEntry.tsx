import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  formatMagnitude,
  lineBaseline,
  lineBounds,
  type SpreadRole,
  type TotalRole,
} from '../lib/addPickLine';
import { theme } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';
import { SegmentedControl } from './SegmentedControl';
import { TextField } from './TextField';

export function AddPickLineEntry({
  kind,
  role,
  magnitude,
  readout,
  error,
  canContinue,
  onRole,
  onMagnitude,
  onStep,
  onContinue,
}: {
  kind: 'SPREAD' | 'TOTAL';
  role: SpreadRole | TotalRole | null;
  magnitude: string;
  readout: string | null;
  error: string | null;
  canContinue: boolean;
  onRole: (role: SpreadRole | TotalRole) => void;
  onMagnitude: (value: string) => void;
  onStep: (direction: 1 | -1) => void;
  onContinue: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const bounds = lineBounds(kind);
  const parsed = Number(magnitude);
  const hasValue = magnitude.trim().length > 0 && Number.isFinite(parsed);
  const atMin = hasValue && parsed <= bounds.min;
  const atMax = hasValue && parsed >= bounds.max;
  const segments =
    kind === 'SPREAD'
      ? [
          { key: 'favorite', label: 'Favorite' },
          { key: 'underdog', label: 'Underdog' },
        ]
      : [
          { key: 'over', label: 'Over' },
          { key: 'under', label: 'Under' },
        ];

  return (
    <View style={styles.stack} testID="add-pick-line">
      <SegmentedControl
        onChange={(key) => onRole(key as SpreadRole | TotalRole)}
        segments={segments}
        value={role ?? ''}
      />
      <View style={styles.stepper}>
        <Pressable
          accessibilityLabel="Decrease line by 0.5"
          accessibilityRole="button"
          accessibilityState={{ disabled: atMin }}
          disabled={atMin}
          onPress={() => onStep(-1)}
          style={[styles.step, atMin && styles.stepDisabled]}
          testID="add-pick-step-down"
        >
          <Text style={styles.stepLabel}>−0.5</Text>
        </Pressable>
        <TextField
          keyboardType="decimal-pad"
          onBlur={() => setFocused(false)}
          onChangeText={onMagnitude}
          onFocus={() => setFocused(true)}
          placeholder={focused ? '' : formatMagnitude(lineBaseline(kind))}
          style={styles.field}
          testID="add-pick-line-field"
          value={magnitude}
        />
        <Pressable
          accessibilityLabel="Increase line by 0.5"
          accessibilityRole="button"
          accessibilityState={{ disabled: atMax }}
          disabled={atMax}
          onPress={() => onStep(1)}
          style={[styles.step, atMax && styles.stepDisabled]}
          testID="add-pick-step-up"
        >
          <Text style={styles.stepLabel}>+0.5</Text>
        </Pressable>
      </View>
      {readout ? (
        <Text style={styles.readout} testID="add-pick-line-readout">
          {readout}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton disabled={!canContinue} label="Continue" onPress={onContinue} />
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    color: theme.colors.danger,
    fontSize: theme.type.body.size,
  },
  field: {
    flex: 1,
  },
  readout: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  stack: {
    gap: theme.spacing.md,
  },
  step: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    borderWidth: theme.effects.panelBorderWidth,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: theme.spacing.sm,
  },
  stepDisabled: {
    opacity: theme.opacity.disabled,
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  stepLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
  },
});
