import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const COMPONENTS = join(fileURLToPath(new URL('.', import.meta.url)), '../app/components');

function sheet(name: string): string {
  return readFileSync(join(COMPONENTS, name), 'utf8');
}

describe('upgrade sheet copy', () => {
  it('shares the headline and a single Not now dismiss on phone and desktop', () => {
    for (const name of ['UpgradeSheet.tsx', 'UpgradeSheet.web.tsx']) {
      const source = sheet(name);
      expect(source).toContain('UPGRADE_HEADLINE');
      expect(source).toContain('UPGRADE_SUBTITLE');
      expect(source).toContain('PRO_PERKS');
      expect(source).toContain('label="Not now"');
      expect(source).not.toContain('Watch every league that matters');
      expect(source).not.toContain('Every stake');
      expect(source).not.toContain('label="Close"');
      expect(source).not.toContain('styles.price');
    }
    const phone = sheet('UpgradeSheet.tsx');
    expect(phone).toContain('upgradePurchaseLabel(priceLabel)');
    expect(phone).toContain('Restore purchases');
    expect(phone).toContain('UPGRADE_PRICE_FALLBACK');
    const desktop = sheet('UpgradeSheet.web.tsx');
    expect(desktop).not.toContain('Restore purchases');
    expect(desktop).not.toContain('upgradePurchaseLabel');
  });
});
