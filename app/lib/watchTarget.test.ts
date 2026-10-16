import { describe, expect, it } from 'vitest';

import { nativeSwitchUrl, resolveWatchUrl, webSwitchUrl } from './watchTarget';

const GENERATED = 'https://www.youtube.com/watch?v=abc';
const CUSTOM = 'https://www.primevideo.com/detail/test';

describe('resolveWatchUrl', () => {
  it('prefers a custom url', () => {
    expect(resolveWatchUrl({ customUrl: CUSTOM, generatedUrl: GENERATED })).toBe(CUSTOM);
  });

  it('falls back to the generated url', () => {
    expect(resolveWatchUrl({ customUrl: null, generatedUrl: GENERATED })).toBe(GENERATED);
    expect(resolveWatchUrl({ generatedUrl: GENERATED })).toBe(GENERATED);
  });

  it('treats an empty string as no custom link', () => {
    expect(resolveWatchUrl({ customUrl: '', generatedUrl: GENERATED })).toBe(GENERATED);
  });
});

describe('SwitchingContext', () => {
  it('opens a stored link instead of the generated url', () => {
    const matchup = { awayNickname: 'Seahawks', homeNickname: 'Broncos' };
    const search = webSwitchUrl({
      customUrl: '',
      deepLinkUrl: 'https://app.primevideo.com/detail/x',
      matchup,
    });
    expect(search).toMatch(/primevideo\.com\/search/);

    expect(
      webSwitchUrl({
        customUrl: CUSTOM,
        deepLinkUrl: 'https://app.primevideo.com/detail/x',
        matchup,
      }),
    ).toBe(CUSTOM);
    expect(
      nativeSwitchUrl({
        customUrl: CUSTOM,
        generatedUrl: 'https://app.primevideo.com/detail/x',
      }),
    ).toBe(CUSTOM);
  });
});
