import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import { Slip } from './Slip';
import { TextButton } from './TextButton';
import { useSession } from '../contexts/SessionContext';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { fonts } from '../lib/fonts';
import { fetchMe } from '../lib/me';
import {
  configurePurchases,
  customerHasPro,
  getProMonthlyPackage,
  isPurchasesConfigured,
  purchaseProMonthly,
  restorePurchases,
} from '../lib/purchases';
import { theme } from '../lib/theme';

const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

const PRO_PERKS = [
  'Unlimited connected leagues',
  'Watch multiple Active Lineups at once',
  'Unlimited manual lineup players',
] as const;

/**
 * Global "Upgrade to Pro" sheet — an RN `Modal` (`transparent`), not a router screen backed by
 * `presentation: 'transparentModal'`. React Navigation's native-stack transparent-modal
 * presentation (via `react-native-screens`) renders with a solid *red* background on this app's
 * Fabric setup — a known react-native-screens issue, not anything in this component's own styles.
 * RN's own `Modal` (the same pattern `ActiveLineupPicker` already uses) is genuinely transparent,
 * so this hovers a dimmed card over whatever screen was showing when it opened. Mounted once in
 * `(app)/_layout.tsx`; open from anywhere via `useUpgradeSheet().openUpgrade()`.
 *
 * Deliberately no real blur (`expo-blur`'s `BlurView`) here: it's a native module, and this app
 * runs on a custom dev client (`expo-dev-client`, not Expo Go) whose currently-built binary
 * predates that dependency — an unlinked native view renders as a solid red placeholder on
 * Fabric, which is the exact bug this replaced. A plain dim layer needs no native rebuild; if
 * real frosted glass is wanted later, add `expo-blur` back after rebuilding the dev client
 * (`npx expo run:ios`).
 */
export function UpgradeSheet() {
  const { isOpen, closeUpgrade } = useUpgradeSheet();
  const { user } = useSession();
  const insets = useSafeAreaInsets();

  const [priceLabel, setPriceLabel] = useState('$9.99/month');
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isPro, setIsPro] = useState(false);

  const refreshTier = useCallback(async () => {
    try {
      const me = await fetchMe();
      setIsPro(me.subscription_tier === 'pro');
    } catch {
      // keep prior state
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      if (user?.id) {
        await configurePurchases(user.id);
      }
      await refreshTier();
      if (!isPurchasesConfigured()) return;
      try {
        const pkg = await getProMonthlyPackage();
        if (pkg?.product.priceString) {
          setPriceLabel(`${pkg.product.priceString}/month`);
        }
      } catch (error) {
        console.warn('[upgrade] failed to load offering', error);
      }
    })();
  }, [isOpen, user?.id, refreshTier]);

  const onPurchase = async () => {
    if (!isPurchasesConfigured()) {
      Alert.alert(
        'Purchases unavailable',
        'Set EXPO_PUBLIC_REVENUECAT_API_KEY and rebuild a dev client to buy Pro. For local UI testing, set users.subscription_tier to pro in Supabase.',
      );
      return;
    }
    setIsPurchasing(true);
    try {
      const info = await purchaseProMonthly();
      if (customerHasPro(info)) {
        await refreshTier();
        Alert.alert('You are Pro', 'Unlimited leagues and multi-lineup watching are unlocked.', [
          { text: 'Done', onPress: closeUpgrade },
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Purchase failed.';
      if (!/cancel/i.test(message)) {
        Alert.alert('Could not purchase', message);
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const onRestore = async () => {
    if (!isPurchasesConfigured()) {
      Alert.alert('Purchases unavailable', 'RevenueCat is not configured in this build.');
      return;
    }
    setIsRestoring(true);
    try {
      const info = await restorePurchases();
      await refreshTier();
      if (customerHasPro(info)) {
        Alert.alert('Restored', 'Your Pro subscription is active.');
      } else {
        Alert.alert('Nothing to restore', 'No active Pro subscription found for this Apple ID.');
      }
    } catch (error) {
      Alert.alert(
        'Could not restore',
        error instanceof Error ? error.message : 'Try again later.',
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={closeUpgrade} transparent visible={isOpen}>
      {/* Tapping the dimmed backdrop dismisses back to whatever screen presented this. */}
      <Pressable
        accessibilityLabel="Dismiss"
        accessibilityRole="button"
        onPress={closeUpgrade}
        style={styles.dim}
      />

      <View
        style={[
          styles.cardWrap,
          {
            paddingBottom: insets.bottom + theme.spacing.lg,
            paddingTop: insets.top + theme.spacing.lg,
          },
        ]}
        pointerEvents="box-none"
      >
        {/* Stops backdrop-dismiss taps from also passing through the card itself. */}
        <Slip
          onPress={() => {}}
          style={{
            maxHeight: '80%',
            paddingBottom: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            width: '100%',
          }}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.eyebrow}>PIVOT PRO</Text>
            <TextButton hitArea="padding" label="Close" onPress={closeUpgrade} size="smallStrong" />
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Watch every league that matters</Text>
            <Text style={styles.subtitle}>
              Free covers three leagues and one Active Lineup. Pro removes the caps.
            </Text>

            <View style={styles.perkList}>
              {PRO_PERKS.map((perk) => (
                <View key={perk} style={styles.perkRow}>
                  <Text style={styles.perkBullet}>▸</Text>
                  <Text style={styles.perk}>{perk}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.price}>{priceLabel}</Text>

            {isPro ? (
              <>
                <Text style={styles.activeLabel}>Pro is active on this account.</Text>
                <SecondaryButton
                  label="Manage subscription"
                  onPress={() => {
                    void Linking.openURL(MANAGE_SUBSCRIPTIONS_URL).catch(() => {
                      Alert.alert('Could not open', 'Open Settings → Apple ID → Subscriptions.');
                    });
                  }}
                />
              </>
            ) : (
              <PrimaryButton
                label={`Upgrade — ${priceLabel}`}
                loading={isPurchasing}
                onPress={() => void onPurchase()}
              />
            )}

            <View style={styles.footerRow}>
              <TextButton
                disabled={isRestoring}
                label={isRestoring ? 'Restoring…' : 'Restore purchases'}
                onPress={() => void onRestore()}
              />
              {!isPro ? <TextButton label="Not now" onPress={closeUpgrade} tone="muted" /> : null}
            </View>
          </ScrollView>
        </Slip>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  activeLabel: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.caption.size,
    marginBottom: theme.spacing.sm,
  },
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
  dim: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: 1,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
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
  price: {
    color: theme.colors.textSecondary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.small.size,
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
