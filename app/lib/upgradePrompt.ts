import { Alert } from 'react-native';

import { ApiRequestError } from './apiClient';
import { isUpgradeCapCode } from './upgradeCap';

export { isUpgradeCapCode, upgradeContextLine } from './upgradeCap';

/**
 * When a free-tier cap fires, offer Upgrade — `openUpgrade` is `useUpgradeSheet().openUpgrade`
 * from the caller. The bet cap opens the paywall directly. League and lineup caps still confirm
 * with an alert. Returns true if the error was handled as a cap prompt.
 */
export function promptUpgradeForCapError(
  error: unknown,
  openUpgrade: (code?: string) => void,
): boolean {
  if (!(error instanceof ApiRequestError) || !isUpgradeCapCode(error.code)) return false;
  if (error.code === 'stake_limit_free') {
    openUpgrade(error.code);
    return true;
  }

  const title =
    error.code === 'league_limit_free' ? 'League limit reached' : 'Lineup limit reached';

  Alert.alert(title, error.message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Upgrade', onPress: () => openUpgrade() },
  ]);
  return true;
}
