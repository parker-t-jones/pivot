import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../components/ErrorState';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextButton } from '../../components/TextButton';
import { ApiRequestError } from '../../lib/apiClient';
import { setAppPresence } from '../../lib/me';
import {
  STREAMING_SERVICES,
  streamingServiceLabel,
  type StreamingService,
} from '../../lib/streamingServices';
import { theme } from '../../lib/theme';

/** PLAN.md Section 10 onboarding step 4 ("Streaming services — multi-select grid, persists to
 *  `user_app_presence`"). Next: notifications-permission → all-set (Sprint 10 Phase 4). Settings'
 *  own "Streaming services" section is the same data for later edits. */
export default function OnboardingStreamingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
      router.replace('/(app)/notifications-permission?onboarding=1');
    } catch (error) {
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not save.');
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.spacing.huge, paddingBottom: theme.spacing.huge },
      ]}
    >
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
              style={({ pressed }) => [
                styles.block,
                isSelected && styles.blockSelected,
                pressed && styles.blockPressed,
              ]}
            >
              <Text style={[styles.blockText, isSelected && styles.blockTextSelected]}>
                {streamingServiceLabel(service)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {errorMessage ? <ErrorState message={errorMessage} /> : null}

      <PrimaryButton
        disabled={isSaving}
        label="Continue"
        loading={isSaving}
        onPress={onContinue}
        style={styles.continue}
      />
      <TextButton
        disabled={isSaving}
        hitArea="padding"
        label="Skip for now"
        onPress={() => router.replace('/(app)/notifications-permission?onboarding=1')}
        size="small"
        style={styles.skip}
        tone="muted"
        underline
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /** UI-SPEC.md §7: larger block variant replacing the old pill chips. Unselected = `surface`
   *  fill + muted text (standing in for the brief's "muted icon" — this repo has no icon system,
   *  see AUDIT-UI-POLISH.md §4.3); selected = 2px `accentBorder` wrap + `textPrimary` text. */
  block: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: 'transparent',
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth * 2,
    minWidth: '47%',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
  },
  blockPressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  blockSelected: {
    borderColor: theme.colors.accentBorder,
  },
  blockText: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  blockTextSelected: {
    color: theme.colors.textPrimary,
  },
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
  },
  continue: {
    marginTop: theme.spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  skip: {
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
