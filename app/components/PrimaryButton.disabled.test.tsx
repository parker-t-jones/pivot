// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

vi.mock('react-native', () => import('react-native-web'));

describe('disabled filled buttons', () => {
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

  it('renders a muted, unpressable primary button', () => {
    const onPress = vi.fn();
    act(() => {
      root.render(<PrimaryButton disabled label="Continue" onPress={onPress} />);
    });
    const button = host.querySelector('[role="button"]');
    if (!(button instanceof HTMLElement)) throw new Error('missing button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(getComputedStyle(button).cursor).toBe('not-allowed');
    expect(normalizeColor(getComputedStyle(button).backgroundColor)).toBe(theme.colors.surface);
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders a muted, unpressable secondary button', () => {
    const onPress = vi.fn();
    act(() => {
      root.render(<SecondaryButton disabled label="Sign out" onPress={onPress} />);
    });
    const button = host.querySelector('[role="button"]');
    if (!(button instanceof HTMLElement)) throw new Error('missing button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(getComputedStyle(button).cursor).toBe('not-allowed');
    const label = button.querySelector('div');
    expect(normalizeColor(getComputedStyle(label ?? button).color)).toBe(theme.colors.textTertiary);
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPress).not.toHaveBeenCalled();
  });
});

function normalizeColor(color: string): string {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return color.toLowerCase();
  const channels = [match[1], match[2], match[3]].map((channel) =>
    Number(channel).toString(16).padStart(2, '0'),
  );
  return `#${channels.join('')}`.toUpperCase();
}
