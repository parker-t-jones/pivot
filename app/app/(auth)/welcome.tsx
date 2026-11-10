import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { consumeAccountNotFoundNotice } from '../../lib/accountNotFoundNotice';
import { theme } from '../../lib/theme';

/** PLAN.md Section 10 onboarding step 1 ("Welcome — value prop, 'Get started' CTA"). Sprint 9 Phase
 *  2 addition — this codebase had no unauthenticated landing screen at all before now; `app/index.tsx`
 *  went straight to sign-in (see report). */
export default function WelcomeScreen() {
  const router = useRouter();
  // Issue #46: `_layout.tsx`'s auth redirect lands here right after `apiClient.ts` clears a
  // session it found belonged to a deleted account. `useState`'s initializer runs once, on
  // first render, which both reads and clears the notice — so it shows exactly this one time.
  const [accountNotFoundMessage] = useState(() => consumeAccountNotFoundNotice());

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Pivot</Text>
        <Text style={styles.title}>Never miss your fantasy player&apos;s big moment</Text>
        {accountNotFoundMessage ? (
          <Text style={styles.notice}>{accountNotFoundMessage}</Text>
        ) : null}
        <Text style={styles.body}>
          We watch every game your fantasy players are in and tell you exactly when to switch —
          before the play happens, not after.
        </Text>

        <PrimaryButton
          label="Get started"
          onPress={() => router.push('/(auth)/sign-up')}
          style={styles.button}
        />

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
    fontSize: theme.type.button.size,
    lineHeight: theme.type.button.lineHeight,
  },
  button: {
    marginTop: theme.spacing.sm,
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
    fontSize: theme.type.small.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  footerText: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.small.size,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  link: {
    color: theme.colors.accent,
    fontWeight: theme.type.smallStrong.weight,
  },
  notice: {
    color: theme.colors.danger,
    fontSize: theme.type.small.size,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
