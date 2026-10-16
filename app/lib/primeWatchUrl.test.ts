import { describe, expect, it } from 'vitest';
import { serviceWatchUrl } from '@pivot/shared/broadcast';

import { primeWebSearchUrl, webWatchUrl } from './primeWatchUrl';

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
  it('searches Seahawks vs Broncos for tonight\'s SEA @ DEN', () => {
    expect(primeWebSearchUrl('Seahawks', 'Broncos')).toBe(
      'https://www.primevideo.com/search?ie=UTF8&phrase=Seahawks+vs+Broncos',
    );
    expect(
      webWatchUrl(NATIVE_SEA_DEN, { awayNickname: 'Seahawks', homeNickname: 'Broncos' }),
    ).toBe('https://www.primevideo.com/search?ie=UTF8&phrase=Seahawks+vs+Broncos');
  });

  it('keeps a digit in a nickname (SF → 49ers)', () => {
    expect(primeWebSearchUrl('49ers', 'Broncos')).toBe(
      'https://www.primevideo.com/search?ie=UTF8&phrase=49ers+vs+Broncos',
    );
  });

  it('leaves the native Prime URL for SEA @ DEN unchanged', () => {
    expect(serviceWatchUrl(SEA_DEN)).toEqual(NATIVE_SEA_DEN);
  });
});
