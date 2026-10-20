import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../app');
const BANNED = [/Add a stake/i, /\bAdd stake\b/, /ADD A STAKE/];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'node_modules' || name.endsWith('.test.ts') || name.endsWith('.test.tsx'))
      continue;
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...sourceFiles(path));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) found.push(path);
  }
  return found;
}

describe('add a pick copy', () => {
  it('keeps the old add-a-stake wording out of the app source', () => {
    const hits: string[] = [];
    for (const path of sourceFiles(APP_ROOT)) {
      const text = readFileSync(path, 'utf8');
      for (const pattern of BANNED) {
        if (pattern.test(text)) hits.push(`${path} matches ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
