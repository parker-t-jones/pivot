import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { AuthForm } from '../../components/AuthForm';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { isValidEmail } from '../../lib/email';
import { PASSWORD_FIELD_AUTOFILL } from '../../lib/passwordAutofill';
import {
  classifyResetEmailError,
  passwordResetRedirectTo,
  resendCooldownRemaining,
  resetEmailOutcomeMessage,
} from '../../lib/passwordReset';
import { supabase } from '../../lib/supabase';
import { theme } from '../../lib/theme';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const trimmedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const cooldown = resendCooldownRemaining(sentAt, now);

  useEffect(() => {
    if (sentAt == null || cooldown === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldown, sentAt]);

  const onSend = async () => {
    if (!isValidEmail(trimmedEmail)) {
      setSentMessage(null);
      setErrorMessage('Enter a valid email address.');
      return;
    }
    if (cooldown > 0) return;

    setErrorMessage(null);
    setSentMessage(null);
    setIsSubmitting(true);

    const redirectTo = passwordResetRedirectTo({
      platform: Platform.OS,
      locationOrigin: typeof window === 'undefined' ? null : window.location.origin,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    });

    let outcome: ReturnType<typeof classifyResetEmailError>;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo });
      const status =
        error && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
      outcome = classifyResetEmailError(
        error ? { message: error.message, ...(status !== undefined ? { status } : {}) } : null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network request failed';
      outcome = classifyResetEmailError({ message });
    }

    const copy = resetEmailOutcomeMessage(outcome);
    if (outcome === 'sent') {
      setSentMessage(copy);
      setSentAt(Date.now());
    } else {
      setErrorMessage(copy);
      if (outcome === 'rate_limit') setSentAt(Date.now());
    }
    setIsSubmitting(false);
  };

  const label =
    sentAt == null ? 'Send reset link' : cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend';

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.container}
    >
      <AuthForm
        onSubmit={() => {
          void onSend();
        }}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Reset password</Text>
          <Text style={styles.subtitle}>We’ll email you a link to choose a new password.</Text>

          <TextField
            {...PASSWORD_FIELD_AUTOFILL.forgot.email}
            onChangeText={setEmail}
            placeholder="Email"
            value={email}
          />

          {sentMessage ? <Text style={styles.sent}>{sentMessage}</Text> : null}
          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          <PrimaryButton
            disabled={cooldown > 0}
            label={label}
            loading={isSubmitting}
            onPress={() => {
              void onSend();
            }}
          />

          <Text style={styles.footerText}>
            <Link href="/(auth)/sign-in" style={styles.link}>
              Back to sign in
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
  sent: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
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
