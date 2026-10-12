import { describe, expect, it } from 'vitest';

import { desktopTier } from './desktopLayout';

describe('desktopTier', () => {
  it('keeps a snapped window on the phone composition', () => {
    expect(desktopTier(600)).toBe('companion');
    expect(desktopTier(899)).toBe('companion');
  });

  it('uses the icon rail from 900 through 1279', () => {
    expect(desktopTier(900)).toBe('medium');
    expect(desktopTier(1024)).toBe('medium');
    expect(desktopTier(1279)).toBe('medium');
  });

  it('uses the labeled sidebar at 1280 and above', () => {
    expect(desktopTier(1280)).toBe('wide');
    expect(desktopTier(1440)).toBe('wide');
  });
});
