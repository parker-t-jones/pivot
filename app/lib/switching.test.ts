import { describe, expect, it } from 'vitest';
import { createPlaybackSources, resolveSwitch } from './switching';

describe('createPlaybackSources', () => {
  it('lists cast sources before deep-link (priority order) with the expected ids', () => {
    expect(createPlaybackSources().map((s) => s.id)).toEqual(['airplay', 'chromecast', 'deeplink']);
  });
});

describe('resolveSwitch', () => {
  it('resolves to a deep-link video session when the game has a deep link', async () => {
    const result = await resolveSwitch(
      { id: 'g1', deepLinkUrl: 'https://example.com/watch/g1' },
      { subscribedServices: [] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.source).toBe('deeplink');
      expect(result.session.gameId).toBe('g1');
      expect(result.session.deepLinkUrl).toBe('https://example.com/watch/g1');
    }
  });

  it('fails with no_source when the game has no deep link (Sprint 8 sources are stubs)', async () => {
    const result = await resolveSwitch({ id: 'g1' }, { subscribedServices: [] });

    expect(result).toEqual({ ok: false, reason: 'no_source' });
  });
});
