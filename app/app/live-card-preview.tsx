import { Redirect, useLocalSearchParams } from 'expo-router';

import { LiveCardPreview, type LivePreviewState } from '../components/LiveCardPreview';

const STATES = new Set<LivePreviewState>(['halftime', 'active', 'redzone', 'endq']);

/**
 * Dev-only viewer for the captured Monday-night live card. Production builds redirect home.
 * Open `/live-card-preview?state=halftime` from a local `expo start --web`. No session required.
 */
export default function LiveCardPreviewScreen() {
  const params = useLocalSearchParams<{ state?: string }>();
  if (!__DEV__) return <Redirect href="/(app)" />;
  const requested = params.state;
  const initial =
    requested && STATES.has(requested as LivePreviewState)
      ? (requested as LivePreviewState)
      : 'halftime';
  return <LiveCardPreview initial={initial} />;
}
