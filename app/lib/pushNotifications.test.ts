import { describe, expect, it } from 'vitest';
import { pushTokenRequestBody } from './pushTokenRequest';

const TOKEN = 'ExponentPushToken[abc123DEF456]';
const DEVICE = '11111111-1111-4111-8111-111111111111';

describe('pushTokenRequestBody', () => {
  it('sends deviceId when the cached value is only the token from the previous build', () => {
    const previousCache = TOKEN;
    const body = pushTokenRequestBody(TOKEN, DEVICE);
    expect(body).toEqual({ token: TOKEN, platform: 'ios', deviceId: DEVICE });
    expect(previousCache).not.toBe(`${TOKEN}\n${DEVICE}`);
  });

  it('still sends deviceId when this build already cached the token and the device', () => {
    const cached = `${TOKEN}\n${DEVICE}`;
    const body = pushTokenRequestBody(TOKEN, DEVICE);
    expect(cached).toBe(`${body.token}\n${body.deviceId}`);
    expect(body.deviceId).toBe(DEVICE);
  });
});
