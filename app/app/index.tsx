import { Redirect, useLocalSearchParams } from 'expo-router';

import { LoadingState } from '../components/LoadingState';
import { useSession } from '../contexts/SessionContext';
import { homeGameHref } from '../lib/notificationOpenTarget';

export default function IndexScreen() {
  const { isLoading, session } = useSession();
  const params = useLocalSearchParams<{ game?: string | string[] }>();
  const game = Array.isArray(params.game) ? params.game[0] : params.game;

  if (isLoading) {
    return <LoadingState message="Checking your session…" step={2} steps={5} />;
  }

  if (session) {
    return <Redirect href={game ? homeGameHref(game) : '/(app)'} />;
  }

  return <Redirect href="/(auth)/welcome" />;
}
