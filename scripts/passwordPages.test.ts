import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('password screens use the autofill props', () => {
  it('spreads the field hints and wraps each credential form', () => {
    const signIn = read('app/app/(auth)/sign-in.tsx');
    const signUp = read('app/app/(auth)/sign-up.tsx');
    const forgot = read('app/app/(auth)/forgot-password.tsx');
    const reset = read('app/app/reset-password.tsx');
    const change = read('app/app/(app)/change-password.tsx');
    expect(signIn).toContain('PASSWORD_FIELD_AUTOFILL.signIn.email');
    expect(signIn).toContain('PASSWORD_FIELD_AUTOFILL.signIn.password');
    expect(signIn).toContain('<AuthForm');
    expect(signUp).toContain('PASSWORD_FIELD_AUTOFILL.signUp.password');
    expect(signUp).toContain('<AuthForm');
    expect(forgot).toContain('PASSWORD_FIELD_AUTOFILL.forgot.email');
    expect(forgot).toContain('<AuthForm');
    expect(reset).toContain('PASSWORD_FIELD_AUTOFILL.reset.password');
    expect(reset).toContain('<AuthForm');
    expect(change).toContain('PASSWORD_FIELD_AUTOFILL.change.current');
    expect(change).toContain('PASSWORD_FIELD_AUTOFILL.change.password');
    expect(change).toContain('<AuthForm');
  });
});

describe('Apple associated domains', () => {
  it('serves webcredentials for this team and bundle, and nothing else', () => {
    const body = JSON.parse(read('app/public/.well-known/apple-app-site-association')) as {
      webcredentials?: { apps?: string[] };
    };
    expect(body).toEqual({
      webcredentials: { apps: ['LY2XMRG6VY.com.fantasyfocus.app'] },
    });
    expect(JSON.stringify(body)).not.toContain('applinks');
  });

  it('keeps the SPA fallback from swallowing /.well-known and sets the JSON content type', () => {
    const redirects = read('app/public/_redirects');
    const headers = read('app/public/_headers');
    const wellKnown = redirects.indexOf('/.well-known/');
    const splat = redirects.indexOf('/* /index.html 200');
    expect(wellKnown).toBeGreaterThanOrEqual(0);
    expect(splat).toBeGreaterThan(wellKnown);
    expect(redirects).toContain(
      '/.well-known/apple-app-site-association /.well-known/apple-app-site-association 200',
    );
    expect(redirects).toContain('/.well-known/* /.well-known/:splat 200');
    expect(headers).toContain('/.well-known/apple-app-site-association');
    expect(headers).toContain('Content-Type: application/json');
  });

  it('claims webcredentials only on the app domain', () => {
    const appJson = JSON.parse(read('app/app.json')) as {
      expo: {
        slug: string;
        ios: { bundleIdentifier: string; associatedDomains?: string[] };
        plugins: unknown[];
      };
    };
    expect(appJson.expo.slug).toBe('fantasy-focus');
    expect(appJson.expo.ios.bundleIdentifier).toBe('com.fantasyfocus.app');
    expect(appJson.expo.ios.associatedDomains).toEqual(['webcredentials:app.pivot-sports.app']);
    expect(JSON.stringify(appJson.expo.ios.associatedDomains)).not.toContain('applinks');
    expect(appJson.expo.plugins).toContainEqual([
      'expo-local-authentication',
      { faceIDPermission: "Confirm it's you before changing your password." },
    ]);
  });
});

describe('local auth config', () => {
  const toml = read('supabase/config.toml');

  it('renames inbucket to local_smtp and allow-lists the local reset origins', () => {
    expect(toml).toContain('[local_smtp]');
    expect(toml).not.toMatch(/^\[inbucket\]/m);
    expect(toml).toContain('port = 54324');
    for (const origin of [
      'http://localhost:8084',
      'http://127.0.0.1:8084',
      'http://localhost:8085',
      'http://127.0.0.1:8085',
    ]) {
      expect(toml).toContain(`${origin}/reset-password`);
    }
  });
});
