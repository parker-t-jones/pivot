import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UserService } from '@pivot/shared/broadcast';

import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { SecondaryButton } from '../../../components/SecondaryButton';
import { TextButton } from '../../../components/TextButton';
import { usePushPermission } from '../../../contexts/PushPermissionContext';
import { useSession } from '../../../contexts/SessionContext';
import { useUpgradeSheet } from '../../../contexts/UpgradeSheetContext';
import { ApiRequestError } from '../../../lib/apiClient';
import { alertAsync, confirmAsync } from '../../../lib/confirm';
import { desktopAlertCopy, lastDesktopAlertState } from '../../../lib/desktopAlerts';
import { clearRememberedWatchlist } from '../../../lib/lineupLoading';
import { readAlertSoundEnabled, writeAlertSoundEnabled } from '../../../lib/inTabAlerts';
import {
  NotificationsDisabledError,
  scheduleTestFlagNotificationAsync,
} from '../../../lib/devNotifications';
import {
  deleteAccount,
  fetchMe,
  patchPreferences,
  setAppPresence,
  type MeResponse,
} from '../../../lib/me';
import { requestWeekGamesRefresh } from '../../../lib/weekGamesRefresh';
import { unregisterPushNotificationsAsync } from '../../../lib/pushNotifications';
import { revokeDesktopAlerts } from '../../../lib/webPush';
import {
  PAY_TV_SIGN_IN_COPY,
  showsPayTvSignInCopy,
  showsSundayTicketHint,
  USER_SERVICE_OPTIONS,
  userServiceLabel,
} from '../../../lib/streamingServices';
import { supabase } from '../../../lib/supabase';
import { theme } from '../../../lib/theme';
import { useDesktopTier } from '../../../lib/useDesktopTier';
import { webPressState } from '../../../lib/webPress';

const NOTIFICATION_MODES: {
  value: MeResponse['preferences']['notificationMode'];
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'high_leverage_only', label: 'High-leverage only' },
  { value: 'off', label: 'Off' },
];

const SUPPORT_EMAIL = 'support@pivot-sports.app';
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
const PRIVACY_POLICY_URL = 'https://pivot-sports.app/privacy';
const TERMS_OF_SERVICE_URL = 'https://pivot-sports.app/terms';

const SETTINGS_SECTIONS = [
  { key: 'account', label: 'Account' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'streaming', label: 'Streaming' },
  { key: 'about', label: 'About' },
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['key'];

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;

function openExternalUrl(url: string, failedMessage: string): void {
  void Linking.openURL(url).catch(() => {
    void alertAsync('Could not open', failedMessage);
  });
}

/**
 * PLAN.md §10 Settings tab — Account / Notifications / Streaming / About only.
 * Leagues, star players, and Edit lineup live on the Lineup tab.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const desktopTier = useDesktopTier();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setMe(await fetchMe());
    } catch (error) {
      setLoadError(error instanceof ApiRequestError ? error.message : 'Could not load settings.');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void load().finally(() => setIsLoading(false));
  }, [load]);

  const onSignOut = async () => {
    setIsSigningOut(true);
    if (Platform.OS === 'web') {
      await revokeDesktopAlerts();
    } else if (user) {
      await unregisterPushNotificationsAsync(user.id);
    }
    clearRememberedWatchlist();
    await supabase.auth.signOut();
    setIsSigningOut(false);
  };

  const onDeleteAccount = () => {
    void confirmAsync({
      title: 'Delete account?',
      message:
        'This permanently deletes your account, leagues, and lineup data. This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      setIsDeletingAccount(true);
      void (async () => {
        try {
          await deleteAccount();
          clearRememberedWatchlist();
          await supabase.auth.signOut();
        } catch (error) {
          void alertAsync('Could not delete account', errorMessage(error));
          setIsDeletingAccount(false);
        }
      })();
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <Text style={styles.headerTitle}>Settings</Text>
        <LoadingState message="Loading settings…" />
      </View>
    );
  }

  if (loadError || !me) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <Text style={[styles.headerTitle, styles.headerTitlePad]}>Settings</Text>
        <ErrorState
          message={loadError ?? 'Could not load settings.'}
          onRetry={() => {
            void load();
          }}
        />
      </View>
    );
  }

  const account = (
    <AccountSection
      email={me.email}
      subscriptionTier={me.subscription_tier}
      isSigningOut={isSigningOut}
      isDeletingAccount={isDeletingAccount}
      onChangePassword={() => {
        router.push('/(app)/change-password');
      }}
      onSignOut={onSignOut}
      onDeleteAccount={onDeleteAccount}
    />
  );
  const notifications = (
    <NotificationsSection
      preferences={me.preferences}
      onChange={async (patch) => {
        const updated = await patchPreferences(patch);
        setMe(updated);
      }}
    />
  );
  const streaming = (
    <StreamingServicesSection
      appPresence={me.app_presence}
      onChange={async (service, hasSubscription) => {
        const { app_presence } = await setAppPresence([
          { service, has_subscription: hasSubscription },
        ]);
        setMe((current) => (current ? { ...current, app_presence } : current));
        requestWeekGamesRefresh();
      }}
    />
  );
  const about = <AboutSection />;
  const sectionBody = {
    account,
    notifications,
    streaming,
    about,
  }[settingsSection];

  if (Platform.OS === 'web' && desktopTier === 'wide') {
    return (
      <View
        style={[
          styles.screen,
          styles.desktop,
          { paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.sectionNav}>
          <Text style={styles.headerTitle}>Settings</Text>
          {SETTINGS_SECTIONS.map((item) => {
            const selected = item.key === settingsSection;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setSettingsSection(item.key)}
                style={(state) => {
                  const { pressed, hovered, focused } = webPressState(state);
                  return [
                    styles.sectionLink,
                    selected && styles.sectionLinkSelected,
                    hovered && !selected && styles.sectionLinkHover,
                    pressed && styles.sectionLinkPressed,
                    focused && styles.sectionLinkFocused,
                  ];
                }}
              >
                <Text
                  style={[styles.sectionLinkLabel, selected && styles.sectionLinkLabelSelected]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView
          style={styles.desktopDetail}
          contentContainerStyle={[styles.content, styles.desktopDetailContent]}
        >
          {sectionBody}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.huge,
        },
      ]}
    >
      <Text style={styles.headerTitle}>Settings</Text>
      {account}
      {notifications}
      {streaming}
      {about}
    </ScrollView>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong.';
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function AccountSection({
  email,
  subscriptionTier,
  isSigningOut,
  isDeletingAccount,
  onChangePassword,
  onSignOut,
  onDeleteAccount,
}: {
  email: string;
  subscriptionTier: string;
  isSigningOut: boolean;
  isDeletingAccount: boolean;
  onChangePassword: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}) {
  const { openUpgrade } = useUpgradeSheet();
  const isPro = subscriptionTier === 'pro';

  return (
    <SectionCard title="Account">
      <Text style={styles.rowLabel}>{email}</Text>
      <Text style={styles.rowSubtext}>{isPro ? 'Pro' : 'Free'} plan</Text>

      <SecondaryButton
        label="Change password"
        onPress={onChangePassword}
        style={styles.accountButton}
      />

      {isPro ? (
        <TextButton
          hitArea="padding"
          label="Manage subscription"
          onPress={() => {
            void Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => {
              void alertAsync('Could not open', 'Open Settings → Apple ID → Subscriptions.');
            });
          }}
          size="smallStrong"
          style={styles.accountButton}
        />
      ) : (
        <SecondaryButton
          label="Upgrade to Pro"
          onPress={openUpgrade}
          style={styles.accountButton}
        />
      )}

      <SecondaryButton
        disabled={isSigningOut}
        label="Sign out"
        loading={isSigningOut}
        onPress={onSignOut}
        style={styles.accountButton}
      />

      <TextButton
        disabled={isDeletingAccount}
        hitArea="padding"
        label="Delete account"
        onPress={onDeleteAccount}
        size="smallStrong"
        style={styles.deleteAccount}
        tone="danger"
      />
    </SectionCard>
  );
}

function NotificationsSection({
  preferences,
  onChange,
}: {
  preferences: MeResponse['preferences'];
  onChange: (patch: {
    notificationMode?: MeResponse['preferences']['notificationMode'];
    quietHours?: Partial<MeResponse['preferences']['quietHours']>;
  }) => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [soundOn, setSoundOn] = useState(readAlertSoundEnabled);

  const save = async (patch: Parameters<typeof onChange>[0]) => {
    setIsSaving(true);
    try {
      await onChange(patch);
    } catch (error) {
      void alertAsync('Could not save', errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard title="Notifications">
      <View style={styles.segmentedControl}>
        {NOTIFICATION_MODES.map((mode) => {
          const isActive = preferences.notificationMode === mode.value;
          return (
            <Pressable
              key={mode.value}
              disabled={isSaving}
              onPress={() => save({ notificationMode: mode.value })}
              style={({ pressed }) => [
                styles.segment,
                isActive && styles.segmentActive,
                pressed &&
                  !isSaving &&
                  (isActive ? styles.segmentActivePressed : styles.segmentPressed),
              ]}
            >
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                {mode.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.rowLabel}>Quiet hours</Text>
        <Switch
          disabled={isSaving}
          onValueChange={(enabled) => save({ quietHours: { enabled } })}
          thumbColor={SWITCH_THUMB}
          trackColor={SWITCH_TRACK}
          value={preferences.quietHours.enabled}
        />
      </View>
      {preferences.quietHours.enabled ? (
        <Text style={styles.rowSubtext}>
          {formatHour(preferences.quietHours.startHour)}–
          {formatHour(preferences.quietHours.endHour)} ({preferences.quietHours.timezone})
        </Text>
      ) : null}

      {Platform.OS === 'web' ? (
        <View style={styles.toggleRow}>
          <Text style={styles.rowLabel}>Alert sound</Text>
          <Switch
            onValueChange={(enabled) => {
              writeAlertSoundEnabled(enabled);
              setSoundOn(enabled);
            }}
            thumbColor={SWITCH_THUMB}
            trackColor={SWITCH_TRACK}
            value={soundOn}
          />
        </View>
      ) : null}

      <View style={styles.toggleRow}>
        <Text style={styles.rowLabel}>Auto-switch highest priority game</Text>
        <Switch
          disabled
          thumbColor={SWITCH_THUMB}
          trackColor={SWITCH_TRACK}
          value={preferences.autoSwitch}
        />
      </View>
      <Text style={styles.rowSubtext}>Coming soon.</Text>
    </SectionCard>
  );
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}${period}`;
}

function StreamingServicesSection({
  appPresence,
  onChange,
}: {
  appPresence: MeResponse['app_presence'];
  onChange: (service: UserService, hasSubscription: boolean) => Promise<void>;
}) {
  const [savingService, setSavingService] = useState<string | null>(null);
  const presenceByService = useMemo(
    () => new Map<string, boolean>(appPresence.map((row) => [row.service, row.has_subscription])),
    [appPresence],
  );
  const showTicketHint = showsSundayTicketHint(presenceByService);
  const showPayTvSignIn = USER_SERVICE_OPTIONS.some(
    (service) => showsPayTvSignInCopy(service) && presenceByService.get(service) === true,
  );

  return (
    <SectionCard title="Streaming services">
      <Text style={styles.sectionHint}>
        Tell us which of these you subscribe to so we can recommend the right one to switch to.
      </Text>
      {USER_SERVICE_OPTIONS.map((service) => (
        <View key={service}>
          <View style={styles.toggleRow}>
            <Text style={styles.rowLabel}>{userServiceLabel(service)}</Text>
            <Switch
              disabled={savingService === service}
              onValueChange={async (value) => {
                setSavingService(service);
                try {
                  await onChange(service, value);
                } catch (error) {
                  void alertAsync('Could not save', errorMessage(error));
                } finally {
                  setSavingService(null);
                }
              }}
              thumbColor={SWITCH_THUMB}
              trackColor={SWITCH_TRACK}
              value={presenceByService.get(service) ?? false}
            />
          </View>
          {service === 'youtube_tv' && showTicketHint ? (
            <Text style={styles.ticketHint}>Also have NFL Sunday Ticket? Turn it on below.</Text>
          ) : null}
        </View>
      ))}
      {showPayTvSignIn ? <Text style={styles.ticketHint}>{PAY_TV_SIGN_IN_COPY}</Text> : null}
    </SectionCard>
  );
}

function promptEnableNotifications(): void {
  void confirmAsync({
    title: 'Notifications are off',
    message: 'Turn on notifications for Pivot in the Settings app, then try again.',
    confirmLabel: 'Open Settings',
    cancelLabel: 'Not now',
  }).then((confirmed) => {
    if (!confirmed) return;
    void Linking.openSettings().catch(() => {
      void alertAsync(
        'Could not open Settings',
        'Open the Settings app, tap Pivot, and enable notifications.',
      );
    });
  });
}

function DesktopAlertsButton() {
  const { requestAndRegister } = usePushPermission();
  const [detail, setDetail] = useState(desktopAlertCopy('default'));
  const [isEnabling, setIsEnabling] = useState(false);

  return (
    <>
      <TextButton
        disabled={isEnabling}
        label={isEnabling ? 'Enabling…' : 'Enable desktop alerts'}
        onPress={() => {
          setIsEnabling(true);
          void requestAndRegister()
            .then(() => setDetail(desktopAlertCopy(lastDesktopAlertState())))
            .finally(() => setIsEnabling(false));
        }}
        size="small"
        style={styles.aboutLink}
      />
      <Text style={styles.rowSubtext}>{detail}</Text>
    </>
  );
}

function AboutSection() {
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const [isSendingTest, setIsSendingTest] = useState(false);

  const onSendTestNotification = async () => {
    setIsSendingTest(true);
    try {
      await scheduleTestFlagNotificationAsync();
    } catch (error) {
      if (error instanceof NotificationsDisabledError) {
        promptEnableNotifications();
      } else {
        void alertAsync('Could not send test notification', errorMessage(error));
      }
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <SectionCard title="About">
      <Text style={styles.rowSubtext}>Pivot v{version}</Text>
      <TextButton
        accessibilityRole="link"
        label="Contact support"
        onPress={() =>
          openExternalUrl(SUPPORT_MAILTO, `Email ${SUPPORT_EMAIL} from your mail app.`)
        }
        size="small"
        style={styles.aboutLink}
      />
      <TextButton
        accessibilityRole="link"
        label="Terms of service"
        onPress={() =>
          openExternalUrl(TERMS_OF_SERVICE_URL, 'Visit pivot-sports.app/terms in your browser.')
        }
        size="small"
        style={styles.aboutLink}
      />
      <TextButton
        accessibilityRole="link"
        label="Privacy policy"
        onPress={() =>
          openExternalUrl(PRIVACY_POLICY_URL, 'Visit pivot-sports.app/privacy in your browser.')
        }
        size="small"
        style={styles.aboutLink}
      />
      {Platform.OS === 'web' ? (
        <DesktopAlertsButton />
      ) : (
        <TextButton
          disabled={isSendingTest}
          label={isSendingTest ? 'Sending in 2s…' : 'Send test notification'}
          onPress={() => void onSendTestNotification()}
          size="small"
          style={styles.aboutLink}
        />
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  aboutLink: {
    marginTop: theme.spacing.sm,
  },
  accountButton: {
    marginTop: theme.spacing.md,
  },
  content: {
    gap: theme.spacing.lg2,
    paddingHorizontal: theme.spacing.lg2,
  },
  desktop: {
    flexDirection: 'row',
    gap: theme.spacing.xl,
    paddingHorizontal: theme.spacing.xl,
  },
  desktopDetail: {
    flex: 1,
    minWidth: 0,
  },
  desktopDetailContent: {
    paddingHorizontal: 0,
    paddingBottom: theme.spacing.huge,
  },
  sectionLink: {
    borderRadius: theme.radii.control,
    cursor: 'pointer',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  sectionLinkFocused: {
    borderColor: theme.colors.accent,
    borderWidth: theme.effects.panelBorderWidth,
  },
  sectionLinkHover: {
    backgroundColor: theme.colors.surface,
  },
  sectionLinkLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
  },
  sectionLinkLabelSelected: {
    color: theme.colors.accent,
  },
  sectionLinkPressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  sectionLinkSelected: {
    backgroundColor: theme.colors.accentMuted,
  },
  sectionNav: {
    gap: theme.spacing.xs,
    width: 220,
  },
  deleteAccount: {
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  headerTitlePad: {
    paddingHorizontal: theme.spacing.lg2,
  },
  rowLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.button.weight,
  },
  rowSubtext: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    marginTop: theme.spacing.xs,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  section: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    ...theme.effects.panelGlow,
  },
  sectionHint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    marginBottom: theme.spacing.xs,
  },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    marginBottom: theme.spacing.xs,
    textTransform: 'uppercase',
  },
  segment: {
    alignItems: 'center',
    borderRadius: theme.radii.sm,
    flex: 1,
    paddingVertical: theme.spacing.sm,
  },
  segmentActive: {
    backgroundColor: theme.colors.accent,
  },
  segmentActivePressed: {
    backgroundColor: theme.colors.accentPressed,
  },
  segmentPressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  segmentText: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  segmentTextActive: {
    color: theme.colors.onAccent,
  },
  segmentedControl: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radii.control,
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
    padding: theme.spacing.xs,
  },
  ticketHint: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    marginBottom: theme.spacing.xs,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
});
