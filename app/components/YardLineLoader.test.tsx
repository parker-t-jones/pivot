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

  it('renders the compact strip with the same label and no field markings', () => {
    matchMedia(false);
    act(() => {
      root.render(<YardLineLoader size="compact" />);
    });
    expect(host.querySelector('[data-testid="yard-line-loader"]')?.getAttribute('aria-label')).toBe(
      'Loading',
    );
    expect(host.textContent).not.toContain('…');
    expect(host.textContent).not.toContain('...');
    expect(host.querySelectorAll('[data-testid="yard-line-end-zone"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="yard-line-pylon"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="yard-line-goalpost"]')).toHaveLength(0);
  });

  it('paints both end zones, eight pylons, and two goalposts on the large sizes', () => {
    matchMedia(false);
    for (const size of ['screen', 'section'] as const) {
      act(() => {
        root.render(<YardLineLoader size={size} />);
      });
      expect(
        host.querySelector('[data-testid="yard-line-loader"]')?.getAttribute('aria-label'),
      ).toBe('Loading');
      expect(host.querySelectorAll('[data-testid="yard-line-end-zone"]')).toHaveLength(2);
      expect(host.querySelectorAll('[data-testid="yard-line-pylon"]')).toHaveLength(8);
      expect(host.querySelectorAll('[data-testid="yard-line-goalpost"]')).toHaveLength(2);
    }
  });

  it('keeps the end-zone markings when reduced motion holds the sweep', () => {
    matchMedia(true);
    act(() => {
      root.render(<YardLineLoader size="section" />);
    });
    expect(host.querySelector('[data-testid="yard-line-static"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="yard-line-sweep"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="yard-line-pylon"]')).toHaveLength(8);
    expect(host.querySelectorAll('[data-testid="yard-line-goalpost"]')).toHaveLength(2);
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

  it('says Loading, with no ellipsis, matching the field label', () => {
    act(() => {
      root.render(<LoadingState />);
    });
    expect(host.textContent).toContain('Loading');
    expect(host.textContent).not.toContain('Loading…');
    expect(host.textContent).not.toContain('Loading...');
    expect(host.querySelector('[data-testid="yard-line-loader"]')?.getAttribute('aria-label')).toBe(
      'Loading',
    );
    expect(host.querySelectorAll('[data-testid="yard-line-pylon"]').length).toBeGreaterThan(0);
  });
});
