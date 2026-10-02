import { describe, expect, it, vi } from 'vitest';
import { selectWatchLink, watchLinkAttemptOrder } from './watchLink';

const HTTPS = 'https://www.primevideo.com/collection/tnf';
const SCHEME = 'aiv://aiv/watch';

describe('watchLinkAttemptOrder', () => {
  it('uses the https link alone when no scheme is supplied', () => {
    expect(watchLinkAttemptOrder({ httpsUrl: HTTPS })).toEqual([HTTPS]);
    expect(watchLinkAttemptOrder({ httpsUrl: HTTPS, schemeUrl: null })).toEqual([HTTPS]);
    expect(watchLinkAttemptOrder({ httpsUrl: HTTPS, schemeUrl: '  ' })).toEqual([HTTPS]);
  });

  it('tries a custom scheme before the https link', () => {
    expect(watchLinkAttemptOrder({ httpsUrl: HTTPS, schemeUrl: SCHEME })).toEqual([SCHEME, HTTPS]);
  });

  it('does not treat an https value as a custom scheme', () => {
    expect(
      watchLinkAttemptOrder({
        httpsUrl: HTTPS,
        schemeUrl: 'https://www.primevideo.com/',
      }),
    ).toEqual([HTTPS]);
  });

  it('drops a blank https link', () => {
    expect(watchLinkAttemptOrder({ httpsUrl: '  ', schemeUrl: SCHEME })).toEqual([SCHEME]);
    expect(watchLinkAttemptOrder({ httpsUrl: '' })).toEqual([]);
  });
});

describe('selectWatchLink', () => {
  it('opens the https link without asking canOpen', async () => {
    const canOpen = vi.fn(async () => true);
    await expect(selectWatchLink({ httpsUrl: HTTPS }, canOpen)).resolves.toBe(HTTPS);
    expect(canOpen).not.toHaveBeenCalled();
  });

  it('uses the scheme when canOpen accepts it', async () => {
    const canOpen = vi.fn(async (url: string) => url === SCHEME);
    await expect(selectWatchLink({ httpsUrl: HTTPS, schemeUrl: SCHEME }, canOpen)).resolves.toBe(
      SCHEME,
    );
    expect(canOpen).toHaveBeenCalledTimes(1);
    expect(canOpen).toHaveBeenCalledWith(SCHEME);
  });

  it('falls back to the https link when the scheme cannot be opened', async () => {
    const canOpen = vi.fn(async () => false);
    await expect(selectWatchLink({ httpsUrl: HTTPS, schemeUrl: SCHEME }, canOpen)).resolves.toBe(
      HTTPS,
    );
    expect(canOpen).toHaveBeenCalledTimes(1);
  });

  it('returns null when the only candidate is a scheme that cannot be opened', async () => {
    const canOpen = vi.fn(async () => false);
    await expect(selectWatchLink({ httpsUrl: '', schemeUrl: SCHEME }, canOpen)).resolves.toBeNull();
  });
});
