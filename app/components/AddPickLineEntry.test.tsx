// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../lib/theme';
import { spreadReadout } from '../lib/addPickLine';
import { AddPickLineEntry } from './AddPickLineEntry';

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

function renderEntry(root: Root, props: Partial<ComponentProps<typeof AddPickLineEntry>> = {}) {
  act(() => {
    root.render(
      <AddPickLineEntry
        canContinue={false}
        error={null}
        kind="SPREAD"
        magnitude=""
        onContinue={() => undefined}
        onMagnitude={() => undefined}
        onRole={() => undefined}
        onStep={() => undefined}
        readout={null}
        role={null}
        {...props}
      />,
    );
  });
}

describe('add a pick line entry', () => {
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

  it('keeps the baseline as a placeholder until the field is focused', () => {
    renderEntry(root);
    const field = host.querySelector('input');
    expect(field?.getAttribute('placeholder')).toBe('3.5');
    expect(field?.value).toBe('');

    act(() => {
      field?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('');

    act(() => {
      host.querySelector('input')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('3.5');
  });

  it('uses 44.5 as the total placeholder', () => {
    renderEntry(root, { kind: 'TOTAL' });
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('44.5');
  });

  it('disables the decrease stepper at the spread floor', () => {
    const onStep = vi.fn();
    renderEntry(root, { magnitude: '0.5', onStep });
    const down = host.querySelector('[data-testid="add-pick-step-down"]');
    expect(down?.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      (down as HTMLElement).click();
    });
    expect(onStep).not.toHaveBeenCalled();

    renderEntry(root, { magnitude: '', onStep });
    const open = host.querySelector('[data-testid="add-pick-step-down"]');
    expect(open?.getAttribute('aria-disabled')).not.toBe('true');
    act(() => {
      (open as HTMLElement).click();
    });
    expect(onStep).toHaveBeenCalledWith(-1);
  });

  it('shows the readout as a full sentence in secondary text', () => {
    const sentence = spreadReadout('Seahawks', 'favorite', 3);
    renderEntry(root, { magnitude: '3', readout: sentence, role: 'favorite' });
    const readout = host.querySelector('[data-testid="add-pick-line-readout"]');
    const stack = host.querySelector('[data-testid="add-pick-line"]');
    expect(sentence).toBe(
      'Seahawks must win by 4 or more. Winning by exactly 3 is a tie, and the pick is refunded.',
    );
    expect(readout?.textContent).toBe(sentence);
    expect(theme.colors.textSecondary).toBe('#9A9AA3');
    expect(getComputedStyle(readout as Element).color.replace(/\s/g, '')).toBe(
      'rgba(154,154,163,1.00)',
    );
    expect(getComputedStyle(stack as Element).gap).toBe(`${theme.spacing.lg}px`);
  });
});
