import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DemoBanner } from '../../components/DemoBanner';
import { DemoCountdownCard } from '../../components/DemoCountdownCard';
import { DemoLiveRow } from '../../components/DemoLiveRow';
import { PickCard } from '../../components/PickCard';
import { PickEventFlash } from '../../components/PickEventFlash';
import {
  DEMO_PRE_GAME_MS,
  DEMO_TOTAL_MS,
  demoPhaseAtElapsed,
  demoSnapshotAtElapsed,
  type DemoPhase,
  type DemoSnapshot,
} from '../../lib/demoGameDay';
import { scheduleDemoGameDayNotificationAsync } from '../../lib/demoGameDayNotification';
import { resetToHomeRoot } from '../../lib/navigateAfterConnect';
import { pickCardModel } from '../../lib/pickCard';
import { theme } from '../../lib/theme';
import { usePickHitFlash } from '../../lib/usePickHitFlash';

const TICK_MS = 500;

/**
 * "Try a demo game day" (issue #32 / PIVOT-STAKES-PLAN.md §12.2): a local-only sandbox that
 * replays a bundled fixture through PRE-GAME → LIVE with a flag → a local notification. No
 * server calls — nothing here reads or writes `stakes`, `lineup_slots`, or any API route.
 * The pick-hit moment is the Watchlist's own `usePickHitFlash` + `PickEventFlash` (issue #44).
 */
export default function DemoGameDayScreen() {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const notifiedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => Math.min(prev + TICK_MS, DEMO_TOTAL_MS));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const phase: DemoPhase = demoPhaseAtElapsed(elapsed);
  const snapshot = demoSnapshotAtElapsed(elapsed);
  const pickFlash = usePickHitFlash(snapshot.picks);

  useEffect(() => {
    if (phase !== 'live' || notifiedRef.current) return;
    notifiedRef.current = true;
    void scheduleDemoGameDayNotificationAsync().catch(() => {
      // No OS permission (or a simulator with none registered) — the on-screen LIVE state
      // still demonstrates the flow, so a missing notification here isn't fatal.
    });
  }, [phase]);

  const exit = () => resetToHomeRoot(router);

  return (
    <View style={styles.container}>
      <DemoBanner onExit={exit} />
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
        {renderPhase(phase, elapsed, snapshot)}
      </ScrollView>
      <PickEventFlash flash={pickFlash.flash} onDone={pickFlash.dismiss} />
    </View>
  );
}

function renderPhase(phase: DemoPhase, elapsed: number, snapshot: DemoSnapshot) {
  if (phase === 'pre_game') {
    return <DemoCountdownCard secondsLeft={Math.ceil((DEMO_PRE_GAME_MS - elapsed) / 1000)} />;
  }

  const live = snapshot.live;
  if (phase === 'live' && live) {
    const cards = snapshot.picks.map((pick) => ({
      id: pick.id,
      model: pickCardModel({
        stake: pick,
        teams: [],
        weekGames: null,
        liveGames: [live],
        now: new Date(),
      }),
    }));
    return (
      <DemoLiveRow game={live} glowing={cards.some((card) => card.model.hit)}>
        {cards.map((card) => (
          <PickCard key={card.id} model={card.model} />
        ))}
      </DemoLiveRow>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Demo complete</Text>
      <Text style={styles.body}>Exit to go back to your real Home — nothing here was saved.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  card: {
    gap: theme.spacing.md2,
    width: '100%',
  },
  container: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  // Centers the card, and scrolls when the live row is taller than a small phone.
  content: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
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
