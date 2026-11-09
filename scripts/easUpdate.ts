/**
 * Publish a JS-only EAS Update to installed iPhones, refusing to publish a bundle that does not
 * talk to the production API. Parker runs this; Claude sessions never do (CLAUDE.md).
 *
 *   pnpm update:ios --message "Fix the Watchlist header copy."
 *
 * `EXPO_PUBLIC_*` values are inlined when the bundle is built, so the API URL an update ships with
 * is whatever the export saw. This splits `eas update` in three so the bundle can be checked
 * between building and uploading:
 *
 *   1. `eas env:exec production '… export'` runs this script's `export` phase with the EAS
 *      `production` environment. That phase refuses unless `EXPO_PUBLIC_API_BASE_URL` is the
 *      production URL, then runs `expo export` with `EXPO_NO_DOTENV=1` so no local `app/.env*`
 *      value can fill a gap.
 *   2. The exported iOS bundle must contain the production URL. No app source hardcodes it
 *      (`easUpdate.test.ts` pins that), so it can only be there because the env inlined it.
 *   3. `eas update --skip-bundler --input-dir dist-update --environment production` uploads
 *      exactly the checked bundle to the `production` channel.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_API_URL = 'https://pivot-sports-api.fly.dev';
export const UPDATE_CHANNEL = 'production';
export const UPDATE_ENVIRONMENT = 'production';
/** Relative to `app/`. Gitignored: `eas update` refuses to run on a dirty tree. */
export const UPDATE_OUTPUT_DIR = 'dist-update';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP_DIR = join(REPO_ROOT, 'app');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

/** Null when the export environment's API URL is production; otherwise why it refuses. */
export function apiUrlRefusal(value: string | undefined): string | null {
  if (!value) {
    return `refusing to publish: EXPO_PUBLIC_API_BASE_URL is not set in the EAS "${UPDATE_ENVIRONMENT}" environment`;
  }
  const normalized = value.trim().replace(/\/+$/, '');
  if (normalized !== PRODUCTION_API_URL) {
    return `refusing to publish: EXPO_PUBLIC_API_BASE_URL is ${value}, not ${PRODUCTION_API_URL}`;
  }
  return null;
}

/** The exported iOS bundles (`.hbc` with Hermes bytecode, `.js` with `--no-bytecode`). */
export function iosBundlePaths(distDir: string): string[] {
  const bundleDir = join(distDir, '_expo', 'static', 'js', 'ios');
  if (!existsSync(bundleDir)) return [];
  return readdirSync(bundleDir)
    .filter((name) => /\.(hbc|js)$/.test(name))
    .map((name) => join(bundleDir, name));
}

/**
 * Null when every exported iOS bundle contains the production API URL; otherwise why it refuses.
 * Hermes keeps string literals as contiguous ASCII in its string table, so a byte search works on
 * bytecode as well as plain JS. Only the positive check is meaningful: third-party code in the
 * bundle already carries `http://localhost:…` strings, so "no localhost" would always fail.
 */
export function bundleRefusal(distDir: string): string | null {
  const bundles = iosBundlePaths(distDir);
  if (bundles.length === 0) {
    return `refusing to publish: no iOS bundle under ${join(distDir, '_expo/static/js/ios')}`;
  }
  const needle = Buffer.from(PRODUCTION_API_URL, 'utf8');
  for (const bundle of bundles) {
    if (readFileSync(bundle).indexOf(needle) === -1) {
      return `refusing to publish: ${bundle} does not contain ${PRODUCTION_API_URL}, so its API URL is not production`;
    }
  }
  return null;
}

/** The `eas update` arguments for publishing an already-exported, already-checked bundle. */
export function easUpdateArgs(message: string): string[] {
  return [
    'update',
    '--channel',
    UPDATE_CHANNEL,
    '--environment',
    UPDATE_ENVIRONMENT,
    '--platform',
    'ios',
    '--skip-bundler',
    '--input-dir',
    UPDATE_OUTPUT_DIR,
    '--message',
    message,
    '--non-interactive',
  ];
}

/** The `expo export` arguments, matching what `eas update` runs itself (`--clear` because
 *  `eas update --environment` clears the cache too: cached transforms hold old inlined env). */
export function expoExportArgs(): string[] {
  return [
    'expo',
    'export',
    '--platform',
    'ios',
    '--output-dir',
    UPDATE_OUTPUT_DIR,
    '--dump-assetmap',
    '--clear',
  ];
}

export function parseMessage(argv: string[]): string | null {
  const index = argv.indexOf('--message');
  const message = index === -1 ? undefined : argv[index + 1];
  return message && message.trim() && !message.startsWith('--') ? message.trim() : null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd: APP_DIR, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} exited with status ${result.status}`);
  }
}

/** Phase 1, run inside `eas env:exec production`. */
function exportPhase(): void {
  const refusal = apiUrlRefusal(process.env['EXPO_PUBLIC_API_BASE_URL']);
  if (refusal) throw new Error(refusal);
  run('npx', expoExportArgs(), { ...process.env, EXPO_NO_DOTENV: '1' });
}

function publish(argv: string[]): void {
  const message = parseMessage(argv);
  if (!message) {
    throw new Error('usage: pnpm update:ios --message "One sentence on what this update fixes."');
  }
  const outputDir = join(APP_DIR, UPDATE_OUTPUT_DIR);
  rmSync(outputDir, { recursive: true, force: true });

  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
  const exportCommand = [process.execPath, tsxCli, SCRIPT_PATH, 'export'].map(shellQuote).join(' ');
  run('eas', ['env:exec', UPDATE_ENVIRONMENT, exportCommand, '--non-interactive']);

  const refusal = bundleRefusal(outputDir);
  if (refusal) throw new Error(refusal);
  console.log(`Bundle check passed: the iOS bundle talks to ${PRODUCTION_API_URL}.`);

  run('eas', easUpdateArgs(message));
}

function main(): void {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] === 'export') exportPhase();
    else publish(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main();
}
