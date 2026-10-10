import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
loadEnv({ path: envFile, quiet: true });

const WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const;

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

const supabaseUrl = process.env['SUPABASE_URL'];
const localReady = Boolean(supabaseUrl && isLoopback(supabaseUrl));

/** Local `supabase start` database. Postgres owns the migrations, so a table it creates uses its default privileges. */
function localDbUrl(): string {
  return process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

function psql(sql: string): string {
  return execFileSync(
    'psql',
    [localDbUrl(), '--no-psqlrc', '--tuples-only', '--no-align', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function writeGrants(tableName?: string): string[] {
  const tableFilter = tableName ? `AND table_name = '${tableName}'` : '';
  const sql = `
    SELECT table_name || ' ' || grantee || ' ' || privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      ${tableFilter}
    ORDER BY 1
  `;
  const output = psql(sql);
  return output.length === 0 ? [] : output.split('\n');
}

describe.skipIf(!localReady)('public client grants stay closed', () => {
  const probe = `_grant_guard_${Date.now()}`;

  afterAll(() => {
    psql(`DROP TABLE IF EXISTS public.${probe}`);
  });

  it('gives anon and authenticated no write privilege on any public table', () => {
    expect(writeGrants()).toEqual([]);
    expect(WRITE_PRIVILEGES).toHaveLength(4);
  });

  it('creates a new table with no write privilege for anon or authenticated', () => {
    psql(`CREATE TABLE public.${probe} (id integer)`);
    expect(writeGrants(probe)).toEqual([]);
  });
});
