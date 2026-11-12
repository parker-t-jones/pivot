import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DemoAlertBanner } from '../../components/DemoAlertBanner';
import { DemoBanner } from '../../components/DemoBanner';
import { DemoCountdownCard } from '../../components/DemoCountdownCard';
import { DemoHomeLive } from '../../components/DemoHomeLive';
import { PickEventFlash } from '../../components/PickEventFlash';
import {
  DEMO_TOTAL_MS,
  demoAlertsToPresent,
  demoCountdownAtElapsed,
  demoLiveStakeCards,
  demoPhaseAtElapsed,
  demoSnapshotAtElapsed,
  type DemoAlert,
  type DemoAlertKind,
  type DemoBackgroundSpan,
  type DemoPhase,
  type DemoSnapshot,
} from '../../lib/demoGameDay';
import {
  cancelDemoGameDayNotificationsAsync,
  scheduleDemoGameDayNotificationsAsync,
} from '../../lib/demoGameDayNotification';
import { resetToHomeRoot } from '../../lib/navigateAfterConnect';
import { pickCardModel } from '../../lib/pickCard';
import { theme } from '../../lib/theme';
import { usePickHitFlash } from '../../lib/usePickHitFlash';

/** Fine enough that the countdown (a digit every 600ms) and each alert land on time. */
const TICK_MS = 200;

interface ShownAlert {
  key: number;
  alert: DemoAlert;
}

/**
 * "Try a demo game day" (issue #32 / PIVOT-STAKES-PLAN.md §12.2, reshaped by issue #69): a
 * local-only sandbox that replays a bundled fixture. A sped-up 10-to-1 countdown, then Home's live
 * day (issue #71: the real live game card with the field gauge, and the demo picks under it), and
 * three alerts about one pick, 8s apart: live, closing in, hit.
 * The hit carries the Watchlist's own `usePickHitFlash` + `PickEventFlash` (issue #44). No server
 * calls: nothing here reads or writes `stakes`, `lineup_slots`, preferences, or any API route.
 *
 * Each alert is seen once per surface:
 * - Foreground (iOS) and web: an in-app banner at the alert time. iOS suppresses its own banner in
 *   the foreground (`NotificationBannerHost`'s handler), so nothing doubles; web has no local
 *   scheduling.
 * - Backgrounded iOS: the OS delivers the three notifications scheduled at the start. The app's
 *   timers are suspended then, so the screen skips any alert that fell inside a backgrounded
 *   stretch rather than showing it again on return.
 * - No OS delivery (permission off, scheduling failed, web): the in-app banners still play, and the
 *   demo clock pauses while the app is hidden so no alert is missed.
 */
export default function DemoGameDayScreen() {
  const router = useRouter();
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [shown, setShown] = useState<ShownAlert | null>(null);

  const pausedMsRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const backgroundFromRef = useRef<number | null>(null);
  const osSpansRef = useRef<DemoBackgroundSpan[]>([]);
  const osScheduledRef = useRef(false);
  const handledRef = useRef<Set<DemoAlertKind>>(new Set());
  const bannerKeyRef = useRef(0);

  const elapsedNow = () => {
    const now = Date.now();
    const pausedNow = pauseStartRef.current === null ? 0 : now - pauseStartRef.current;
    return Math.min(DEMO_TOTAL_MS, Math.max(0, now - startedAt - pausedMsRef.current - pausedNow));
  };

  // The clock is wall time, so a backgrounded stretch (timers suspended) still advances the demo
  // when the OS is delivering the alerts. Ticks only re-read it.
  useEffect(() => {
    const interval = setInterval(() => setElapsed(elapsedNow()), TICK_MS);
    return () => clearInterval(interval);
    // `elapsedNow` closes over refs and the constant `startedAt`.
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const at = elapsedNow();
      if (state === 'background') {
        if (osScheduledRef.current) {
          backgroundFromRef.current = at;
        } else if (pauseStartRef.current === null) {
          pauseStartRef.current = Date.now();
        }
        return;
      }
      if (backgroundFromRef.current !== null) {
        osSpansRef.current.push({ fromMs: backgroundFromRef.current, toMs: at });
        backgroundFromRef.current = null;
      }
      if (pauseStartRef.current !== null) {
        pausedMsRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }
    });
    return () => subscription.remove();
  }, []);

  // OS delivery for the backgrounded case. Never prompts; any failure just leaves the in-app path.
  useEffect(() => {
    let cancelled = false;
    let scheduled: string[] = [];
    void scheduleDemoGameDayNotificationsAsync(startedAt)
      .then((ids) => {
        if (cancelled) {
          void cancelDemoGameDayNotificationsAsync(ids);
          return;
        }
        scheduled = ids;
        osScheduledRef.current = ids.length > 0;
      })
      .catch(() => {
        // No OS permission, web, or a simulator with none registered: the in-app banners play.
      });
    return () => {
      cancelled = true;
      osScheduledRef.current = false;
      void cancelDemoGameDayNotificationsAsync(scheduled);
    };
  }, [startedAt]);

  useEffect(() => {
    // A stretch still open (backgrounded right now, OS delivering) counts as one with no end.
    const openFrom = backgroundFromRef.current;
    const { due, show } = demoAlertsToPresent({
      elapsedMs: elapsed,
      handled: handledRef.current,
      osSpans:
        openFrom === null
          ? osSpansRef.current
          : [...osSpansRef.current, { fromMs: openFrom, toMs: Infinity }],
    });
    if (due.length === 0) return;
    for (const alert of due) handledRef.current.add(alert.kind);
    // Several at once only happens when ticks were throttled; the latest is the one to show.
    const latest = show[show.length - 1];
    if (latest) {
      bannerKeyRef.current += 1;
      setShown({ key: bannerKeyRef.current, alert: latest });
    }
  }, [elapsed]);

  const phase: DemoPhase = demoPhaseAtElapsed(elapsed);
  const snapshot = demoSnapshotAtElapsed(elapsed);
  const pickFlash = usePickHitFlash(snapshot.picks);
  // Snapshots are constants, so the card model is rebuilt only when a beat changes it.
  const gameCards = useMemo(() => demoLiveStakeCards(snapshot.live), [snapshot]);

  const exit = () => resetToHomeRoot(router);

  return (
    <View style={styles.container}>
      <DemoBanner onExit={exit} />
      <View style={styles.bodyHost}>
        <ScrollView
          contentContainerStyle={[styles.content, phase === 'live' ? null : styles.contentCentered]}
          style={styles.scroll}
        >
          {renderPhase(phase, elapsed, snapshot, gameCards)}
        </ScrollView>
        {shown ? (
          <DemoAlertBanner
            alert={shown.alert}
            alertKey={shown.key}
            onDismiss={() => setShown((current) => (current?.key === shown.key ? null : current))}
          />
        ) : null}
      </View>
      <PickEventFlash flash={pickFlash.flash} onDone={pickFlash.dismiss} />
    </View>
  );
}

function renderPhase(
  phase: DemoPhase,
  elapsed: number,
  snapshot: DemoSnapshot,
  gameCards: ReturnType<typeof demoLiveStakeCards>,
) {
  if (phase === 'pre_game') {
    return <DemoCountdownCard secondsLeft={demoCountdownAtElapsed(elapsed)} />;
  }

  const live = snapshot.live;
  if (phase === 'live' && live) {
    const now = new Date();
    return (
      <DemoHomeLive
        games={gameCards}
        picks={snapshot.picks.map((pick) => ({
          id: pick.id,
          model: pickCardModel({
            stake: pick,
            teams: [],
            weekGames: null,
            liveGames: [live],
            now,
          }),
        }))}
      />
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Demo complete</Text>
      <Text style={styles.message}>
        Exit to go back to your real Home — nothing here was saved.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bodyHost: {
    flex: 1,
  },
  card: {
    gap: theme.spacing.md2,
    width: '100%',
  },
  container: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  // Scrolls when the live view is taller than a small phone. Same gutters as the real Watchlist.
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.lg2,
    paddingVertical: theme.spacing.lg,
  },
  contentCentered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Text needs its own color: the default is black, which vanishes on the dark background.
  message: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  scroll: {
    flex: 1,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
