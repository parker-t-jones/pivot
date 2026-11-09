import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PRODUCTION_API_URL,
  UPDATE_OUTPUT_DIR,
  apiUrlRefusal,
  bundleRefusal,
  easUpdateArgs,
  expoExportArgs,
  parseMessage,
} from './easUpdate.js';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP = join(REPO, 'app');

/** Non-test TS/TSX sources the iOS bundle can include. */
function appSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return [];
    if (name === UPDATE_OUTPUT_DIR) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return appSources(path);
    return /\.(tsx?|js)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('apiUrlRefusal', () => {
  it('accepts the production API URL, with or without a trailing slash', () => {
    expect(apiUrlRefusal(PRODUCTION_API_URL)).toBeNull();
    expect(apiUrlRefusal(`${PRODUCTION_API_URL}/`)).toBeNull();
  });

  it('refuses a missing, local, LAN, or other URL', () => {
    expect(apiUrlRefusal(undefined)).toMatch(/not set/);
    expect(apiUrlRefusal('')).toMatch(/not set/);
    for (const url of [
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://192.168.1.20:3000',
      'http://pivot-sports-api.fly.dev',
      'https://pivot-sports-api-staging.fly.dev',
    ]) {
      expect(apiUrlRefusal(url)).toBe(
        `refusing to publish: EXPO_PUBLIC_API_BASE_URL is ${url}, not ${PRODUCTION_API_URL}`,
      );
    }
  });
});

describe('bundleRefusal', () => {
  let dist: string;
  let bundleDir: string;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'eas-update-'));
    bundleDir = join(dist, '_expo', 'static', 'js', 'ios');
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it('refuses when there is no iOS bundle', () => {
    expect(bundleRefusal(dist)).toMatch(/no iOS bundle/);
  });

  it('accepts Hermes bytecode whose string table holds the production URL', () => {
    mkdirSync(bundleDir, { recursive: true });
    // Hermes packs strings back to back, overlapping where it can.
    const bytes = Buffer.concat([
      Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0x00]),
      Buffer.from(`max_widthttps://pivot-sports-api.fly.devPreviewRouteContext`, 'utf8'),
      Buffer.from([0x00, 0xff]),
    ]);
    writeFileSync(join(bundleDir, 'entry-abc.hbc'), bytes);
    expect(bundleRefusal(dist)).toBeNull();
  });

  it('refuses a bundle built against a local API, even when library strings mention localhost', () => {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'entry-abc.hbc'),
      'http://localhost:8081/assets http://127.0.0.1:3000 https://example.supabase.co',
    );
    expect(bundleRefusal(dist)).toMatch(/does not contain https:\/\/pivot-sports-api\.fly\.dev/);
  });

  it('checks every iOS bundle, plain JS included', () => {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'entry-a.js'), `const u = "${PRODUCTION_API_URL}";`);
    writeFileSync(join(bundleDir, 'entry-b.js'), 'const u = "http://127.0.0.1:3000";');
    expect(bundleRefusal(dist)).toMatch(/entry-b\.js does not contain/);
  });
});

describe('the bundle check stays meaningful', () => {
  it('no shipped app source hardcodes the production API URL, so only the inlined env can put it in the bundle', () => {
    const offenders = appSources(APP).filter((path) =>
      readFileSync(path, 'utf8').includes('pivot-sports-api.fly.dev'),
    );
    expect(offenders).toEqual([]);
  });
});

describe('publish commands', () => {
  it('uploads the checked export to the production channel with the production environment', () => {
    expect(easUpdateArgs('Fix the Watchlist header copy.')).toEqual([
      'update',
      '--channel',
      'production',
      '--environment',
      'production',
      '--platform',
      'ios',
      '--skip-bundler',
      '--input-dir',
      UPDATE_OUTPUT_DIR,
      '--message',
      'Fix the Watchlist header copy.',
      '--non-interactive',
    ]);
  });

  it('exports iOS only, into the gitignored directory, with a cleared cache', () => {
    const args = expoExportArgs();
    expect(args.slice(0, 2)).toEqual(['expo', 'export']);
    expect(args).toContain('--clear');
    expect(args.join(' ')).toContain(`--platform ios --output-dir ${UPDATE_OUTPUT_DIR}`);
    expect(readFileSync(join(REPO, '.gitignore'), 'utf8')).toContain(`/app/${UPDATE_OUTPUT_DIR}/`);
  });

  it('requires a message', () => {
    expect(parseMessage(['--message', 'Fix copy.'])).toBe('Fix copy.');
    expect(parseMessage([])).toBeNull();
    expect(parseMessage(['--message'])).toBeNull();
    expect(parseMessage(['--message', '  '])).toBeNull();
    expect(parseMessage(['--message', '--channel'])).toBeNull();
  });
});

describe('EAS Update config', () => {
  interface ExpoConfig {
    slug: string;
    runtimeVersion: unknown;
    updates: unknown;
    ios: { bundleIdentifier: string };
    extra: { eas: { projectId: string } };
  }
  interface EasConfig {
    build: Record<string, { channel?: string } | undefined>;
  }
  const { expo } = JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8')) as { expo: ExpoConfig };
  const eas = JSON.parse(readFileSync(join(APP, 'eas.json'), 'utf8')) as EasConfig;
  const projectId = expo.extra.eas.projectId;

  it('ties updates to the native layer with a fingerprint runtime version', () => {
    expect(expo.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('points at this EAS project and checks in the background without blocking launch', () => {
    expect(expo.updates).toEqual({
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    });
  });

  it('gives production and preview builds their own channels', () => {
    expect(eas.build['production']?.channel).toBe('production');
    expect(eas.build['preview']?.channel).toBe('preview');
  });

  it('leaves the frozen identifiers alone', () => {
    expect(expo.slug).toBe('fantasy-focus');
    expect(expo.ios.bundleIdentifier).toBe('com.fantasyfocus.app');
    expect(projectId).toBe('63e2ba9a-dc24-48cc-af2b-dc2c27014634');
  });

  it('never reloads the app from JS, so a downloaded update waits for the next cold start', () => {
    const offenders = appSources(APP).filter((path) =>
      /reloadAsync|fetchUpdateAsync|checkForUpdateAsync|useUpdates/.test(
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
