import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { YardLineLoader } from '../components/YardLineLoader';
import { useSession } from '../contexts/SessionContext';
import { homeGameHref } from '../lib/notificationOpenTarget';
import { theme } from '../lib/theme';

export default function IndexScreen() {
  const { isLoading, session } = useSession();
  const params = useLocalSearchParams<{ game?: string | string[] }>();
  const game = Array.isArray(params.game) ? params.game[0] : params.game;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <YardLineLoader size="screen" />
      </View>
    );
  }

  if (session) {
    return <Redirect href={game ? homeGameHref(game) : '/(app)'} />;
  }

  return <Redirect href="/(auth)/welcome" />;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
