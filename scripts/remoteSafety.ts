/**
 * Shared CLI bootstrap for scripts that write to Supabase.
 *
 * - Loads env from `--env-file <path>` or `services/api/.env` by default.
 * - Refuses non-localhost `SUPABASE_URL` unless `--allow-remote` is passed.
 * - Fixture broadcast seeders set `forbidRemoteAlways` and never write to hosted.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SEED_ENV_FILE = path.resolve(scriptsDir, '../services/api/.env');

export class RemoteSafetyError extends Error {
  readonly exitCode = 1;

  constructor(message: string) {
    super(message);
    this.name = 'RemoteSafetyError';
  }
}

export interface ScriptCliOptions {
  allowRemote: boolean;
  envFile: string | undefined;
  /** Argv after known flags are stripped (unused by seed scripts today). */
  rest: string[];
}

export function parseScriptCliArgs(argv: readonly string[]): ScriptCliOptions {
  let allowRemote = false;
  let envFile: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      continue;
    }
    if (arg === '--allow-remote') {
      allowRemote = true;
      continue;
    }
    if (arg === '--env-file') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        throw new RemoteSafetyError('--env-file requires a path argument.');
      }
      envFile = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      const value = arg.slice('--env-file='.length);
      if (!value) {
        throw new RemoteSafetyError('--env-file requires a path argument.');
      }
      envFile = value;
      continue;
    }
    rest.push(arg);
  }

  return { allowRemote, envFile, rest };
}

/** True for loopback hosts only — IPv6 localhost included. */
export function isLocalSupabaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export interface AssertDbTargetAllowedOptions {
  supabaseUrl: string | undefined;
  allowRemote: boolean;
  /** Fixture broadcast seeders: refuse hosted even with `--allow-remote`. */
  forbidRemoteAlways?: boolean;
  scriptName: string;
}

export function assertDbTargetAllowed(options: AssertDbTargetAllowedOptions): void {
  const { supabaseUrl, allowRemote, forbidRemoteAlways = false, scriptName } = options;

  if (!supabaseUrl || supabaseUrl.trim() === '') {
    throw new RemoteSafetyError(
      `${scriptName}: SUPABASE_URL is missing. Set it via --env-file or services/api/.env.`,
    );
  }

  if (isLocalSupabaseUrl(supabaseUrl)) {
    return;
  }

  if (forbidRemoteAlways) {
    throw new RemoteSafetyError(
      `${scriptName}: refuses remote SUPABASE_URL (${supabaseUrl}). ` +
        `This script writes fixture broadcast rotation data and must not run against hosted. ` +
        `Use the B1 ESPN seed path when it lands.`,
    );
  }

  if (!allowRemote) {
    throw new RemoteSafetyError(
      `${scriptName}: SUPABASE_URL points at a remote host (${supabaseUrl}). ` +
        `Re-run with --allow-remote (and preferably --env-file .env.production) to confirm.`,
    );
  }
}

export function loadScriptEnv(envFile: string | undefined): string {
  const resolved = envFile ? path.resolve(envFile) : DEFAULT_SEED_ENV_FILE;
  loadEnv({ path: resolved, quiet: true });
  return resolved;
}

export interface BootstrapSeedScriptOptions {
  argv?: readonly string[];
  scriptName: string;
  forbidRemoteAlways?: boolean;
  /** Override default `services/api/.env` when no `--env-file` is passed. */
  defaultEnvFile?: string;
}

/**
 * Parse CLI flags, load dotenv, assert remote safety. Call once at the top of a seed script's main.
 * Returns the parsed options (for tests / logging).
 */
export function bootstrapSeedScript(options: BootstrapSeedScriptOptions): ScriptCliOptions {
  const cli = parseScriptCliArgs(options.argv ?? process.argv.slice(2));
  const envPath = cli.envFile ?? options.defaultEnvFile;
  loadScriptEnv(envPath);
  assertDbTargetAllowed({
    supabaseUrl: process.env['SUPABASE_URL'],
    allowRemote: cli.allowRemote,
    forbidRemoteAlways: options.forbidRemoteAlways,
    scriptName: options.scriptName,
  });
  return cli;
}
