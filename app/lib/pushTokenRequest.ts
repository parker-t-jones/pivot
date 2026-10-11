/** Posted on every launch that can produce a token. The token string being unchanged is not a skip:
 *  an upgraded install still has a null `expo_push_device_id`, and the foreground socket
 *  suppresses the push only after that column matches this device. */
export function pushTokenRequestBody(token: string, deviceId: string): {
  token: string;
  platform: 'ios';
  deviceId: string;
} {
  return { token, platform: 'ios', deviceId };
}
