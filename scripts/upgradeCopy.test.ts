import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const APP = join(fileURLToPath(new URL('.', import.meta.url)), '../app');
const COMPONENTS = join(APP, 'components');

/** Non-test TS/TSX sources under the app's shipped directories. */
function appSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return appSources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

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
    expect(phone).toContain('upgradePurchaseLabel(storePrice)');
    expect(phone).toContain('Restore purchases');
    expect(phone).not.toContain('UPGRADE_PRICE_FALLBACK');
    const desktop = sheet('UpgradeSheet.web.tsx');
    expect(desktop).not.toContain('Restore purchases');
    expect(desktop).not.toContain('upgradePurchaseLabel');
  });

  it('hardcodes no price anywhere in the app; prices come from RevenueCat', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'contexts', 'lib']) {
      for (const path of appSources(join(APP, dir))) {
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            // `$` followed by a digit is a price; `${` is a template-literal interpolation.
            if (/\$\d/.test(line)) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
