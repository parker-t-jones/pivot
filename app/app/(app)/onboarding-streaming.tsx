import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErrorState } from '../../components/ErrorState';
import { ApiRequestError } from '../../lib/apiClient';
import { setAppPresence } from '../../lib/me';
import { STREAMING_SERVICES, streamingServiceLabel, type StreamingService } from '../../lib/streamingServices';
import { theme } from '../../lib/theme';

/** PLAN.md Section 10 onboarding step 4 ("Streaming services — multi-select grid, persists to
 *  `user_app_presence`"). Reached only from `connect-team.tsx`'s onboarding chain (see that file's
 *  docstring) — Settings' own "Streaming services" section is the same data, for whenever a user
 *  wants to revisit it later. */
export default function OnboardingStreamingScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<StreamingService>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggle = (service: StreamingService) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });
  };

  const onContinue = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (selected.size > 0) {
        await setAppPresence(
          STREAMING_SERVICES.map((service) => ({
            service,
            has_subscription: selected.has(service),
          })),
        );
      }
      router.replace('/(app)/onboarding-all-set');
    } catch (error) {
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not save.');
      setIsSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Which streaming services do you have?</Text>
      <Text style={styles.subtitle}>
        We&apos;ll recommend the service you already pay for, whenever there&apos;s a choice.
      </Text>

      <View style={styles.grid}>
        {STREAMING_SERVICES.map((service) => {
          const isSelected = selected.has(service);
          return (
            <Pressable
              key={service}
              onPress={() => toggle(service)}
              style={[styles.chip, isSelected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {streamingServiceLabel(service)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {errorMessage ? <ErrorState message={errorMessage} /> : null}

      <Pressable disabled={isSaving} onPress={onContinue} style={styles.primaryButton}>
        {isSaving ? (
          <ActivityIndicator color={theme.colors.onAccent} />
        ) : (
          <Text style={styles.primaryButtonText}>Continue</Text>
        )}
      </Pressable>
      <Pressable disabled={isSaving} onPress={() => router.replace('/(app)/onboarding-all-set')}>
        <Text style={styles.skipText}>Skip for now</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
  },
  chipSelected: {
    backgroundColor: theme.colors.accent,
  },
  chipText: {
    color: theme.colors.textTertiary,
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: theme.colors.onAccent,
  },
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 48,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: 10,
    marginTop: theme.spacing.md,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  skipText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
