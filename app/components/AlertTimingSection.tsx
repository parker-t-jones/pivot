import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { UserService } from '@pivot/shared/broadcast';

import {
  ALERT_TIMING_HINT,
  formatAlertDelay,
  formatServiceDelay,
  stepDefaultDelay,
  stepServiceDelay,
  type AlertTiming,
} from '../lib/alertTiming';
import type { AlertTimingPatch } from '../lib/me';
import { userServiceLabel } from '../lib/streamingServices';
import { theme } from '../lib/theme';
import { SecondaryButton } from './SecondaryButton';

interface AlertTimingSectionProps {
  alertTiming: AlertTiming;
  /** Subscribed services, in picker order. Each gets its own override row. */
  services: readonly UserService[];
  editsLocked: boolean;
  onChange: (patch: AlertTimingPatch) => Promise<void>;
  onError: (error: unknown) => void;
}

/**
 * Settings → Alert timing (issue #8). One default for every service, then an override per
 * subscribed service. Delays only: the lowest setting is On time.
 */
export function AlertTimingSection({
  alertTiming,
  services,
  editsLocked,
  onChange,
  onError,
}: AlertTimingSectionProps) {
  const [isSaving, setIsSaving] = useState(false);
  const locked = isSaving || editsLocked;

  const save = async (patch: AlertTimingPatch) => {
    setIsSaving(true);
    try {
      await onChange(patch);
    } catch (error) {
      onError(error);
    } finally {
      setIsSaving(false);
    }
  };

  const defaultSeconds = alertTiming.defaultDelaySeconds;

  return (
    <View style={styles.body}>
      <Text style={styles.hint}>{ALERT_TIMING_HINT}</Text>
      <DelayStepper
        label="Send alerts"
        value={formatAlertDelay(defaultSeconds)}
        locked={locked}
        canDecrease={defaultSeconds > 0}
        canIncrease={stepDefaultDelay(defaultSeconds, 1) !== defaultSeconds}
        onStep={(direction) => {
          void save({ defaultDelaySeconds: stepDefaultDelay(defaultSeconds, direction) });
        }}
      />
      {services.length > 0 ? <Text style={styles.subhead}>By streaming service</Text> : null}
      {services.map((service) => {
        const seconds = alertTiming.serviceDelaySeconds[service] ?? null;
        return (
          <DelayStepper
            key={service}
            label={userServiceLabel(service)}
            value={formatServiceDelay(seconds)}
            locked={locked}
            canDecrease={seconds !== null}
            canIncrease={stepServiceDelay(seconds, 1) !== seconds}
            onStep={(direction) => {
              void save({
                serviceDelaySeconds: { [service]: stepServiceDelay(seconds, direction) },
              });
            }}
          />
        );
      })}
    </View>
  );
}

function DelayStepper({
  label,
  value,
  locked,
  canDecrease,
  canIncrease,
  onStep,
}: {
  label: string;
  value: string;
  locked: boolean;
  canDecrease: boolean;
  canIncrease: boolean;
  onStep: (direction: 1 | -1) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.labels}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} accessibilityLiveRegion="polite">
          {value}
        </Text>
      </View>
      <View style={styles.buttons}>
        <SecondaryButton
          accessibilityLabel={`${label}: less delay`}
          disabled={locked || !canDecrease}
          label="−"
          onPress={() => onStep(-1)}
          style={styles.stepButton}
        />
        <SecondaryButton
          accessibilityLabel={`${label}: more delay`}
          disabled={locked || !canIncrease}
          label="+"
          onPress={() => onStep(1)}
          style={styles.stepButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: theme.spacing.xs,
  },
  buttons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  hint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    marginBottom: theme.spacing.xs,
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.button.weight,
  },
  labels: {
    flex: 1,
    flexShrink: 1,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  stepButton: {
    minWidth: theme.spacing.huge,
  },
  subhead: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
    marginTop: theme.spacing.sm,
  },
  value: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
    marginTop: theme.spacing.xs,
  },
});
