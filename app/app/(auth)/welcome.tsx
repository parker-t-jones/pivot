import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** PLAN.md Section 10 onboarding step 1 ("Welcome — value prop, 'Get started' CTA"). Sprint 9 Phase
 *  2 addition — this codebase had no unauthenticated landing screen at all before now; `app/index.tsx`
 *  went straight to sign-in (see report). */
export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Fantasy Focus</Text>
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
    color: '#555',
    fontSize: 16,
    lineHeight: 23,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 8,
    marginTop: 8,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  card: {
    gap: 16,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  eyebrow: {
    color: '#0A66FF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  footerText: {
    color: '#444',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  link: {
    color: '#0A66FF',
    fontWeight: '600',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
  },
});
