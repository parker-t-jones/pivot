import { afterEach, describe, expect, it, vi } from 'vitest';

import { lookupSavedGameLink, SAVED_LINK_LOOKUP_MS, withSavedUrl } from './savedGameLink.js';

const payload = {
  action: { type: 'prompt', cta: 'switch_primary', recommended_source: null, deep_link_url: null },
};

describe('lookupSavedGameLink', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the stored url', async () => {
    const url = await lookupSavedGameLink(
      { urlFor: async () => 'https://www.primevideo.com/detail/test' },
      'u1',
      'g1',
    );
    expect(url).toBe('https://www.primevideo.com/detail/test');
  });

  it('returns null for a missing row and for an empty string', async () => {
    expect(await lookupSavedGameLink({ urlFor: async () => null }, 'u1', 'g1')).toBeNull();
    expect(await lookupSavedGameLink({ urlFor: async () => '' }, 'u1', 'g1')).toBeNull();
  });

  it('returns null and warns once when the lookup throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const url = await lookupSavedGameLink(
      {
        urlFor: async () => {
          throw new Error('db down');
        },
      },
      'u1',
      'g1',
    );
    expect(url).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('saved link lookup failed');
  });

  it('returns null and warns once when the lookup exceeds the cap', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pending = lookupSavedGameLink({ urlFor: () => new Promise(() => undefined) }, 'u1', 'g1');
    await vi.advanceTimersByTimeAsync(SAVED_LINK_LOOKUP_MS);
    await expect(pending).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('saved link lookup timed out');
  });
});

describe('withSavedUrl', () => {
  it('adds saved_url on a copy and leaves the original action untouched', () => {
    const next = withSavedUrl(payload, 'https://www.primevideo.com/detail/test');
    expect(next.action).toEqual({
      ...payload.action,
      saved_url: 'https://www.primevideo.com/detail/test',
    });
    expect(payload.action).not.toHaveProperty('saved_url');
    expect(next).not.toBe(payload);
  });

  it('returns the same object when there is no saved url', () => {
    expect(withSavedUrl(payload, null)).toBe(payload);
  });
});
