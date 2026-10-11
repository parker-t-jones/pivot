import { describe, expect, it } from 'vitest';

import { localUrlRefusal } from './localStack.js';

describe('localUrlRefusal', () => {
  it('accepts loopback and rejects anything else', () => {
    expect(localUrlRefusal('SUPABASE_URL', 'http://127.0.0.1:54321')).toBeNull();
    expect(localUrlRefusal('EXPO_PUBLIC_API_BASE_URL', 'http://localhost:3000')).toBeNull();
    expect(localUrlRefusal('SUPABASE_URL', undefined)).toBe('SUPABASE_URL is not set');
    expect(localUrlRefusal('SUPABASE_URL', 'not a url')).toBe('SUPABASE_URL is not a URL');
    expect(localUrlRefusal('SUPABASE_URL', 'https://taucqrptzfyzhfzpinzo.supabase.co')).toBe(
      'refusing to run: SUPABASE_URL host is taucqrptzfyzhfzpinzo.supabase.co, not localhost or 127.0.0.1',
    );
    expect(localUrlRefusal('EXPO_PUBLIC_API_BASE_URL', 'https://pivot-sports-api.fly.dev')).toBe(
      'refusing to run: EXPO_PUBLIC_API_BASE_URL host is pivot-sports-api.fly.dev, not localhost or 127.0.0.1',
    );
  });
});
