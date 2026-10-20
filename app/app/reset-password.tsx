import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { AuthForm } from '../components/AuthForm';
import { PrimaryButton } from '../components/PrimaryButton';
import { TextField } from '../components/TextField';
import { useSession } from '../contexts/SessionContext';
import { PASSWORD_FIELD_AUTOFILL } from '../lib/passwordAutofill';
import { classifyPasswordChangeError, passwordChangeErrorMessage } from '../lib/changePassword';
import {
  newPasswordIssue,
  newPasswordIssueMessage,
  PASSWORD_POLICY_HINT,
} from '../lib/passwordPolicy';
import {
  clearRecoveryAttempt,
  consumeRecoverySession,
  markRecoveryReady,
  PASSWORD_UPDATED,
  PASSWORD_UPDATED_OTHER_DEVICE,
  readRecoveryAttempt,
  recoveryUrlWithoutHash,
  RESET_LINK_INVALID,
  type RecoveryStorage,
} from '../lib/passwordReset';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

type Phase = 'checking' | 'invalid' | 'form' | 'updated';

function browserStorage(): RecoveryStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Recovery tokens and error fragments must not stay in the address bar. */
function stripRecoveryHash(): void {
  if (typeof window === 'undefined' || window.location.hash.length === 0) return;
  window.history.replaceState(
    window.history.state,
    '',
    recoveryUrlWithoutHash(window.location.href),
  );
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { user } = useSession();
  const tokens = useRef<{ accessToken: string; refreshToken: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const storage = browserStorage();
    if (!storage || typeof window === 'undefined') {
      setPhase('invalid');
      return;
    }
    const attempt = readRecoveryAttempt(window.location.href, storage);
    if (attempt.phase === 'invalid') {
      stripRecoveryHash();
      setPhase('invalid');
      return;
    }
    if (attempt.phase === 'form') {
      setPhase('form');
      return;
    }
    tokens.current = { accessToken: attempt.accessToken, refreshToken: attempt.refreshToken };
    let cancelled = false;
    void consumeRecoverySession(tokens.current, (next) => supabase.auth.setSession(next)).then(
      (ok) => {
        if (cancelled) return;
        if (!ok) {
          clearRecoveryAttempt(storage);
          stripRecoveryHash();
          setPhase('invalid');
          return;
        }
        markRecoveryReady(storage);
        stripRecoveryHash();
        setPhase('form');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    const issue = newPasswordIssue(password, confirmation);
    if (issue) {
      setErrorMessage(newPasswordIssueMessage(issue));
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);
    if (error) {
      const failure = classifyPasswordChangeError(error.message, error.code);
      setErrorMessage(passwordChangeErrorMessage(failure, error.message));
      return;
    }
    const storage = browserStorage();
    if (storage) clearRecoveryAttempt(storage);
    setPhase('updated');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.container}
    >
      <View style={styles.card}>
        {phase === 'checking' ? (
          <Text style={styles.subtitle}>Checking your reset link…</Text>
        ) : null}

        {phase === 'invalid' ? (
          <>
            <Text style={styles.title}>Link expired</Text>
            <Text style={styles.subtitle}>{RESET_LINK_INVALID}</Text>
            <Link href="/(auth)/forgot-password" style={styles.link}>
              Send a new link
            </Link>
          </>
        ) : null}

        {phase === 'form' ? (
          <AuthForm
            onSubmit={() => {
              void onSave();
            }}
          >
            <View style={styles.card}>
              <Text style={styles.title}>Choose a new password</Text>
              <Text style={styles.hint}>{PASSWORD_POLICY_HINT}</Text>
              {user?.email ? (
                <TextField
                  {...PASSWORD_FIELD_AUTOFILL.signIn.email}
                  editable={false}
                  value={user.email}
                />
              ) : null}
              <TextField
                {...PASSWORD_FIELD_AUTOFILL.reset.password}
                onChangeText={setPassword}
                placeholder="New password"
                value={password}
              />
              <TextField
                {...PASSWORD_FIELD_AUTOFILL.reset.confirm}
                onChangeText={setConfirmation}
                placeholder="Confirm password"
                value={confirmation}
              />
              {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
              <PrimaryButton
                label="Update password"
                loading={isSubmitting}
                onPress={() => {
                  void onSave();
                }}
              />
            </View>
          </AuthForm>
        ) : null}

        {phase === 'updated' ? (
          <>
            <Text style={styles.title}>{PASSWORD_UPDATED}</Text>
            <Text style={styles.subtitle}>{PASSWORD_UPDATED_OTHER_DEVICE}</Text>
            <PrimaryButton
              label="Continue"
              onPress={() => {
                router.replace('/(app)');
              }}
            />
          </>
        ) : null}
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
  hint: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.small.size,
  },
  link: {
    color: theme.colors.accent,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.button.weight,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
