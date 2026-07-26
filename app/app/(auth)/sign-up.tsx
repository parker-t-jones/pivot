import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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

        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={theme.colors.textTertiary}
          style={styles.input}
          value={email}
        />

        <TextInput
          autoCapitalize="none"
          autoComplete="password-new"
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={theme.colors.textTertiary}
          secureTextEntry
          style={styles.input}
          value={password}
        />

        <TextInput
          autoCapitalize="none"
          autoComplete="password-new"
          onChangeText={setPasswordConfirmation}
          placeholder="Confirm password"
          placeholderTextColor={theme.colors.textTertiary}
          secureTextEntry
          style={styles.input}
          value={passwordConfirmation}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Pressable disabled={isSubmitting} onPress={onSignUp} style={styles.button}>
          {isSubmitting ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text style={styles.buttonText}>Sign up</Text>
          )}
        </Pressable>

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
  button: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.sm,
    paddingVertical: theme.spacing.md,
  },
  buttonText: {
    color: theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    gap: theme.spacing.md,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  error: {
    color: theme.colors.danger,
    fontSize: 14,
  },
  footerText: {
    color: theme.colors.textTertiary,
    fontSize: 14,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    borderWidth: 1,
    color: theme.colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
  },
  link: {
    color: theme.colors.accent,
    fontWeight: '600',
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
