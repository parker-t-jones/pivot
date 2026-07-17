import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { apiClient } from '../lib/apiClient';
import { resolveSwitch } from '../lib/switching';

export interface SwitchInput {
  gameId: string;
  /** Resolved deep link for this user+game (from the flag payload or `GET /games/:id/broadcasts`). */
  deepLinkUrl: string | null;
  /** Display label for the transition overlay, e.g. "DEN @ IND". */
  label: string;
}

type SwitchPhase =
  | { status: 'idle' }
  | { status: 'switching'; label: string }
  | { status: 'error'; message: string };

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

/**
 * Sprint 7 Phase 6 — owns the app-wide "Switch" action, shared by the Home CTA (Section 10 State 1)
 * and the notification banner's Switch button. Flow: show the transition overlay, resolve a
 * `PlaybackSource` via `resolveSwitch` (deep link in v1), best-effort set the primary game
 * (`PUT /session/primary`, so the dispatcher's `decideAction` treats this game as primary next time —
 * closing the Sprint 6 loop), hold the overlay briefly, then hand off to the deep link. A deep link
 * that can't be opened (app not installed) surfaces Section 10's deep-link error state instead of
 * failing silently.
 */
export function SwitchingProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<SwitchPhase>({ status: 'idle' });
  const inFlight = useRef(false);

  const switchToGame = useCallback((input: SwitchInput) => {
    if (inFlight.current) return; // ignore double-taps mid-transition
    inFlight.current = true;
    setPhase({ status: 'switching', label: input.label });

    void (async () => {
      try {
        const resolution = await resolveSwitch(
          { id: input.gameId, deepLinkUrl: input.deepLinkUrl ?? undefined },
          // DeepLinkPlaybackSource ignores userContext; real subscription context arrives in Sprint 8.
          { subscribedServices: [] },
        );

        if (!resolution.ok || !resolution.session.deepLinkUrl) {
          setPhase({
            status: 'error',
            message: "We couldn't find a way to open this game yet. Try another broadcast.",
          });
          return;
        }

        // Best-effort primary-game update — never blocks the switch.
        void apiClient
          .put('/session/primary', { game_id: input.gameId, source: resolution.session.source })
          .catch((error: unknown) => console.warn('[switch] failed to set primary game', error));

        await delay(MIN_OVERLAY_MS);

        try {
          await Linking.openURL(resolution.session.deepLinkUrl);
          setPhase({ status: 'idle' });
        } catch {
          setPhase({
            status: 'error',
            message: "That app doesn't seem to be installed. Try another broadcast.",
          });
        }
      } finally {
        inFlight.current = false;
      }
    })();
  }, []);

  const dismissError = useCallback(() => setPhase({ status: 'idle' }), []);

  return (
    <SwitchingContext.Provider value={{ switchToGame }}>
      {children}
      <SwitchingOverlay phase={phase} onDismiss={dismissError} />
    </SwitchingContext.Provider>
  );
}

function SwitchingOverlay({
  phase,
  onDismiss,
}: {
  phase: SwitchPhase;
  onDismiss: () => void;
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
            <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.errorButton}>
              <Text style={styles.errorButtonText}>Close</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.switchingCard}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.switchingText}>Switching to {phase.label}…</Text>
          </View>
        )}
      </View>
    </Modal>
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
  errorButton: {
    alignItems: 'center',
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    marginTop: 18,
    paddingVertical: 12,
  },
  errorButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    marginHorizontal: 32,
    padding: 22,
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
  },
  switchingCard: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  switchingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
});
