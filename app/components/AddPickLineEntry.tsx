import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMagnitude } from '../lib/addPickLine';
import type { LineConfig, LineRoleSet } from '../lib/pickDraft';
import { PERIOD_LABEL, periodFromKey, periodKey, type Period } from '../lib/pickMarkets';
import { theme } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { TextField } from './TextField';

const ROLE_SEGMENTS: Record<LineRoleSet, SegmentOption[]> = {
  spread: [
    { key: 'favorite', label: 'Favorite' },
    { key: 'underdog', label: 'Underdog' },
  ],
  overUnder: [
    { key: 'over', label: 'Over' },
    { key: 'under', label: 'Under' },
  ],
  yesNo: [
    { key: 'yes', label: 'Yes' },
    { key: 'no', label: 'No' },
  ],
};

/**
 * Period (quarter or half, where the market has one), then the side, then the number with
 * ±0.5 steppers. An empty field shows the baseline as a placeholder and steps from it.
 */
export function AddPickLineEntry({
  config,
  period,
  magnitude,
  readout,
  error,
  canContinue,
  onPeriod,
  onRole,
  onMagnitude,
  onStep,
  onContinue,
}: {
  config: LineConfig;
  period?: Period | undefined;
  magnitude: string;
  readout: string | null;
  error: string | null;
  canContinue: boolean;
  onPeriod?: (period: Period) => void;
  onRole: (role: string) => void;
  onMagnitude: (value: string) => void;
  onStep: (direction: 1 | -1) => void;
  onContinue: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const stepper = config.stepper;
  const parsed = Number(magnitude);
  const hasValue = magnitude.trim().length > 0 && Number.isFinite(parsed);
  const atMin = stepper !== null && hasValue && parsed <= stepper.bounds.min;
  const atMax = stepper !== null && hasValue && parsed >= stepper.bounds.max;

  return (
    <View style={styles.stack} testID="add-pick-line">
      {config.periods !== null ? (
        <SegmentedControl
          onChange={(key) => onPeriod?.(periodFromKey(key))}
          segments={config.periods.map((option) => ({
            key: periodKey(option),
            label: PERIOD_LABEL[periodKey(option)],
          }))}
          value={period === undefined ? '' : periodKey(period)}
        />
      ) : null}
      <SegmentedControl
        onChange={onRole}
        segments={ROLE_SEGMENTS[config.roleSet]}
        value={config.role ?? ''}
      />
      {stepper !== null ? (
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
            placeholder={focused ? '' : formatMagnitude(stepper.baseline)}
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
      ) : null}
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
    // Web inputs keep a default intrinsic width; without this the +0.5 button overflows at 390.
    minWidth: 0,
  },
  readout: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  stack: {
    gap: theme.spacing.lg,
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
