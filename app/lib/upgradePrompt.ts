import { Alert } from 'react-native';

import { ApiRequestError } from './apiClient';

/**
 * When free-tier connect / lineup caps fire (`league_limit_free`, `manual_lineup_limit_free`),
 * offer Upgrade — `openUpgrade` is `useUpgradeSheet().openUpgrade` from the caller. Returns true
 * if the error was handled as a cap prompt.
 */
export function promptUpgradeForCapError(error: unknown, openUpgrade: () => void): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.code !== 'league_limit_free' && error.code !== 'manual_lineup_limit_free') {
    return false;
  }

  const title =
    error.code === 'league_limit_free' ? 'League limit reached' : 'Lineup limit reached';

  Alert.alert(title, error.message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Upgrade', onPress: openUpgrade },
  ]);
  return true;
}
