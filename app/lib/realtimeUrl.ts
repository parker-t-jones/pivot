/**
 * Builds the Section 9 WebSocket URL from the same `EXPO_PUBLIC_API_BASE_URL` REST uses.
 * Realtime is mounted at `/v1/realtime` while REST routes are unprefixed — never double `/v1`.
 */
export function buildRealtimeWsUrl(
  apiBaseUrl: string,
  token: string,
  identity?: { deviceId: string; platform: 'ios' | 'web' },
): string {
  const trimmed = apiBaseUrl.replace(/\/+$/, '');
  let wsOrigin: string;
  if (trimmed.startsWith('https://')) {
    wsOrigin = `wss://${trimmed.slice('https://'.length)}`;
  } else if (trimmed.startsWith('http://')) {
    wsOrigin = `ws://${trimmed.slice('http://'.length)}`;
  } else {
    throw new Error(
      `EXPO_PUBLIC_API_BASE_URL must be an http(s) URL (got "${apiBaseUrl}").`,
    );
  }

  const url = new URL(`${wsOrigin}/v1/realtime`);
  url.searchParams.set('token', token);
  if (identity) {
    url.searchParams.set('deviceId', identity.deviceId);
    url.searchParams.set('platform', identity.platform);
  }
  return url.toString();
}
