import { describe, expect, it } from 'vitest';
import { ManualProvider } from './manual-provider.js';

describe('ManualProvider', () => {
  it('reports it does not support sync', () => {
    expect(new ManualProvider().supportsSync()).toBe(false);
  });

  it('throws when asked to fetch a lineup', async () => {
    const provider = new ManualProvider();
    await expect(
      provider.fetchLineup({ externalLeagueId: 'x', externalRosterId: '1', week: 1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'sync_not_supported' });
  });
});
