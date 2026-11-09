// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../lib/theme';
import { spreadReadout } from '../lib/addPickLine';
import { draftLineConfig, EMPTY_DRAFT, type LineConfig, type PickDraft } from '../lib/pickDraft';
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

function config(draft: Partial<PickDraft>): LineConfig {
  const result = draftLineConfig({ ...EMPTY_DRAFT, ...draft });
  if (result === null) throw new Error('draft has no line step');
  return result;
}

function renderEntry(root: Root, props: Partial<ComponentProps<typeof AddPickLineEntry>> = {}) {
  act(() => {
    root.render(
      <AddPickLineEntry
        canContinue={false}
        config={config({ kind: 'SPREAD' })}
        error={null}
        magnitude=""
        onContinue={() => undefined}
        onMagnitude={() => undefined}
        onRole={() => undefined}
        onStep={() => undefined}
        readout={null}
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
    renderEntry(root, { config: config({ kind: 'TOTAL' }) });
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
    renderEntry(root, {
      config: config({ kind: 'SPREAD', spreadRole: 'favorite' }),
      magnitude: '3',
      readout: sentence,
    });
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

  it('shows a period control for a quarter or half market and reports the choice', () => {
    const onPeriod = vi.fn();
    renderEntry(root, {
      config: config({ kind: 'TEAM_PROP', teamMarket: 'SEGMENT_TOTAL' }),
      onPeriod,
      period: undefined,
    });
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
    expect(tabs).toEqual(['1Q', '2Q', '3Q', '4Q', '1H', '2H', 'Over', 'Under']);
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('10.5');
    const half = Array.from(host.querySelectorAll('[role="tab"]')).find(
      (tab) => tab.textContent === '1H',
    );
    act(() => {
      (half as HTMLElement).click();
    });
    expect(onPeriod).toHaveBeenCalledWith('H1');
  });

  it('offers the full game first on a team total', () => {
    renderEntry(root, {
      config: config({ kind: 'TEAM_PROP', teamMarket: 'TEAM_TOTAL' }),
      period: null,
    });
    const first = host.querySelector('[role="tab"]');
    expect(first?.textContent).toBe('Game');
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('21.5');
  });

  it('asks only yes or no for a touchdown prop, with no number to enter', () => {
    const onRole = vi.fn();
    renderEntry(root, {
      config: config({ kind: 'PLAYER_PROP', playerMarket: 'ANYTIME_TD' }),
      onRole,
    });
    const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
    expect(tabs).toEqual(['Yes', 'No']);
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('[data-testid="add-pick-step-up"]')).toBeNull();
    act(() => {
      (host.querySelector('[role="tab"]') as HTMLElement).click();
    });
    expect(onRole).toHaveBeenCalledWith('yes');
  });

  it('uses the stat baseline and range for a player prop', () => {
    renderEntry(root, {
      config: config({ kind: 'PLAYER_PROP', playerMarket: 'REC_YDS', totalRole: 'over' }),
      magnitude: '400',
    });
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('49.5');
    expect(
      host.querySelector('[data-testid="add-pick-step-up"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('lets the line field shrink so both steppers fit a 390 phone column on web', () => {
    renderEntry(root);
    const field = host.querySelector('[data-testid="add-pick-line-field"]');
    expect(getComputedStyle(field as Element).minWidth).toBe('0px');
  });
});
