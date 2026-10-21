import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Slip } from './Slip';
import { TextButton } from './TextButton';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { fonts } from '../lib/fonts';
import { fetchMe } from '../lib/me';
import { theme } from '../lib/theme';
import {
  PRO_PERKS,
  UPGRADE_CARD_WIDTH,
  UPGRADE_HEADLINE,
  UPGRADE_SUBTITLE,
} from '../lib/upgradeCopy';
import { upgradeContextLine } from '../lib/upgradeCap';
import { useDesktopTier } from '../lib/useDesktopTier';
import { webUpgradeStatus } from '../lib/webUpgradeStatus';

/**
 * Web upgrade sheet. Pro is purchased in the iOS app, so this build never loads
 * RevenueCat and never offers a buy, restore, or manage button. Tier comes from
 * `GET /me`.
 */
export function UpgradeSheet() {
  const { isOpen, code, closeUpgrade } = useUpgradeSheet();
  const contextLine = upgradeContextLine(code);
  const insets = useSafeAreaInsets();
  const wide = useDesktopTier() === 'wide';
  const [isPro, setIsPro] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeUpgrade();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeUpgrade, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void fetchMe()
      .then((me) => {
        if (!cancelled) setIsPro(me.subscription_tier === 'pro');
      })
      .catch(() => {
        if (!cancelled) setIsPro(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return (
    <Modal animationType="fade" onRequestClose={closeUpgrade} transparent visible={isOpen}>
      <Pressable
        accessibilityLabel="Dismiss"
        accessibilityRole="button"
        onPress={closeUpgrade}
        style={styles.dim}
      />

      <View
        pointerEvents="box-none"
        style={[
          styles.cardWrap,
          {
            paddingBottom: insets.bottom + theme.spacing.lg,
            paddingTop: insets.top + theme.spacing.lg,
          },
        ]}
      >
        <Slip
          onPress={() => undefined}
          style={{
            maxHeight: '80%',
            maxWidth: wide ? UPGRADE_CARD_WIDTH : undefined,
            paddingBottom: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            width: wide ? UPGRADE_CARD_WIDTH : '100%',
          }}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.eyebrow}>PIVOT PRO</Text>
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {contextLine ? <Text style={styles.contextLine}>{contextLine}</Text> : null}
            <Text style={styles.title}>{UPGRADE_HEADLINE}</Text>
            <Text style={styles.subtitle}>{UPGRADE_SUBTITLE}</Text>

            <View style={styles.perkList}>
              {PRO_PERKS.map((perk) => (
                <View key={perk} style={styles.perkRow}>
                  <Text style={styles.perkBullet}>▸</Text>
                  <Text style={styles.perk}>{perk}</Text>
                </View>
              ))}
            </View>

            {isPro === null ? null : <Text style={styles.status}>{webUpgradeStatus(isPro)}</Text>}

            <View style={styles.footerRow}>
              <TextButton label="Not now" onPress={closeUpgrade} tone="muted" />
            </View>
          </ScrollView>
        </Slip>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg2,
    paddingBottom: theme.spacing.sm,
  },
  cardWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg2,
  },
  content: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg2,
  },
  contextLine: {
    color: theme.colors.accent,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.size * 1.4,
  },
  dim: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: theme.spacing.xs,
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: 1,
  },
  perk: {
    color: theme.colors.textPrimary,
    flex: 1,
    fontSize: theme.type.body.size,
  },
  perkBullet: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  perkList: {
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  perkRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  status: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.caption.size,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.size * 1.4,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
