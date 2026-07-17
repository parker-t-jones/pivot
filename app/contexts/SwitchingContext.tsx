import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { apiClient } from '../lib/apiClient';
import type { GameBroadcast, GameBroadcastsResponse } from '../lib/gameDisplay';
import { serviceLabel } from '../lib/gameDisplay';
import { streamingServiceAppStoreUrl } from '../lib/streamingServices';
import { resolveSwitch } from '../lib/switching';

export interface SwitchInput {
  gameId: string;
  /** Resolved deep link for this user+game (from the flag payload or `GET /games/:id/broadcasts`). */
  deepLinkUrl: string | null;
  /** Fallback overlay label, e.g. "DEN @ IND" — used only when `teamName` can't be resolved. */
  label: string;
  /** Sprint 9 Phase 2 — the possessing/flagged team's display name, when resolvable (see
   *  `teamDisplay.ts`). Section 10's overlay label wants "Switching to the Colts…", not the
   *  matchup, whenever the caller can tell us which team that is. */
  teamName?: string | null;
  /** Sprint 9 Phase 2 — that team's `teams.primary_color`/`secondary_color`, for the "team color
   *  flash" the overlay fades in behind the switching card. */
  teamColors?: { primary: string; secondary: string } | null;
  /** Already-fetched ranked broadcasts (Home has these from its own `/games/:id/broadcasts` call).
   *  When omitted, the overlay fetches them lazily itself if the user hits the error state and
   *  needs the alternate-broadcast picker (the notification/banner path doesn't prefetch this). */
  broadcasts?: GameBroadcast[];
}

type SwitchPhase =
  | { status: 'idle' }
  | {
      status: 'switching';
      label: string;
      teamColors: { primary: string; secondary: string } | null;
    }
  | {
      status: 'error';
      message: string;
      gameId: string;
      failedService: string | null;
      broadcasts: GameBroadcast[] | null;
      isLoadingBroadcasts: boolean;
    };

interface SwitchingContextValue {
  /** Fire-and-forget: kicks off the Section 10 switching transition + deep-link handoff. */
  switchToGame: (input: SwitchInput) => void;
}

const SwitchingContext = createContext<SwitchingContextValue | undefined>(undefined);

/** Section 10 "Switching transition": brief (under 1s) overlay before the deep link fires. */
const MIN_OVERLAY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openBroadcast(broadcast: GameBroadcast): Promise<boolean> {
  if (!broadcast.deep_link_url) return false;
  try {
    await Linking.openURL(broadcast.deep_link_url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sprint 7 Phase 6 — owns the app-wide "Switch" action, shared by the Home CTA (Section 10 State 1)
 * and the notification banner's Switch button. Flow: show the transition overlay, resolve a
 * `PlaybackSource` via `resolveSwitch` (deep link in v1), best-effort set the primary game
 * (`PUT /session/primary`, so the dispatcher's `decideAction` treats this game as primary next time —
 * closing the Sprint 6 loop), hold the overlay briefly, then hand off to the deep link. A deep link
 * that can't be opened (app not installed) surfaces Section 10's deep-link error state instead of
 * failing silently.
 *
 * Sprint 9 Phase 2 additions (Section 10 fidelity gaps — see report): the overlay now shows a brief
 * team-color flash and labels itself with the possessing/flagged team's name instead of the raw
 * matchup, when the caller can supply that (`teamName`/`teamColors` on `SwitchInput` — see
 * `teamDisplay.ts`). The error state grew an alternate-broadcast picker (ranked list, "Get app"
 * fallback for a service with no subscription/app installed) instead of just a dead end.
 */
export function SwitchingProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<SwitchPhase>({ status: 'idle' });
  const inFlight = useRef(false);

  /** Sets the error phase and, when the caller didn't already have a broadcast list handy (the
   *  notification/banner path never prefetches one), kicks off `GET /games/:id/broadcasts` right
   *  here rather than leaving the overlay component to notice and trigger it — keeps all the
   *  data-fetching side effects in this provider, not in a render body. */
  const enterErrorPhase = useCallback(
    (gameId: string, message: string, failedService: string | null, prefetched?: GameBroadcast[]) => {
      if (prefetched !== undefined) {
        setPhase({
          status: 'error',
          message,
          gameId,
          failedService,
          broadcasts: prefetched,
          isLoadingBroadcasts: false,
        });
        return;
      }

      setPhase({
        status: 'error',
        message,
        gameId,
        failedService,
        broadcasts: null,
        isLoadingBroadcasts: true,
      });

      void (async () => {
        try {
          const { broadcasts } = await apiClient.get<GameBroadcastsResponse>(
            `/games/${gameId}/broadcasts`,
          );
          setPhase((current) =>
            current.status === 'error' && current.gameId === gameId
              ? { ...current, broadcasts, isLoadingBroadcasts: false }
              : current,
          );
        } catch (error) {
          console.warn('[switch] failed to load alternate broadcasts', error);
          setPhase((current) =>
            current.status === 'error' && current.gameId === gameId
              ? { ...current, broadcasts: [], isLoadingBroadcasts: false }
              : current,
          );
        }
      })();
    },
    [],
  );

  const switchToGame = useCallback(
    (input: SwitchInput) => {
      if (inFlight.current) return; // ignore double-taps mid-transition
      inFlight.current = true;
      setPhase({
        status: 'switching',
        label: input.teamName ?? input.label,
        teamColors: input.teamColors ?? null,
      });

      void (async () => {
        try {
          const resolution = await resolveSwitch(
            { id: input.gameId, deepLinkUrl: input.deepLinkUrl ?? undefined },
            // DeepLinkPlaybackSource ignores userContext; real subscription context arrives in Sprint 8.
            { subscribedServices: [] },
          );

          if (!resolution.ok || !resolution.session.deepLinkUrl) {
            enterErrorPhase(
              input.gameId,
              "We couldn't find a way to open this game yet. Try another broadcast.",
              null,
              input.broadcasts,
            );
            return;
          }

          // Best-effort primary-game update — never blocks the switch.
          void apiClient
            .put('/session/primary', { game_id: input.gameId, source: resolution.session.source })
            .catch((error: unknown) => console.warn('[switch] failed to set primary game', error));

          await delay(MIN_OVERLAY_MS);

          const opened = await openBroadcast({
            service: resolution.session.source,
            deep_link_url: resolution.session.deepLinkUrl,
            requires_subscription: false,
            user_has_subscription: true,
            typical_lag_seconds: 0,
            preferred: true,
          });

          if (opened) {
            setPhase({ status: 'idle' });
          } else {
            enterErrorPhase(
              input.gameId,
              "That app doesn't seem to be installed. Try another broadcast.",
              resolution.session.source,
              input.broadcasts,
            );
          }
        } finally {
          inFlight.current = false;
        }
      })();
    },
    [enterErrorPhase],
  );

  const dismissError = useCallback(() => setPhase({ status: 'idle' }), []);

  const onSelectAlternate = useCallback((broadcast: GameBroadcast) => {
    void (async () => {
      const opened = await openBroadcast(broadcast);
      if (opened) {
        setPhase({ status: 'idle' });
      }
      // Left in the error state (with the same broadcast list) if it also fails to open — the user
      // can try a different one from the same picker rather than losing the list.
    })();
  }, []);

  return (
    <SwitchingContext.Provider value={{ switchToGame }}>
      {children}
      <SwitchingOverlay phase={phase} onDismiss={dismissError} onSelectAlternate={onSelectAlternate} />
    </SwitchingContext.Provider>
  );
}

function TeamColorFlash({ colors }: { colors: { primary: string; secondary: string } }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [colors.primary, colors.secondary, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.colorFlash,
        { backgroundColor: colors.primary, opacity, borderColor: colors.secondary },
      ]}
    />
  );
}

function SwitchingOverlay({
  phase,
  onDismiss,
  onSelectAlternate,
}: {
  phase: SwitchPhase;
  onDismiss: () => void;
  onSelectAlternate: (broadcast: GameBroadcast) => void;
}) {
  if (phase.status === 'idle') return null;
  const isError = phase.status === 'error';

  return (
    <Modal transparent animationType="fade" visible onRequestClose={isError ? onDismiss : undefined}>
      <View style={styles.overlay}>
        {isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn&apos;t switch</Text>
            <Text style={styles.errorMessage}>{phase.message}</Text>

            {phase.isLoadingBroadcasts ? (
              <ActivityIndicator color="#fff" style={styles.broadcastLoading} />
            ) : phase.broadcasts && phase.broadcasts.length > 0 ? (
              <View style={styles.broadcastList}>
                {phase.broadcasts
                  .filter((b) => b.service !== phase.failedService)
                  .map((broadcast) => (
                    <AlternateBroadcastRow
                      key={broadcast.service}
                      broadcast={broadcast}
                      onSelect={onSelectAlternate}
                    />
                  ))}
              </View>
            ) : null}

            <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.errorButton}>
              <Text style={styles.errorButtonText}>Close</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.switchingCard}>
            {phase.teamColors ? <TeamColorFlash colors={phase.teamColors} /> : null}
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.switchingText}>Switching to {phase.label}…</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

function AlternateBroadcastRow({
  broadcast,
  onSelect,
}: {
  broadcast: GameBroadcast;
  onSelect: (broadcast: GameBroadcast) => void;
}) {
  const hasDeepLink = broadcast.deep_link_url.length > 0;
  const appStoreUrl = streamingServiceAppStoreUrl(broadcast.service);

  return (
    <View style={styles.broadcastRow}>
      <Text style={styles.broadcastRowLabel}>{serviceLabel(broadcast.service)}</Text>
      {hasDeepLink ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelect(broadcast)}
          style={styles.broadcastRowButton}
        >
          <Text style={styles.broadcastRowButtonText}>Watch</Text>
        </Pressable>
      ) : appStoreUrl ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openURL(appStoreUrl)}
          style={[styles.broadcastRowButton, styles.broadcastRowButtonSecondary]}
        >
          <Text style={styles.broadcastRowButtonText}>Get app</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function useSwitching(): SwitchingContextValue {
  const value = useContext(SwitchingContext);
  if (!value) {
    throw new Error('useSwitching must be used within SwitchingProvider');
  }
  return value;
}

const styles = StyleSheet.create({
  broadcastList: {
    gap: 8,
    marginTop: 16,
    width: '100%',
  },
  broadcastLoading: {
    marginTop: 16,
  },
  broadcastRow: {
    alignItems: 'center',
    backgroundColor: '#28282a',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  broadcastRowButton: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  broadcastRowButtonSecondary: {
    backgroundColor: '#3a3a3c',
  },
  broadcastRowButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  broadcastRowLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  colorFlash: {
    borderRadius: 16,
    borderWidth: 2,
  },
  errorButton: {
    alignItems: 'center',
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    marginTop: 18,
    paddingVertical: 12,
    width: '100%',
  },
  errorButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    marginHorizontal: 24,
    padding: 22,
    width: '100%',
    maxWidth: 380,
  },
  errorMessage: {
    color: '#c7c7cc',
    fontSize: 15,
    lineHeight: 21,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  switchingCard: {
    alignItems: 'center',
    gap: 16,
    overflow: 'hidden',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  switchingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
});
