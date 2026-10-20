import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import { SlipPerforation } from './SlipPerforation';
import { TeamBadge } from './TeamBadge';

const HIGHLIGHT_MS = 600;

export interface AddPickSlipGame {
  away: string;
  home: string;
  detail: string;
}

export interface AddPickSlipPick {
  /** Team abbreviation. A total has no badge. */
  badge: string | null;
  text: string;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduced(query.matches);
      const onChange = () => setReduced(query.matches);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    return () => subscription.remove();
  }, []);
  return reduced;
}

function Highlighted({ filledKey, children }: { filledKey: string; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const previous = useRef(filledKey);
  const [hot, setHot] = useState(false);

  useEffect(() => {
    const before = previous.current;
    previous.current = filledKey;
    if (reduced || before.length > 0 || filledKey.length === 0) return;
    setHot(true);
    const timer = setTimeout(() => setHot(false), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [filledKey, reduced]);

  return <View style={[styles.valueSlot, hot ? styles.highlight : undefined]}>{children}</View>;
}

function Placeholder() {
  return <Text style={styles.placeholder}>—</Text>;
}

/**
 * The running bet slip. Empty rows stay in place as a muted dash so the card
 * has its shape on the first step and fills in as choices are made.
 */
export function AddPickSlip({
  typeLabel,
  game,
  pickLabel,
  pick,
}: {
  typeLabel: string | null;
  game: AddPickSlipGame | null;
  pickLabel: 'PICK' | 'TEAM';
  pick: AddPickSlipPick | null;
}) {
  const gameKey = game ? `${game.away}@${game.home}` : '';
  return (
    <View style={styles.card} testID="add-pick-slip">
      <View style={styles.face}>
        <Text style={styles.cardEyebrow}>YOUR SLIP</Text>
        <SlipRow filledKey={typeLabel ?? ''} label="TYPE">
          {typeLabel ? <Text style={styles.value}>{typeLabel}</Text> : <Placeholder />}
        </SlipRow>
        <SlipRow filledKey={gameKey} label="GAME">
          {game ? (
            <View style={styles.gameValue}>
              <TeamBadge abbr={game.away} size="sm" />
              <Text style={styles.at}>@</Text>
              <TeamBadge abbr={game.home} size="sm" />
              {game.detail.length > 0 ? <Text style={styles.detail}>{game.detail}</Text> : null}
            </View>
          ) : (
            <Placeholder />
          )}
        </SlipRow>
        <SlipRow filledKey={pick?.text ?? ''} label={pickLabel}>
          {pick ? (
            <View style={styles.pickValue}>
              {pick.badge ? <TeamBadge abbr={pick.badge} size="sm" /> : null}
              <Text style={pickLabel === 'PICK' ? styles.pickText : styles.value}>{pick.text}</Text>
            </View>
          ) : (
            <Placeholder />
          )}
        </SlipRow>
      </View>
      <SlipPerforation edge="card" />
    </View>
  );
}

function SlipRow({
  label,
  filledKey,
  children,
}: {
  label: string;
  filledKey: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Highlighted filledKey={filledKey}>{children}</Highlighted>
    </View>
  );
}

const styles = StyleSheet.create({
  at: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.small.size,
  },
  card: {
    alignSelf: 'stretch',
    marginBottom: theme.spacing.lg,
    marginHorizontal: theme.spacing.lg2,
    overflow: 'visible',
  },
  face: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderBottomWidth: 0,
    borderLeftWidth: theme.effects.panelBorderWidth,
    borderRightWidth: theme.effects.panelBorderWidth,
    borderTopLeftRadius: theme.radii.md,
    borderTopRightRadius: theme.radii.md,
    borderTopWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  cardEyebrow: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    paddingHorizontal: theme.spacing.md,
  },
  detail: {
    color: theme.colors.textSecondary,
    flexShrink: 1,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
    maxWidth: '100%',
    minWidth: 0,
  },
  gameValue: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    minWidth: 0,
  },
  highlight: {
    backgroundColor: theme.colors.accentMuted,
    borderRadius: theme.radii.sm,
  },
  label: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    width: 52,
  },
  pickText: {
    color: theme.colors.accent,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
    lineHeight: theme.type.bodyStrong.lineHeight,
  },
  pickValue: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: theme.spacing.sm,
  },
  placeholder: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.bodyStrong.size,
    lineHeight: theme.type.bodyStrong.lineHeight,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  valueSlot: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  value: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
    lineHeight: theme.type.bodyStrong.lineHeight,
  },
});
