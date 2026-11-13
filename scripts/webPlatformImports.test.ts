import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const APP = join(fileURLToPath(new URL('.', import.meta.url)), '../app');

/** Non-test `*.web.ts(x)` sources under the app's shipped directories. */
function webSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return webSources(path);
    return /\.web\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('web platform files', () => {
  it('never import a value from their own base module', () => {
    // On web, `./Foo` resolves to `Foo.web.tsx`, so `Foo.web.tsx` importing a value from `./Foo`
    // imports itself. A re-exported getter then calls itself until the stack overflows, and the
    // screen is blank. `import type` is erased and safe.
    const offenders: string[] = [];
    for (const path of webSources(APP)) {
      const base = (path.split('/').pop() ?? '').replace(/\.web\.tsx?$/, '');
      const statements = readFileSync(path, 'utf8').match(
        /(?:import|export)\s[^;]*?from\s+['"][^'"]+['"]/g,
      );
      for (const statement of statements ?? []) {
        const self = statement.endsWith(`'./${base}'`) || statement.endsWith(`"./${base}"`);
        if (self && !/^import\s+type\s/.test(statement)) offenders.push(`${path}: ${statement}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
