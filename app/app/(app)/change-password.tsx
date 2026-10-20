import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { AuthForm } from '../../components/AuthForm';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { TextField } from '../../components/TextField';
import { useSession } from '../../contexts/SessionContext';
import {
  changePasswordAfterLock,
  classifyBiometricError,
  classifyPasswordChangeError,
  deviceLockLevel,
  passwordChangeErrorMessage,
  type DeviceLockLevel,
} from '../../lib/changePassword';
import { PASSWORD_FIELD_AUTOFILL } from '../../lib/passwordAutofill';
import {
  newPasswordIssue,
  newPasswordIssueMessage,
  PASSWORD_POLICY_HINT,
} from '../../lib/passwordPolicy';
import { PASSWORD_UPDATED } from '../../lib/passwordReset';
import { supabase } from '../../lib/supabase';
import { theme } from '../../lib/theme';

const FACE_ID_PROMPT = "Confirm it's you before changing your password.";

type Phase = 'locking' | 'current-password' | 'new-password' | 'cancelled';

async function promptForDeviceLock(enrolled: DeviceLockLevel): Promise<Phase> {
  if (enrolled === 'none') return 'current-password';
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: FACE_ID_PROMPT,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use Passcode',
    disableDeviceFallback: false,
  });
  const biometric = result.success ? 'success' : classifyBiometricError(result.error);
  return changePasswordAfterLock({ platform: Platform.OS, lock: enrolled, biometric });
}

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { user } = useSession();
  const [phase, setPhase] = useState<Phase>(Platform.OS === 'web' ? 'current-password' : 'locking');
  const [lock, setLock] = useState<DeviceLockLevel>('none');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    void LocalAuthentication.getEnrolledLevelAsync()
      .then((level) => {
        if (cancelled) return;
        const enrolled = deviceLockLevel(level);
        setLock(enrolled);
        return promptForDeviceLock(enrolled).then((next) => {
          if (!cancelled) setPhase(next);
        });
      })
      .catch(() => {
        if (!cancelled) setPhase('current-password');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fail = (message: string, code?: string) => {
    const failure = classifyPasswordChangeError(message, code);
    setErrorMessage(passwordChangeErrorMessage(failure, message));
  };

  const onVerifyCurrent = async () => {
    const email = user?.email;
    if (!email) {
      setErrorMessage('Could not read the email on this account.');
      return;
    }
    if (!currentPassword) {
      setErrorMessage('Current password is required.');
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (error) {
        fail(error.message);
        return;
      }
      setPhase('new-password');
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Network request failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSave = async () => {
    const issue = newPasswordIssue(password, confirmation);
    if (issue) {
      setErrorMessage(newPasswordIssueMessage(issue));
      return;
    }
    setErrorMessage(null);
    setSaved(false);
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        fail(error.message, error.code);
        return;
      }
      setPassword('');
      setConfirmation('');
      setSaved(true);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Network request failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Change password</Text>

        {phase === 'locking' ? <Text style={styles.subtitle}>Confirming it's you...</Text> : null}

        {phase === 'cancelled' ? (
          <>
            <Text style={styles.subtitle}>
              {lock === 'passcode' ? 'Passcode cancelled.' : 'Face ID cancelled.'}
            </Text>
            <SecondaryButton
              label="Try again"
              onPress={() => {
                setErrorMessage(null);
                setPhase('locking');
                void promptForDeviceLock(lock).then(setPhase);
              }}
            />
          </>
        ) : null}

        {phase === 'current-password' ? (
          <AuthForm
            onSubmit={() => {
              void onVerifyCurrent();
            }}
          >
            <View style={styles.card}>
              <Text style={styles.subtitle}>Enter your current password to continue.</Text>
              {user?.email ? (
                <TextField
                  {...PASSWORD_FIELD_AUTOFILL.signIn.email}
                  editable={false}
                  value={user.email}
                />
              ) : null}
              <TextField
                {...PASSWORD_FIELD_AUTOFILL.change.current}
                onChangeText={setCurrentPassword}
                placeholder="Current password"
                value={currentPassword}
              />
              {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
              <PrimaryButton
                label="Continue"
                loading={isSubmitting}
                onPress={() => {
                  void onVerifyCurrent();
                }}
              />
            </View>
          </AuthForm>
        ) : null}

        {phase === 'new-password' ? (
          <AuthForm
            onSubmit={() => {
              void onSave();
            }}
          >
            <View style={styles.card}>
              <Text style={styles.hint}>{PASSWORD_POLICY_HINT}</Text>
              {user?.email ? (
                <TextField
                  {...PASSWORD_FIELD_AUTOFILL.signIn.email}
                  editable={false}
                  value={user.email}
                />
              ) : null}
              <TextField
                {...PASSWORD_FIELD_AUTOFILL.change.password}
                onChangeText={setPassword}
                placeholder="New password"
                value={password}
              />
              <TextField
                {...PASSWORD_FIELD_AUTOFILL.change.confirm}
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

        <SecondaryButton
          label="Back"
          onPress={() => {
            router.back();
          }}
        />
      </View>

      {saved ? (
        <View accessibilityRole="alert" style={styles.toast}>
          <Text style={styles.toastText}>{PASSWORD_UPDATED}</Text>
        </View>
      ) : null}
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
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
  toast: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.pill,
    borderWidth: theme.effects.panelBorderWidth,
    bottom: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    position: 'absolute',
  },
  toastText: {
    color: theme.colors.success,
    fontSize: theme.type.small.size,
    fontWeight: theme.type.button.weight,
  },
});
