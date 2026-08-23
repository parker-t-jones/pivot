import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../lib/theme';

/** PLAN.md Section 10 onboarding step 1 ("Welcome — value prop, 'Get started' CTA"). Sprint 9 Phase
 *  2 addition — this codebase had no unauthenticated landing screen at all before now; `app/index.tsx`
 *  went straight to sign-in (see report). */
export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Pivot</Text>
        <Text style={styles.title}>Never miss your fantasy player&apos;s big moment</Text>
        <Text style={styles.body}>
          We watch every game your fantasy players are in and tell you exactly when to switch —
          before the play happens, not after.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(auth)/sign-up')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Get started</Text>
        </Pressable>

        <Text style={styles.footerText}>
          Already have an account?{' '}
          <Link href="/(auth)/sign-in" style={styles.link}>
            Sign in
          </Link>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 23,
  },
  button: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.sm,
    marginTop: theme.spacing.sm,
    paddingVertical: 14,
  },
  buttonText: {
    color: theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  card: {
    gap: theme.spacing.lg,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  footerText: {
    color: theme.colors.textTertiary,
    fontSize: 14,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  link: {
    color: theme.colors.accent,
    fontWeight: '600',
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
