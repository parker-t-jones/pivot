import { describe, expect, it } from 'vitest';
import { ExpoPushNotifier, createPushNotifier } from '@pivot/dispatcher';

const required = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  SUPABASE_JWT_SECRET: 'jwt-secret-test',
};

async function loadEnvModule() {
  process.env['SUPABASE_URL'] ??= required.SUPABASE_URL;
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ??= required.SUPABASE_SERVICE_ROLE_KEY;
  process.env['SUPABASE_JWT_SECRET'] ??= required.SUPABASE_JWT_SECRET;
  return import('./env.js');
}

describe('PUSH_DRIVER env', () => {
  it('boots as none when PUSH_DRIVER is unset', async () => {
    const { loadAndValidateEnv } = await loadEnvModule();
    const env = loadAndValidateEnv(required);
    expect(env.PUSH_DRIVER).toBe('none');
    expect(env.EXPO_ACCESS_TOKEN).toBeUndefined();
    expect(createPushNotifier({ pushDriver: env.PUSH_DRIVER }).id).toBe('none');
  });

  it('accepts expo without EXPO_ACCESS_TOKEN and still constructs ExpoPushNotifier', async () => {
    const { loadAndValidateEnv } = await loadEnvModule();
    const env = loadAndValidateEnv({ ...required, PUSH_DRIVER: 'expo' });
    expect(env.PUSH_DRIVER).toBe('expo');
    expect(env.EXPO_ACCESS_TOKEN).toBeUndefined();
    const notifier = createPushNotifier({ pushDriver: env.PUSH_DRIVER });
    expect(notifier).toBeInstanceOf(ExpoPushNotifier);
    expect(notifier.id).toBe('expo');
  });
});
