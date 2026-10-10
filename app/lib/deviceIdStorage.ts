const STORAGE_KEY = 'pivot.device-id';

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DeviceIdStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

/** One id per install. Storage failures still return an id for this process. */
export async function readOrCreateDeviceId(
  storage: DeviceIdStorage | undefined,
  randomUUID: () => string,
): Promise<string> {
  let existing: string | null = null;
  try {
    existing = (await storage?.getItem(STORAGE_KEY)) ?? null;
  } catch {
    existing = null;
  }
  if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;

  const created = randomUUID();
  try {
    await storage?.setItem(STORAGE_KEY, created);
  } catch {
    // Quota, private mode, or a SecureStore failure. This process still has an id.
  }
  return created;
}
