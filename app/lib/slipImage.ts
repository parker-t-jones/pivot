/**
 * Lets the user choose a bet slip screenshot from their photo library. Returns a base64 JPEG,
 * or null when they cancel. iOS uses the system photo picker, which needs no library permission.
 */
export async function pickSlipImage(): Promise<string | null> {
  // Loaded on tap, so screens that never import a slip don't load the native module.
  const ImagePicker = await import('expo-image-picker');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    base64: true,
    // Smaller upload; a slip stays readable well below full quality.
    quality: 0.7,
  });
  if (result.canceled) return null;
  return result.assets[0]?.base64 ?? null;
}
