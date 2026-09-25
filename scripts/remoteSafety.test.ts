import { describe, expect, it } from 'vitest';
import {
  assertDbTargetAllowed,
  isLocalSupabaseUrl,
  parseScriptCliArgs,
  RemoteSafetyError,
} from './remoteSafety.js';

describe('isLocalSupabaseUrl', () => {
  it('accepts 127.0.0.1 and localhost', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalSupabaseUrl('http://localhost:54321')).toBe(true);
    expect(isLocalSupabaseUrl('http://[::1]:54321')).toBe(true);
  });

  it('rejects hosted Supabase and garbage', () => {
    expect(isLocalSupabaseUrl('https://example.supabase.co')).toBe(false);
    expect(isLocalSupabaseUrl('https://abc.supabase.co')).toBe(false);
    expect(isLocalSupabaseUrl('not-a-url')).toBe(false);
  });
});

describe('parseScriptCliArgs', () => {
  it('parses --allow-remote and --env-file forms', () => {
    expect(parseScriptCliArgs(['--allow-remote', '--env-file', '.env.production'])).toEqual({
      allowRemote: true,
      envFile: '.env.production',
      rest: [],
    });
    expect(parseScriptCliArgs(['--env-file=.env.production', 'extra'])).toEqual({
      allowRemote: false,
      envFile: '.env.production',
      rest: ['extra'],
    });
  });

  it('throws when --env-file has no path', () => {
    expect(() => parseScriptCliArgs(['--env-file'])).toThrow(RemoteSafetyError);
    expect(() => parseScriptCliArgs(['--env-file='])).toThrow(RemoteSafetyError);
  });
});

describe('assertDbTargetAllowed', () => {
  it('allows localhost without the flag', () => {
    expect(() =>
      assertDbTargetAllowed({
        supabaseUrl: 'http://127.0.0.1:54321',
        allowRemote: false,
        scriptName: 'seed:schedule',
      }),
    ).not.toThrow();
  });

  it('blocks remote without --allow-remote', () => {
    expect(() =>
      assertDbTargetAllowed({
        supabaseUrl: 'https://example.supabase.co',
        allowRemote: false,
        scriptName: 'seed:schedule',
      }),
    ).toThrow(/--allow-remote/);
  });

  it('allows remote when --allow-remote is set', () => {
    expect(() =>
      assertDbTargetAllowed({
        supabaseUrl: 'https://example.supabase.co',
        allowRemote: true,
        scriptName: 'seed:schedule',
      }),
    ).not.toThrow();
  });

  it('refuses remote forever when forbidRemoteAlways (fixture broadcasts)', () => {
    expect(() =>
      assertDbTargetAllowed({
        supabaseUrl: 'https://example.supabase.co',
        allowRemote: true,
        forbidRemoteAlways: true,
        scriptName: 'seed:broadcasts',
      }),
    ).toThrow(/refuses remote/);
  });

  it('errors when SUPABASE_URL is missing', () => {
    expect(() =>
      assertDbTargetAllowed({
        supabaseUrl: undefined,
        allowRemote: false,
        scriptName: 'seed:players',
      }),
    ).toThrow(/SUPABASE_URL is missing/);
  });
});
