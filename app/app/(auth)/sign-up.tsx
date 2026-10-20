import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { AuthForm } from '../../components/AuthForm';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { isValidEmail } from '../../lib/email';
import { PASSWORD_FIELD_AUTOFILL } from '../../lib/passwordAutofill';
import {
  newPasswordIssue,
  newPasswordIssueMessage,
  PASSWORD_POLICY_HINT,
} from '../../lib/passwordPolicy';
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

    const issue = newPasswordIssue(password, passwordConfirmation);
    if (issue) {
      setErrorMessage(newPasswordIssueMessage(issue));
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
      <AuthForm
        onSubmit={() => {
          void onSignUp();
        }}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Sign up with email and password.</Text>

          <TextField
            {...PASSWORD_FIELD_AUTOFILL.signUp.email}
            onChangeText={setEmail}
            placeholder="Email"
            value={email}
          />

          <TextField
            {...PASSWORD_FIELD_AUTOFILL.signUp.password}
            onChangeText={setPassword}
            placeholder="Password"
            value={password}
          />
          <Text style={styles.hint}>{PASSWORD_POLICY_HINT}</Text>

          <TextField
            {...PASSWORD_FIELD_AUTOFILL.signUp.confirm}
            onChangeText={setPasswordConfirmation}
            placeholder="Confirm password"
            value={passwordConfirmation}
          />

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          <PrimaryButton
            label="Sign up"
            loading={isSubmitting}
            onPress={() => {
              void onSignUp();
            }}
          />

          <Text style={styles.footerText}>
            Already have an account?{' '}
            <Link href="/(auth)/sign-in" style={styles.link}>
              Sign in
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
  hint: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.small.size,
    marginTop: -theme.spacing.xs,
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
