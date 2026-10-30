import { describe, expect, it } from 'vitest';
import { serviceWatchUrl } from '@pivot/shared/broadcast';

import { iosWatchUrl, webWatchUrl } from './primeWatchUrl';

/** Tonight's SEA @ DEN, Thursday 8:15pm ET. */
const SEA_DEN_KICKOFF = new Date('2026-10-16T00:15:00Z');

const SEA_DEN = {
  service: 'amazon_prime' as const,
  awayNickname: 'Seahawks',
  homeNickname: 'Broncos',
  kickoff: SEA_DEN_KICKOFF,
  network: 'amazon_prime' as const,
};

/** What `serviceWatchUrl` produced for this game before the web search was added. */
const NATIVE_SEA_DEN = 'https://app.primevideo.com/search?phrase=Thursday%20Night%20Football';

describe('prime web watch URL', () => {
  it('opens the storefront for a Prime game and the detail page on iOS', () => {
    expect(
      webWatchUrl(NATIVE_SEA_DEN, { awayNickname: 'Seahawks', homeNickname: 'Broncos' }),
    ).toBe('https://www.primevideo.com/storefront');
    expect(
      webWatchUrl('https://www.primevideo.com/splash/t/getTheApp?ref_=atv_dl_rdr', {
        awayNickname: 'Seahawks',
        homeNickname: 'Broncos',
      }),
    ).toBe('https://www.primevideo.com/storefront');
    expect(iosWatchUrl(NATIVE_SEA_DEN)).toBe('https://app.primevideo.com/detail?gti=%7BGTI%7D');
    expect(serviceWatchUrl(SEA_DEN)).toBe('https://app.primevideo.com/detail?gti=%7BGTI%7D');
  });

  it('leaves a non-Prime link unchanged', () => {
    const youtube = 'https://tv.youtube.com/search/Seahawks%20vs%20Broncos%20today';
    expect(webWatchUrl(youtube, { awayNickname: 'Seahawks', homeNickname: 'Broncos' })).toBe(
      youtube,
    );
    expect(iosWatchUrl(youtube)).toBe(youtube);
  });
});
