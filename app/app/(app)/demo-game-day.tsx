import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DemoBanner } from '../../components/DemoBanner';
import { ListRow } from '../../components/ListRow';
import { TeamBadge } from '../../components/TeamBadge';
import {
  DEMO_AWAY_TEAM,
  DEMO_HOME_TEAM,
  DEMO_PRE_GAME_MS,
  DEMO_STAKES,
  DEMO_TOTAL_MS,
  demoPhaseAtElapsed,
  type DemoPhase,
} from '../../lib/demoGameDay';
import { scheduleDemoGameDayNotificationAsync } from '../../lib/demoGameDayNotification';
import { resetToHomeRoot } from '../../lib/navigateAfterConnect';
import { theme } from '../../lib/theme';

const TICK_MS = 500;

/**
 * "Try a demo game day" (issue #32 / PIVOT-STAKES-PLAN.md §12.2): a local-only sandbox that
 * replays a bundled fixture through PRE-GAME → LIVE with a flag → a local notification. No
 * server calls — nothing here reads or writes `stakes`, `lineup_slots`, or any API route.
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
      <View style={styles.body}>{renderPhase(phase, elapsed)}</View>
    </View>
  );
}

function renderPhase(phase: DemoPhase, elapsed: number) {
  if (phase === 'pre_game') {
    const secondsLeft = Math.ceil((DEMO_PRE_GAME_MS - elapsed) / 1000);
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>UP NEXT</Text>
        <View style={styles.badgeRow}>
          <TeamBadge abbr={DEMO_AWAY_TEAM.abbr} size="lg" />
          <Text style={styles.vs}>at</Text>
          <TeamBadge abbr={DEMO_HOME_TEAM.abbr} size="lg" />
        </View>
        <Text style={styles.title}>Kickoff in {Math.max(secondsLeft, 0)}s</Text>
      </View>
    );
  }

  if (phase === 'live') {
    return (
      <View style={styles.card}>
        <Text style={styles.liveEyebrow}>LIVE</Text>
        <View style={styles.badgeRow}>
          <TeamBadge abbr={DEMO_AWAY_TEAM.abbr} size="lg" />
          <Text style={styles.vs}>vs</Text>
          <TeamBadge abbr={DEMO_HOME_TEAM.abbr} size="lg" />
        </View>
        <Text style={styles.title}>Your demo pick is active</Text>
        {DEMO_STAKES.map((stake) => (
          <ListRow key={stake.id} subtitle={stake.subtitle} title={stake.title} />
        ))}
      </View>
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
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
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
  eyebrow: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  liveEyebrow: {
    color: theme.colors.accent,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
  vs: {
    color: theme.colors.textTertiary,
  },
});
