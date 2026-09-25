/**
 * THROWAWAY — not part of the Pivot app, not production code.
 *
 * Prints a summary of captured `experiments/logs/events-*.jsonl` and `markers-*.jsonl`
 * so P0 recon can cite file size, line count, game ids, and one example line.
 *
 *   npx tsx experiments/fixture-shape-probe.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, 'logs');

function matches(name: string): boolean {
  return (
    (name.startsWith('events-') || name.startsWith('markers-')) && name.endsWith('.jsonl')
  );
}

function summarize(filePath: string): void {
  const stat = statSync(filePath);
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const gameIds = new Set<string>();
  const kinds = new Set<string>();
  const keys = new Set<string>();
  let example: string | null = null;

  for (const line of lines) {
    if (example === null) example = line;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      kinds.add('UNPARSEABLE');
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    for (const key of Object.keys(record)) keys.add(key);
    if (typeof record['kind'] === 'string') kinds.add(record['kind']);
    if (typeof record['gameId'] === 'string') gameIds.add(record['gameId']);
  }

  console.log(`FILE ${path.basename(filePath)}`);
  console.log(`  bytes ${stat.size}`);
  console.log(`  lines ${lines.length}`);
  console.log(`  gameIds ${gameIds.size === 0 ? '(none)' : [...gameIds].sort().join(',')}`);
  console.log(`  kinds ${kinds.size === 0 ? '(none)' : [...kinds].sort().join(',')}`);
  console.log(`  keys ${[...keys].sort().join(',')}`);
  console.log(`  example ${example ?? '(empty)'}`);
  console.log('');
}

const names = readdirSync(LOG_DIR).filter(matches).sort();
console.log(`dir ${LOG_DIR}`);
console.log(`matched ${names.length}`);
console.log('');
for (const name of names) summarize(path.join(LOG_DIR, name));
