import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { SecondaryButton } from '../../components/SecondaryButton';
import { TextButton } from '../../components/TextButton';
import { useLeaguesGate } from '../../contexts/LeaguesGateContext';
import { useSession } from '../../contexts/SessionContext';
import { ApiRequestError } from '../../lib/apiClient';
import {
  NotificationsDisabledError,
  scheduleTestFlagNotificationAsync,
} from '../../lib/devNotifications';
import {
  disconnectLeague,
  fetchAllLineups,
  renameManualLeague,
  setStarPlayer,
  syncLeague,
  type LeagueSummary,
  type LineupResponse,
} from '../../lib/leagues';
import {
  deleteAccount,
  fetchMe,
  patchPreferences,
  setAppPresence,
  type MeResponse,
} from '../../lib/me';
import { unregisterPushNotificationsAsync } from '../../lib/pushNotifications';
import { STREAMING_SERVICES, streamingServiceLabel } from '../../lib/streamingServices';
import { supabase } from '../../lib/supabase';
import { theme } from '../../lib/theme';

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

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;

function openExternalUrl(url: string, failedMessage: string): void {
  void Linking.openURL(url).catch(() => {
    Alert.alert('Could not open', failedMessage);
  });
}

/**
 * PLAN.md Section 10 Settings screen — Sprint 9 Phase 2. Reads/writes `GET /me`,
 * `PATCH /me/preferences`, and `POST /me/app-presence`, all added this phase alongside this screen
 * (see report) — before now, nothing in the client called any of the three. Leagues/star players
 * reuse `leagues.ts`, whose endpoints (Sections 9) already existed and were simply unused by the
 * client.
 *
 * No tab bar exists yet (no Lineup screen — out of this phase's scope), so this is reached via a
 * plain header button on Home, not a persistent tab. See report for that scope note.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useSession();
  const { leagues, leaguesRevision, refreshLeagues, deferConnect } = useLeaguesGate();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [lineups, setLineups] = useState<LineupResponse[]>([]);

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const load = useCallback(async (leagueRows: LeagueSummary[]) => {
    setLoadError(null);
    try {
      const meResponse = await fetchMe();
      setMe(meResponse);
      setLineups(await fetchAllLineups(leagueRows));
    } catch (error) {
      setLoadError(error instanceof ApiRequestError ? error.message : 'Could not load settings.');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void load(leagues).finally(() => setIsLoading(false));
    // Intentionally keyed on leaguesRevision — leagues from this render match that revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leagues paired with revision
  }, [load, leaguesRevision]);

  const onSignOut = async () => {
    setIsSigningOut(true);
    if (user) {
      await unregisterPushNotificationsAsync(user.id);
    }
    await supabase.auth.signOut();
    setIsSigningOut(false);
  };

  const onDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, leagues, and lineup data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingAccount(true);
            try {
              await deleteAccount();
              await supabase.auth.signOut();
            } catch (error) {
              Alert.alert('Could not delete account', errorMessage(error));
              setIsDeletingAccount(false);
            }
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <SettingsHeader onBack={() => router.back()} />
        <LoadingState message="Loading settings…" />
      </View>
    );
  }

  if (loadError || !me) {
    return (
      <View style={styles.screen}>
        <SettingsHeader onBack={() => router.back()} />
        <ErrorState
          message={loadError ?? 'Could not load settings.'}
          onRetry={() => {
            void refreshLeagues()
              .then((rows) => load(rows))
              .catch(() => undefined);
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SettingsHeader onBack={() => router.back()} />

      <AccountSection
        email={me.email}
        subscriptionTier={me.subscription_tier}
        isSigningOut={isSigningOut}
        isDeletingAccount={isDeletingAccount}
        onSignOut={onSignOut}
        onDeleteAccount={onDeleteAccount}
      />

      <NotificationsSection
        preferences={me.preferences}
        onChange={async (patch) => {
          const updated = await patchPreferences(patch);
          setMe(updated);
        }}
      />

      <StreamingServicesSection
        appPresence={me.app_presence}
        onChange={async (service, hasSubscription) => {
          const { app_presence } = await setAppPresence([
            { service, has_subscription: hasSubscription },
          ]);
          setMe((current) => (current ? { ...current, app_presence } : current));
        }}
      />

      <LeaguesSection
        leagues={leagues}
        onConnectAnother={() => router.push('/(app)/connect-team')}
        onEditLineup={(leagueId) =>
          router.push(`/(app)/edit-manual-lineup?leagueId=${encodeURIComponent(leagueId)}`)
        }
        onRename={async (leagueId, name) => {
          await renameManualLeague(leagueId, name);
          const rows = await refreshLeagues();
          await load(rows);
        }}
        onSync={async (leagueId) => {
          await syncLeague(leagueId);
          const rows = await refreshLeagues();
          await load(rows);
        }}
        onDisconnect={async (leagueId) => {
          await disconnectLeague(leagueId);
          const rows = await refreshLeagues();
          // Last league removed: land on Home State 5, do not immediately force connect-team.
          if (rows.length === 0) {
            deferConnect();
          }
          await load(rows);
        }}
      />

      <StarPlayersSection
        lineups={lineups}
        onToggleStar={async () => {
          await load(leagues);
        }}
      />

      <AboutSection />
    </ScrollView>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong.';
}

function SettingsHeader({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + theme.spacing.lg }]}>
      <TextButton label="Close" onPress={onBack} />
      <Text style={styles.headerTitle}>Settings</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
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
  onSignOut,
  onDeleteAccount,
}: {
  email: string;
  subscriptionTier: string;
  isSigningOut: boolean;
  isDeletingAccount: boolean;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}) {
  return (
    <SectionCard title="Account">
      <Text style={styles.rowLabel}>{email}</Text>
      <Text style={styles.rowSubtext}>{subscriptionTier === 'pro' ? 'Pro' : 'Free'} plan</Text>

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

  const save = async (patch: Parameters<typeof onChange>[0]) => {
    setIsSaving(true);
    try {
      await onChange(patch);
    } catch (error) {
      Alert.alert('Could not save', errorMessage(error));
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
  onChange: (
    service: (typeof STREAMING_SERVICES)[number],
    hasSubscription: boolean,
  ) => Promise<void>;
}) {
  const [savingService, setSavingService] = useState<string | null>(null);
  const presenceByService = useMemo(
    () => new Map(appPresence.map((row) => [row.service, row.has_subscription])),
    [appPresence],
  );

  return (
    <SectionCard title="Streaming services">
      <Text style={styles.sectionHint}>
        Tell us which of these you subscribe to so we can recommend the right one to switch to.
      </Text>
      {STREAMING_SERVICES.map((service) => (
        <View key={service} style={styles.toggleRow}>
          <Text style={styles.rowLabel}>{streamingServiceLabel(service)}</Text>
          <Switch
            disabled={savingService === service}
            onValueChange={async (value) => {
              setSavingService(service);
              try {
                await onChange(service, value);
              } catch (error) {
                Alert.alert('Could not save', errorMessage(error));
              } finally {
                setSavingService(null);
              }
            }}
            thumbColor={SWITCH_THUMB}
            trackColor={SWITCH_TRACK}
            value={presenceByService.get(service) ?? false}
          />
        </View>
      ))}
    </SectionCard>
  );
}

function LeaguesSection({
  leagues,
  onConnectAnother,
  onEditLineup,
  onRename,
  onSync,
  onDisconnect,
}: {
  leagues: LeagueSummary[];
  onConnectAnother: () => void;
  onEditLineup: (leagueId: string) => void;
  onRename: (leagueId: string, name: string) => Promise<void>;
  onSync: (leagueId: string) => Promise<void>;
  onDisconnect: (leagueId: string) => Promise<void>;
}) {
  const [busyLeagueId, setBusyLeagueId] = useState<string | null>(null);

  const promptRename = (league: LeagueSummary) => {
    Alert.prompt(
      'Rename league',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const next = value?.trim() ?? '';
            if (next.length === 0 || next === league.name) return;
            void (async () => {
              setBusyLeagueId(league.league_id);
              try {
                await onRename(league.league_id, next);
              } catch (error) {
                Alert.alert('Could not rename', errorMessage(error));
              } finally {
                setBusyLeagueId(null);
              }
            })();
          },
        },
      ],
      'plain-text',
      league.name,
    );
  };

  return (
    <SectionCard title="Leagues">
      {leagues.length === 0 ? (
        <Text style={styles.rowSubtext}>No leagues connected yet.</Text>
      ) : (
        leagues.map((league) => (
          <View key={league.league_id} style={styles.leagueRow}>
            <View style={styles.leagueRowInfo}>
              <Text style={styles.rowLabel}>{league.name}</Text>
              <Text style={styles.rowSubtext}>
                {league.platform === 'sleeper' ? 'Sleeper' : 'Manual'} · {league.season_year}
              </Text>
            </View>
            <View style={styles.leagueRowActions}>
              {league.platform === 'sleeper' ? (
                <TextButton
                  disabled={busyLeagueId === league.league_id}
                  label="Sync"
                  onPress={async () => {
                    setBusyLeagueId(league.league_id);
                    try {
                      await onSync(league.league_id);
                    } catch (error) {
                      Alert.alert('Sync failed', errorMessage(error));
                    } finally {
                      setBusyLeagueId(null);
                    }
                  }}
                  size="smallStrong"
                />
              ) : (
                <>
                  <TextButton
                    disabled={busyLeagueId === league.league_id}
                    label="Edit lineup"
                    onPress={() => onEditLineup(league.league_id)}
                    size="smallStrong"
                  />
                  <TextButton
                    disabled={busyLeagueId === league.league_id}
                    label="Rename"
                    onPress={() => promptRename(league)}
                    size="smallStrong"
                  />
                </>
              )}
              <TextButton
                disabled={busyLeagueId === league.league_id}
                label="Disconnect"
                onPress={() =>
                  Alert.alert('Disconnect league?', `Remove "${league.name}" from Pivot?`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Disconnect',
                      style: 'destructive',
                      onPress: async () => {
                        setBusyLeagueId(league.league_id);
                        try {
                          await onDisconnect(league.league_id);
                        } catch (error) {
                          Alert.alert('Could not disconnect', errorMessage(error));
                        } finally {
                          setBusyLeagueId(null);
                        }
                      },
                    },
                  ])
                }
                size="smallStrong"
                tone="danger"
              />
            </View>
          </View>
        ))
      )}

      <SecondaryButton
        label="Connect another team"
        onPress={onConnectAnother}
        style={styles.accountButton}
      />
    </SectionCard>
  );
}

/**
 * Star players — Sprint 9 Phase 2 scope note (see report): "data layer only" per this phase's
 * instructions, so this is a flat list with a toggle per player (backed by the real
 * `POST /leagues/:id/stars`, already implemented server-side and previously unused), not Section
 * 10's "grid view" visual treatment. Grouped by league since a player's star status is scoped to
 * `(league_id, week, player_id)`.
 */
function StarPlayersSection({
  lineups,
  onToggleStar,
}: {
  lineups: LineupResponse[];
  onToggleStar: () => Promise<void>;
}) {
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);

  const allSlots = lineups.flatMap((lineup) => lineup.slots.map((slot) => ({ lineup, slot })));

  return (
    <SectionCard title="Star players">
      <Text style={styles.sectionHint}>
        Starring a player raises how urgently we flag their games, even in a close but
        not-yet-critical moment.
      </Text>
      {allSlots.length === 0 ? (
        <Text style={styles.rowSubtext}>No lineup yet — connect a team to set star players.</Text>
      ) : (
        allSlots.map(({ lineup, slot }) => (
          <View key={slot.slot_id} style={styles.toggleRow}>
            <View>
              <Text style={styles.rowLabel}>
                {slot.player.first_name} {slot.player.last_name}
              </Text>
              <Text style={styles.rowSubtext}>
                {slot.player.position} · {slot.player.team?.abbreviation ?? '—'}
              </Text>
            </View>
            <Switch
              disabled={savingSlotId === slot.slot_id}
              onValueChange={async (value) => {
                setSavingSlotId(slot.slot_id);
                try {
                  await setStarPlayer(lineup.league_id, lineup.week, slot.player.player_id, value);
                  await onToggleStar();
                } catch (error) {
                  Alert.alert('Could not update star', errorMessage(error));
                } finally {
                  setSavingSlotId(null);
                }
              }}
              thumbColor={SWITCH_THUMB}
              trackColor={SWITCH_TRACK}
              value={slot.is_star}
            />
          </View>
        ))
      )}
    </SectionCard>
  );
}

function promptEnableNotifications(): void {
  Alert.alert(
    'Notifications are off',
    'Turn on notifications for Pivot in the Settings app, then try again.',
    [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () =>
          void Linking.openSettings().catch(() => {
            Alert.alert(
              'Could not open Settings',
              'Open the Settings app, tap Pivot, and enable notifications.',
            );
          }),
      },
    ],
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
        Alert.alert('Could not send test notification', errorMessage(error));
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

      {/* Moved here from Home (Sprint 9 Phase 2) — same dev/QA utility, just relocated now that
       *  Home no longer carries any account/debug chrome. */}
      <TextButton
        disabled={isSendingTest}
        label={isSendingTest ? 'Sending in 2s…' : 'Send test notification'}
        onPress={() => void onSendTestNotification()}
        size="small"
        style={styles.aboutLink}
      />
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
    paddingBottom: theme.spacing.huge,
    paddingHorizontal: theme.spacing.lg2,
  },
  deleteAccount: {
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg2,
  },
  headerSpacer: {
    width: theme.spacing.huge,
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontFamily: theme.type.heading.fontFamily,
  },
  leagueRow: {
    borderTopColor: theme.colors.surfaceRaised,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
  },
  leagueRowActions: {
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
  leagueRowInfo: {
    flex: 1,
    // TODO: confirm visual — was gap: 2
    gap: theme.spacing.xs,
  },
  rowLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    fontFamily: theme.type.button.fontFamily,
  },
  rowSubtext: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    // TODO: confirm visual — was marginTop: 2
    marginTop: theme.spacing.xs,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  sectionHint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    marginBottom: theme.spacing.xs,
  },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    fontFamily: theme.type.eyebrow.fontFamily,
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
    fontFamily: theme.type.smallStrong.fontFamily,
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
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
});
