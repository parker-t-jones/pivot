// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AlertTiming } from '../lib/alertTiming';
import type { AlertTimingPatch } from '../lib/me';
import { AlertTimingSection } from './AlertTimingSection';

vi.mock('react-native', () => import('react-native-web'));

function button(host: HTMLElement, label: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

describe('AlertTimingSection', () => {
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

  function render(
    alertTiming: AlertTiming,
    options: {
      services?: ('youtube_tv' | 'peacock')[];
      editsLocked?: boolean;
      onChange?: (patch: AlertTimingPatch) => Promise<void>;
      onError?: (error: unknown) => void;
    } = {},
  ): void {
    act(() => {
      root.render(
        createElement(AlertTimingSection, {
          alertTiming,
          services: options.services ?? ['youtube_tv', 'peacock'],
          editsLocked: options.editsLocked ?? false,
          onChange: options.onChange ?? (() => Promise.resolve()),
          onError: options.onError ?? (() => undefined),
        }),
      );
    });
  }

  it('shows the default, one row per subscribed service, and the plain-language hint', () => {
    render({ defaultDelaySeconds: 0, serviceDelaySeconds: { youtube_tv: 30 } });
    const text = host.textContent ?? '';
    expect(text).toContain('If you usually land in a commercial, add a delay.');
    expect(text).toContain('Send alertsOn time');
    expect(text).toContain('YouTube TV+30s');
    expect(text).toContain('PeacockSame as default');
  });

  it('has no service rows when the user has no services', () => {
    render({ defaultDelaySeconds: 10, serviceDelaySeconds: {} }, { services: [] });
    expect(host.textContent).toContain('Send alerts+10s');
    expect(host.textContent).not.toContain('By streaming service');
  });

  it('steps the default by 5s and sends only the default', async () => {
    const onChange = vi.fn<(patch: AlertTimingPatch) => Promise<void>>(() => Promise.resolve());
    render({ defaultDelaySeconds: 10, serviceDelaySeconds: {} }, { onChange });
    await act(async () => {
      button(host, 'Send alerts: more delay').click();
    });
    expect(onChange).toHaveBeenLastCalledWith({ defaultDelaySeconds: 15 });
    await act(async () => {
      button(host, 'Send alerts: less delay').click();
    });
    expect(onChange).toHaveBeenLastCalledWith({ defaultDelaySeconds: 5 });
  });

  it('cannot go below On time or above +90s', () => {
    render({ defaultDelaySeconds: 0, serviceDelaySeconds: { youtube_tv: 90 } });
    expect(isDisabled(button(host, 'Send alerts: less delay'))).toBe(true);
    expect(isDisabled(button(host, 'Send alerts: more delay'))).toBe(false);
    expect(isDisabled(button(host, 'YouTube TV: more delay'))).toBe(true);
    expect(isDisabled(button(host, 'Peacock: less delay'))).toBe(true);
  });

  it('sets a service override from Same as default, and clears it back with null', async () => {
    const onChange = vi.fn<(patch: AlertTimingPatch) => Promise<void>>(() => Promise.resolve());
    render({ defaultDelaySeconds: 20, serviceDelaySeconds: { youtube_tv: 0 } }, { onChange });
    await act(async () => {
      button(host, 'Peacock: more delay').click();
    });
    expect(onChange).toHaveBeenLastCalledWith({ serviceDelaySeconds: { peacock: 0 } });
    await act(async () => {
      button(host, 'YouTube TV: less delay').click();
    });
    expect(onChange).toHaveBeenLastCalledWith({ serviceDelaySeconds: { youtube_tv: null } });
  });

  it('locks every stepper for the demo account', () => {
    render(
      { defaultDelaySeconds: 10, serviceDelaySeconds: { youtube_tv: 30 } },
      { editsLocked: true },
    );
    const steppers = host.querySelectorAll<HTMLElement>('[aria-label$="delay"]');
    expect(steppers.length).toBe(6);
    for (const stepper of steppers) expect(isDisabled(stepper)).toBe(true);
  });

  it('reports a failed save', async () => {
    const failure = new Error('nope');
    const onError = vi.fn();
    render(
      { defaultDelaySeconds: 0, serviceDelaySeconds: {} },
      { onChange: () => Promise.reject(failure), onError },
    );
    await act(async () => {
      button(host, 'Send alerts: more delay').click();
    });
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
