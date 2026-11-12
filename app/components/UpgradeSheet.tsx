import { useCallback, useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import { Slip } from './Slip';
import { TextButton } from './TextButton';
import { useSession } from '../contexts/SessionContext';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { alertAsync } from '../lib/confirm';
import { fonts } from '../lib/fonts';
import { fetchMe } from '../lib/me';
import { useSubscriptionStatus } from '../lib/useSubscriptionStatus';
import {
  configurePurchases,
  customerHasPro,
  getProMonthlyPackage,
  isPurchasesConfigured,
  purchaseProMonthly,
  restorePurchases,
} from '../lib/purchases';
import { theme } from '../lib/theme';
import {
  PRIVACY_POLICY_URL,
  PRO_PERKS,
  TERMS_OF_USE_URL,
  UPGRADE_HEADLINE,
  UPGRADE_PLAN_LABEL,
  UPGRADE_PRICING_UNAVAILABLE,
  UPGRADE_RENEWAL_DISCLOSURE,
  UPGRADE_SUBTITLE,
  upgradePurchaseLabel,
} from '../lib/upgradeCopy';
import { upgradeContextLine } from '../lib/upgradeCap';

const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

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
  const { isOpen, code, closeUpgrade } = useUpgradeSheet();
  const contextLine = upgradeContextLine(code);
  const { user } = useSession();
  const insets = useSafeAreaInsets();

  /** RevenueCat's price string. Null until it loads; there is deliberately no hardcoded fallback. */
  const [storePrice, setStorePrice] = useState<string | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const { status, entitlementActive } = useSubscriptionStatus(isOpen);
  const isPro = status === 'pro';

  const refreshTier = useCallback(async () => {
    try {
      await fetchMe();
    } catch {
      // keep prior state
    }
  }, []);

  /** Loads the monthly package's store price. Returns it, or null when offerings fail. */
  const loadPrice = useCallback(async (): Promise<string | null> => {
    if (!isPurchasesConfigured()) return null;
    try {
      const pkg = await getProMonthlyPackage();
      const price = pkg?.product.priceString || null;
      if (price) {
        setStorePrice(price);
        setPricingError(null);
      }
      return price;
    } catch (error) {
      console.warn('[upgrade] failed to load offering', error);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setPricingError(null);
    void (async () => {
      if (user?.id) {
        await configurePurchases(user.id);
      }
      await refreshTier();
      await loadPrice();
    })();
  }, [isOpen, user?.id, refreshTier, loadPrice]);

  /** The no-price button retries offerings instead of buying a product whose price wasn't shown. */
  const onRetryPrice = async () => {
    setPricingError(null);
    setIsLoadingPrice(true);
    try {
      const price = await loadPrice();
      if (!price) setPricingError(UPGRADE_PRICING_UNAVAILABLE);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  const onPurchase = async () => {
    if (!isPurchasesConfigured()) {
      void alertAsync(
        'Purchases unavailable',
        'Set EXPO_PUBLIC_REVENUECAT_API_KEY and rebuild a dev client to buy Pro. For local UI testing, set users.subscription_tier to pro in Supabase.',
      );
      return;
    }
    if (!storePrice) {
      await onRetryPrice();
      return;
    }
    setIsPurchasing(true);
    try {
      await purchaseProMonthly();
      await refreshTier();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Purchase failed.';
      if (!/cancel/i.test(message)) {
        void alertAsync('Could not purchase', message);
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const onRestore = async () => {
    if (!isPurchasesConfigured()) {
      void alertAsync('Purchases unavailable', 'RevenueCat is not configured in this build.');
      return;
    }
    setIsRestoring(true);
    try {
      const info = await restorePurchases();
      await refreshTier();
      if (!customerHasPro(info)) {
        void alertAsync(
          'Nothing to restore',
          'No active Pro subscription found for this Apple ID.',
        );
      }
    } catch (error) {
      void alertAsync(
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
          onPress={() => undefined}
          style={{
            maxHeight: '80%',
            paddingBottom: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            width: '100%',
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

            {status === 'free' ? <Text style={styles.activeLabel}>Free plan</Text> : null}
            {status === 'activating' ? (
              <Text accessibilityLiveRegion="polite" style={styles.activeLabel}>
                Activating Pro...
              </Text>
            ) : !isPro && entitlementActive ? (
              <Text style={styles.activeLabel}>
                Pro isn't active on this account yet. Please restore your purchases.
              </Text>
            ) : null}
            {isPro ? (
              <>
                <Text style={styles.activeLabel}>Pro is active on this account.</Text>
                <SecondaryButton
                  label="Manage subscription"
                  onPress={() => {
                    void Linking.openURL(MANAGE_SUBSCRIPTIONS_URL).catch(() => {
                      void alertAsync(
                        'Could not open',
                        'Open Settings → Apple ID → Subscriptions.',
                      );
                    });
                  }}
                />
              </>
            ) : (
              <>
                <PrimaryButton
                  label={upgradePurchaseLabel(storePrice)}
                  disabled={status === 'activating'}
                  loading={isPurchasing || isLoadingPrice}
                  onPress={() => void onPurchase()}
                />
                {pricingError ? (
                  <Text accessibilityLiveRegion="polite" style={styles.pricingError}>
                    {pricingError}
                  </Text>
                ) : null}
              </>
            )}

            <Text style={styles.disclosure}>{UPGRADE_PLAN_LABEL}</Text>
            {storePrice ? <Text style={styles.disclosure}>{storePrice}</Text> : null}
            <Text style={styles.disclosure}>{UPGRADE_RENEWAL_DISCLOSURE}</Text>
            <View style={styles.legalRow}>
              <Text
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(TERMS_OF_USE_URL);
                }}
                style={styles.legalLink}
                testID={TERMS_OF_USE_URL}
              >
                Terms of Use
              </Text>
              <Text
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(PRIVACY_POLICY_URL);
                }}
                style={styles.legalLink}
                testID={PRIVACY_POLICY_URL}
              >
                Privacy Policy
              </Text>
            </View>

            <View style={styles.footerRow}>
              <TextButton
                disabled={isRestoring}
                label={isRestoring ? 'Restoring…' : 'Restore purchases'}
                onPress={() => void onRestore()}
              />
              <TextButton label="Not now" onPress={closeUpgrade} tone="muted" />
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
  contextLine: {
    color: theme.colors.accent,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.size * 1.4,
  },
  disclosure: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.size * 1.4,
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
  legalLink: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
    textDecorationLine: 'underline',
  },
  legalRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
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
  pricingError: {
    color: theme.colors.danger,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.size * 1.4,
  },
  perkRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
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
