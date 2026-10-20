import { Redirect, useLocalSearchParams } from 'expo-router';

import { LiveCardPreview, type LivePreviewState } from '../components/LiveCardPreview';

const STATES = new Set<LivePreviewState>(['halftime', 'active', 'redzone', 'endq']);

/**
 * Dev-only viewer. In a production bundle Metro substitutes an empty module for
 * `LiveCardPreview` and the Monday-night fixture (app/metro.config.js), and this screen
 * redirects home before that module is used. Open `/live-card-preview` from `expo start --web`.
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
