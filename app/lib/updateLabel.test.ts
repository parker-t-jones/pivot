import { describe, expect, it, vi } from 'vitest';

import { updateLabel } from './updateLabel';

vi.mock('expo-updates', () => ({
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
  channel: 'production',
}));

const base = {
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
  channel: 'production',
};

describe('updateLabel', () => {
  it('names the downloaded update and its channel', () => {
    expect(updateLabel(base)).toBe('Running update 0f1e2d3c from the production channel.');
  });

  it('says the build’s own bundle is running before any update lands, or after a rollback to embedded', () => {
    expect(updateLabel({ ...base, isEmbeddedLaunch: true })).toBe(
      'Running the version that shipped with this build.',
    );
    expect(updateLabel({ ...base, updateId: null })).toBe(
      'Running the version that shipped with this build.',
    );
  });

  it('omits the channel when the build has none', () => {
    expect(updateLabel({ ...base, channel: null })).toBe('Running update 0f1e2d3c.');
  });

  it('shows nothing on web, in development builds, or when updates are disabled', () => {
    expect(updateLabel(null)).toBeNull();
    expect(updateLabel({ ...base, isEnabled: false })).toBeNull();
  });
});

describe('runningUpdate', () => {
  it('reads the native module’s launch state on iOS', async () => {
    const { runningUpdate } = await import('./runningUpdate');
    expect(runningUpdate()).toEqual(base);
  });

  it('reports nothing on web, which Pages deploys', async () => {
    const { runningUpdate } = await import('./runningUpdate.web');
    expect(runningUpdate()).toBeNull();
  });
});
