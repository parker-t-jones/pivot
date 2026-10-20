import { useRouter } from 'expo-router';

import { AddPickFlow } from '../../components/AddPickFlow';

/** Phone and medium windows. Wide web opens {@link AddPickDrawer} instead of this route. */
export default function AddStakeScreen() {
  const router = useRouter();
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/(tabs)/lineup');
  };
  return <AddPickFlow onDismiss={leave} />;
}
