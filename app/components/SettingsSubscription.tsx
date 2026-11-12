import { useEffect, type ReactNode } from 'react';
import { Linking, Text } from 'react-native';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { alertAsync } from '../lib/confirm';
import { noteServerTier } from '../lib/subscriptionPlan';
import { useSubscriptionStatus } from '../lib/useSubscriptionStatus';
import { theme } from '../lib/theme';
import { SecondaryButton } from './SecondaryButton';
import { TextButton } from './TextButton';

/** The rendered subscription path in Settings → Account. */
export function SettingsSubscription({
  subscriptionTier,
  children,
}: {
  subscriptionTier: string;
  children?: ReactNode;
}) {
  const { openUpgrade } = useUpgradeSheet();
  const { status } = useSubscriptionStatus();
  useEffect(() => {
    noteServerTier(subscriptionTier === 'pro' ? 'pro' : 'free');
  }, [subscriptionTier]);
  return (
    <>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.type.caption.size,
          marginTop: theme.spacing.xs,
        }}
      >
        {status === 'pro'
          ? 'Pro plan'
          : status === 'activating'
            ? 'Activating Pro...'
            : 'Free plan'}
      </Text>
      {children}
      {status === 'pro' ? (
        <TextButton
          hitArea="padding"
          label="Manage subscription"
          onPress={() => {
            void Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => {
              void alertAsync('Could not open', 'Open Settings → Apple ID → Subscriptions.');
            });
          }}
          size="smallStrong"
          style={{ marginTop: theme.spacing.md }}
        />
      ) : (
        <SecondaryButton
          label="Upgrade to Pro"
          onPress={openUpgrade}
          style={{ marginTop: theme.spacing.md }}
        />
      )}
    </>
  );
}
