// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { FlagChip } from './FlagChip';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('../lib/fonts', () => ({ fonts: { monoSemiBold: 'monospace' } }));

describe('FlagChip', () => {
  it('renders and updates pick labels, including long and empty labels', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      for (const label of ['Over 45.5', 'A long pick label with multiple players and teams', '']) {
        await act(async () => root.render(<FlagChip label={label} />));
        expect(container.textContent).toBe(label);
        expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
