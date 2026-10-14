import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('web purchases split', () => {
  it('does not import RevenueCat', () => {
    const source = codeOnly(
      readFileSync(new URL('../app/lib/purchases.web.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain('react-native-purchases');
    expect(source).not.toMatch(/\bPurchases\b/);
  });

  it('the web upgrade sheet shows status and does not import purchases', () => {
    const source = readFileSync(
      new URL('../app/components/UpgradeSheet.web.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('webUpgradeStatus');
    expect(source).not.toContain('react-native-purchases');
    expect(source).not.toContain("from '../lib/purchases'");
    expect(source).not.toContain('Restore purchases');
    expect(source).not.toContain('Manage subscription');
    expect(source).not.toContain('Upgrade —');
  });
});
