import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { YardLineLoader } from '../components/YardLineLoader';
import { useSession } from '../contexts/SessionContext';
import { theme } from '../lib/theme';

export default function IndexScreen() {
  const { isLoading, session } = useSession();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <YardLineLoader size="screen" />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(app)" />;
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
