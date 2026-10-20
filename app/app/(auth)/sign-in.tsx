import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { AuthForm } from '../../components/AuthForm';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { isValidEmail } from '../../lib/email';
import { PASSWORD_FIELD_AUTOFILL } from '../../lib/passwordAutofill';
import { supabase } from '../../lib/supabase';
import { theme } from '../../lib/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const onSignIn = async () => {
    if (!isValidEmail(trimmedEmail)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Password is required.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
    }

    setIsSubmitting(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.container}
    >
      <AuthForm
        onSubmit={() => {
          void onSignIn();
        }}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Access your Pivot account.</Text>

          <TextField
            {...PASSWORD_FIELD_AUTOFILL.signIn.email}
            onChangeText={setEmail}
            placeholder="Email"
            value={email}
          />

          <TextField
            {...PASSWORD_FIELD_AUTOFILL.signIn.password}
            onChangeText={setPassword}
            placeholder="Password"
            value={password}
          />

          <Link href="/(auth)/forgot-password" style={styles.link}>
            Forgot password?
          </Link>

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          <PrimaryButton
            label="Sign in"
            loading={isSubmitting}
            onPress={() => {
              void onSignIn();
            }}
          />

          <Text style={styles.footerText}>
            Need an account?{' '}
            <Link href="/(auth)/sign-up" style={styles.link}>
              Sign up
            </Link>
          </Text>
        </View>
      </AuthForm>
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
    fontWeight: theme.type.button.weight,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
