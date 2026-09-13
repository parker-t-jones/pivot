import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { resetToHomeRoot } from '../../lib/navigateAfterConnect';
import { theme } from '../../lib/theme';

/** PLAN.md Section 10 onboarding step 6 ("All set — confirmation, CTA into the app"). */
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
        <PrimaryButton
          label="Go to Home"
          onPress={() => resetToHomeRoot(router)}
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    fontFamily: theme.type.body.fontFamily,
    lineHeight: theme.type.body.lineHeight,
  },
  button: {
    marginTop: theme.spacing.md,
  },
  card: {
    gap: theme.spacing.md2,
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
    fontFamily: theme.type.title.fontFamily,
  },
});
