// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadingState } from './LoadingState';
import { YardLineLoader } from './YardLineLoader';

vi.mock('react-native', () => import('react-native-web'));

function matchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
}

describe('YardLineLoader', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('names the field Loading and sweeps when motion is allowed', () => {
    matchMedia(false);
    act(() => {
      root.render(<YardLineLoader size="section" />);
    });
    const field = host.querySelector('[data-testid="yard-line-loader"]');
    expect(field?.getAttribute('aria-label')).toBe('Loading');
    expect(host.querySelector('[data-testid="yard-line-sweep"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="yard-line-static"]')).toBeNull();
  });

  it('holds the markers still when reduced motion is on', () => {
    matchMedia(true);
    act(() => {
      root.render(<YardLineLoader size="screen" />);
    });
    expect(host.querySelector('[data-testid="yard-line-loader"]')?.getAttribute('aria-label')).toBe(
      'Loading',
    );
    expect(host.querySelector('[data-testid="yard-line-static"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="yard-line-sweep"]')).toBeNull();
  });

  it('renders the compact strip with the same label', () => {
    matchMedia(false);
    act(() => {
      root.render(<YardLineLoader size="compact" />);
    });
    expect(host.querySelector('[data-testid="yard-line-loader"]')?.getAttribute('aria-label')).toBe(
      'Loading',
    );
  });
});

describe('LoadingState', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    matchMedia(false);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('uses the yard-line loader for a full block and a section block', () => {
    act(() => {
      root.render(
        <div>
          <LoadingState message="Loading settings…" />
          <LoadingState inline message="Loading games…" />
        </div>,
      );
    });
    expect(host.querySelectorAll('[data-testid="yard-line-loader"]')).toHaveLength(2);
    expect(host.textContent).toContain('Loading settings…');
    expect(host.textContent).toContain('Loading games…');
  });
});
