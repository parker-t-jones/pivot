// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerSearchField } from './PlayerSearchField';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('../lib/fonts', () => ({
  fonts: {
    monoBold: 'system',
    monoMedium: 'system',
    monoSemiBold: 'system',
    sansBold: 'system',
    sansSemiBold: 'system',
    teamNickname: 'system',
  },
}));
vi.mock('../lib/players', () => ({
  searchPlayers: vi.fn(async () => []),
}));

function pressReturn(field: HTMLInputElement) {
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
  });
}

describe('player search field keyboard', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('puts the keyboard away when the Search key is pressed', () => {
    act(() => {
      root.render(<PlayerSearchField onSelect={() => undefined} />);
    });
    const field = host.querySelector('input');
    if (!field) throw new Error('search field did not render');

    act(() => field.focus());
    expect(document.activeElement).toBe(field);

    pressReturn(field);
    expect(document.activeElement).not.toBe(field);
  });
});
