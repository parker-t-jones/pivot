import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { isValidEmail } from '../../lib/email';
import { supabase } from '../../lib/supabase';
import { theme } from '../../lib/theme';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const onSignUp = async () => {
    if (!isValidEmail(trimmedEmail)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (password !== passwordConfirmation) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });

    if (signUpError) {
      setErrorMessage(signUpError.message);
      setIsSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (signInError) {
      setErrorMessage(signInError.message);
    }

    setIsSubmitting(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Sign up with email and password.</Text>

        <TextField
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          value={email}
        />

        <TextField
          autoCapitalize="none"
          autoComplete="password-new"
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          value={password}
        />

        <TextField
          autoCapitalize="none"
          autoComplete="password-new"
          onChangeText={setPasswordConfirmation}
          placeholder="Confirm password"
          secureTextEntry
          value={passwordConfirmation}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <PrimaryButton label="Sign up" loading={isSubmitting} onPress={onSignUp} />

        <Text style={styles.footerText}>
          Already have an account?{' '}
          <Link href="/(auth)/sign-in" style={styles.link}>
            Sign in
          </Link>
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: theme.spacing.md,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg2,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.type.small.size,
  },
  footerText: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.small.size,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  link: {
    color: theme.colors.accent,
    fontFamily: theme.type.button.fontFamily,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontFamily: theme.type.title.fontFamily,
  },
});
