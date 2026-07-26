import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../lib/theme';

/** PLAN.md Section 10 onboarding step 6 ("All set — confirmation, CTA into the app"). Last stop in
 *  the chain `connect-team.tsx` kicks off for a brand-new signup. */
export default function OnboardingAllSetScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>You&apos;re all set</Text>
        <Text style={styles.body}>
          We&apos;re watching every game your players are in. We&apos;ll notify you the moment one
          of them takes the field in a big spot.
        </Text>
        <Pressable onPress={() => router.replace('/(app)')} style={styles.button}>
          <Text style={styles.buttonText}>Go to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.body.weight,
    lineHeight: 21,
  },
  button: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: 10,
    marginTop: theme.spacing.md,
    paddingVertical: 14,
  },
  buttonText: {
    color: theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  card: {
    gap: 14,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
