// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../lib/theme';
import { AddPickSlip } from './AddPickSlip';
import { TEAM_BADGE_SIZE } from './TeamBadge';
import { SlipPerforation, dashCountForWidth } from './SlipPerforation';

vi.mock('react-native', () => import('react-native-web'));

function notNegative(value: string): boolean {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) || parsed >= 0;
}

describe('add pick slip edge', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '320px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps the card-edge perforation inside the slip with no negative margins', () => {
    act(() => {
      root.render(
        <AddPickSlip
          game={{
            away: 'WAS',
            home: 'SF',
            detail: 'Monday 8:15 PM · Prime Video nationwide',
          }}
          pick={null}
          pickLabel="PICK"
          typeLabel="Spread"
        />,
      );
    });

    const slip = host.querySelector('[data-testid="add-pick-slip"]');
    const perforation = host.querySelector('[data-testid="slip-perforation-card"]');
    if (!(slip instanceof HTMLElement) || !(perforation instanceof HTMLElement)) {
      throw new Error('slip or perforation missing');
    }

    const perforationStyle = getComputedStyle(perforation);
    expect(notNegative(perforationStyle.marginLeft)).toBe(true);
    expect(notNegative(perforationStyle.marginRight)).toBe(true);
    expect(perforationStyle.overflowX === 'hidden' || perforationStyle.overflow === 'hidden').toBe(
      true,
    );

    for (const node of Array.from(perforation.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(node);
      expect(notNegative(style.marginLeft)).toBe(true);
      expect(notNegative(style.marginRight)).toBe(true);
      expect(notNegative(style.left)).toBe(true);
      expect(notNegative(style.right)).toBe(true);
    }

    const leftNotch = host.querySelector('[data-testid="slip-notch-left"]');
    const rightNotch = host.querySelector('[data-testid="slip-notch-right"]');
    const disc = leftNotch?.firstElementChild;
    if (
      !(leftNotch instanceof HTMLElement) ||
      !(rightNotch instanceof HTMLElement) ||
      !(disc instanceof HTMLElement)
    ) {
      throw new Error('card notches missing');
    }
    const inset = Number.parseFloat(perforationStyle.paddingLeft);
    const overhang =
      Number.parseFloat(getComputedStyle(disc).width) -
      Number.parseFloat(getComputedStyle(leftNotch).width);
    expect(inset).toBeGreaterThan(0);
    expect(inset - overhang).toBeGreaterThan(0);
    expect(getComputedStyle(leftNotch).height).toBe(perforationStyle.height);
    expect(getComputedStyle(rightNotch).height).toBe(perforationStyle.height);
    expect(perforationStyle.alignItems).toBe('center');

    expect(perforationStyle.width).toBe('100%');
    expect(getComputedStyle(slip).overflow).not.toBe('hidden');
    expect(getComputedStyle(slip).overflowX).not.toBe('hidden');
    expect(slip.scrollWidth).toBeLessThanOrEqual(slip.clientWidth + 1);

    const slipBox = slip.getBoundingClientRect();
    const edgeBox = perforation.getBoundingClientRect();
    if (slipBox.width > 0) {
      expect(edgeBox.left).toBeGreaterThanOrEqual(slipBox.left - 0.5);
      expect(edgeBox.right).toBeLessThanOrEqual(slipBox.right + 0.5);
    }
  });

  it('stretches the card dash row to the container width', () => {
    host.style.width = '900px';
    act(() => {
      root.render(
        <AddPickSlip
          game={{ away: 'WAS', home: 'SF', detail: 'Mon 8:15 PM' }}
          pick={null}
          pickLabel="PICK"
          typeLabel="Spread"
        />,
      );
    });

    const container = host.querySelector('[data-testid="slip-perforation-card"]');
    const rule = host.querySelector('[data-testid="slip-perforation-dashes"]');
    if (!(container instanceof HTMLElement) || !(rule instanceof HTMLElement)) {
      throw new Error('dash row missing');
    }

    expect(getComputedStyle(rule).width).toBe('100%');
    expect(getComputedStyle(container).width).toBe('100%');

    for (const width of [390, 900, 1279, 1440]) {
      const count = dashCountForWidth(width);
      const span = count * 6 + Math.max(0, count - 1) * 4;
      expect(span).toBeGreaterThanOrEqual(width);
    }

    const handler = (rule as HTMLElement & { __reactLayoutHandler?: (event: unknown) => void })
      .__reactLayoutHandler;
    expect(typeof handler).toBe('function');
    act(() => {
      handler?.({ nativeEvent: { layout: { x: 0, y: 0, width: 900, height: 1 } } });
    });
    const marks = rule.children.length;
    const span = marks * 6 + Math.max(0, marks - 1) * 4;
    expect(span).toBeGreaterThanOrEqual(900);
  });

  it('stretches the ticket dash row to the container width', () => {
    host.style.width = '1500px';
    act(() => {
      root.render(<SlipPerforation />);
    });

    const container = host.querySelector('[data-testid="slip-perforation"]');
    const rule = host.querySelector('[data-testid="slip-perforation-dashes"]');
    if (!(container instanceof HTMLElement) || !(rule instanceof HTMLElement)) {
      throw new Error('ticket dash row missing');
    }

    expect(getComputedStyle(container).width).toBe('100%');
    expect(
      getComputedStyle(container).overflowX === 'hidden' ||
        getComputedStyle(container).overflow === 'hidden',
    ).toBe(true);
    for (const node of [container, ...Array.from(container.querySelectorAll<HTMLElement>('*'))]) {
      const style = getComputedStyle(node);
      expect(notNegative(style.marginLeft)).toBe(true);
      expect(notNegative(style.marginRight)).toBe(true);
      expect(notNegative(style.left)).toBe(true);
      expect(notNegative(style.right)).toBe(true);
    }

    const handler = (rule as HTMLElement & { __reactLayoutHandler?: (event: unknown) => void })
      .__reactLayoutHandler;
    expect(typeof handler).toBe('function');
    act(() => {
      handler?.({ nativeEvent: { layout: { x: 0, y: 0, width: 1500, height: 1 } } });
    });
    const marks = rule.children.length;
    const span = marks * 6 + Math.max(0, marks - 1) * 4;
    expect(span).toBeGreaterThanOrEqual(1500);
  });
});

describe('add pick slip rows', () => {
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

  it('shows three dashes before anything is chosen', () => {
    act(() => {
      root.render(<AddPickSlip game={null} pick={null} pickLabel="PICK" typeLabel={null} />);
    });
    expect(host.textContent?.match(/\u2014/g)).toHaveLength(3);
  });

  it('shows both team badges on the game row', () => {
    act(() => {
      root.render(
        <AddPickSlip
          game={{ away: 'WAS', home: 'SF', detail: 'Mon 8:15 PM · ESPN' }}
          pick={null}
          pickLabel="PICK"
          typeLabel="Spread"
        />,
      );
    });
    expect(host.textContent).toContain('WAS');
    expect(host.textContent).toContain('SF');
    expect(host.textContent).toContain('@');
  });

  it('shows the pick badge and an accent line', () => {
    act(() => {
      root.render(
        <AddPickSlip
          game={{ away: 'SEA', home: 'DEN', detail: '' }}
          pick={{ badge: 'SEA', text: 'SEA \u22123.5' }}
          pickLabel="PICK"
          typeLabel="Spread"
        />,
      );
    });
    const line = Array.from(host.querySelectorAll('div')).find(
      (node) => node.textContent === 'SEA \u22123.5',
    );
    expect(line).toBeTruthy();
    expect(getComputedStyle(line as Element).color.replace(/\s/g, '')).toBe(
      'rgba(245,160,24,1.00)',
    );
    expect(theme.colors.accent).toBe('#F5A018');
  });

  it('labels a survivor pick TEAM', () => {
    act(() => {
      root.render(
        <AddPickSlip
          game={{ away: 'JAX', home: 'HOU', detail: '' }}
          pick={{ badge: 'JAX', text: 'JAX' }}
          pickLabel="TEAM"
          typeLabel="Survivor"
        />,
      );
    });
    expect(host.textContent).toContain('TEAM');
    expect(host.textContent).not.toContain('PICK');
  });

  it('shows a total as Over plus the number and no pick badge', () => {
    act(() => {
      root.render(
        <AddPickSlip
          game={{ away: 'SEA', home: 'DEN', detail: '' }}
          pick={{ badge: null, text: 'Over 47.5' }}
          pickLabel="PICK"
          typeLabel="Total"
        />,
      );
    });
    expect(host.textContent).toContain('Over 47.5');
    const badges = host.textContent?.match(/SEA/g) ?? [];
    expect(badges).toHaveLength(1);
  });

  it('puts kickoff on its own line under the badges', () => {
    act(() => {
      root.render(
        <AddPickSlip
          game={{ away: 'WAS', home: 'SF', detail: 'Mon 8:15 PM · ESPN' }}
          pick={{ badge: 'WAS', text: 'WAS −3.5' }}
          pickLabel="PICK"
          typeLabel="Spread"
        />,
      );
    });
    const line = host.querySelector('[data-testid="add-pick-slip-game-line"]');
    const detail = host.querySelector('[data-testid="add-pick-slip-game-detail"]');
    if (!(line instanceof HTMLElement) || !(detail instanceof HTMLElement)) {
      throw new Error('game lines missing');
    }
    expect(line.textContent).toContain('WAS');
    expect(line.textContent).toContain('@');
    expect(line.textContent).toContain('SF');
    expect(line.textContent).not.toContain('ESPN');
    expect(line.contains(detail)).toBe(false);
    expect(detail.textContent).toBe('Mon 8:15 PM · ESPN');
    expect(getComputedStyle(line.parentElement as Element).flexDirection).toBe('column');
    expect(
      getComputedStyle(host.querySelector('[data-testid="add-pick-slip-pick"]') as Element)
        .alignItems,
    ).toBe('center');
  });

  it('keeps rows at least as tall as a small badge, in flow, at large text sizes', () => {
    host.style.width = '320px';
    act(() => {
      root.render(
        <AddPickSlip
          game={{ away: 'WAS', home: 'SF', detail: 'Monday 8:15 PM · Prime Video nationwide' }}
          pick={{ badge: 'WAS', text: 'WAS −3.5' }}
          pickLabel="PICK"
          typeLabel="Spread"
        />,
      );
    });

    const rows = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="add-pick-slip-row"]'),
    );
    expect(rows).toHaveLength(3);
    const rowGap = Number.parseFloat(
      getComputedStyle(host.querySelector('[data-testid="add-pick-slip-rows"]') as Element)
        .rowGap ||
        getComputedStyle(host.querySelector('[data-testid="add-pick-slip-rows"]') as Element).gap,
    );
    expect(rowGap).toBeGreaterThanOrEqual(theme.spacing.sm);

    const badges = Array.from(host.querySelectorAll('[role="img"]'));
    expect(badges.length).toBeGreaterThanOrEqual(3);
    for (const badge of badges) {
      expect(getComputedStyle(badge).height).toBe(`${TEAM_BADGE_SIZE.sm}px`);
      expect(getComputedStyle(badge).width).toBe(`${TEAM_BADGE_SIZE.sm}px`);
    }

    const framesAt = (scale: number) => {
      const frames: { top: number; bottom: number; height: number }[] = [];
      let cursor = 0;
      rows.forEach((row, index) => {
        assertInFlow(row);
        const height = rowHeight(row, scale);
        expect(height).toBeGreaterThanOrEqual(TEAM_BADGE_SIZE.sm);
        if (index > 0) cursor += rowGap;
        const top = cursor;
        cursor += height;
        frames.push({ top, bottom: cursor, height });
      });
      return frames;
    };

    // 1.35 is xxxLarge, the largest non-accessibility size. 1.79 is an accessibility size.
    for (const scale of [1, 1.35, 1.79]) {
      const frames = framesAt(scale);
      for (let index = 0; index < frames.length - 1; index += 1) {
        const current = frames[index];
        const next = frames[index + 1];
        if (current == null || next == null) continue;
        expect(current.bottom).toBeLessThanOrEqual(next.top);
      }
    }
  });
});

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineBox(node: Element, scale: number): number {
  if (!(node instanceof HTMLElement)) return 0;
  const raw = getComputedStyle(node).lineHeight;
  return raw.endsWith('px') ? px(raw) * scale : 0;
}

function tallestLine(root: Element, scale: number): number {
  let max = lineBox(root, scale);
  for (const node of Array.from(root.querySelectorAll('*'))) {
    max = Math.max(max, lineBox(node, scale));
  }
  return max;
}

function assertInFlow(row: HTMLElement): void {
  const style = getComputedStyle(row);
  expect(style.position).not.toBe('absolute');
  expect(px(style.marginTop)).toBeGreaterThanOrEqual(0);
  expect(px(style.marginBottom)).toBeGreaterThanOrEqual(0);
  expect(px(style.minHeight)).toBeGreaterThanOrEqual(TEAM_BADGE_SIZE.sm);
  for (const node of Array.from(row.querySelectorAll<HTMLElement>('*'))) {
    const child = getComputedStyle(node);
    expect(child.position).not.toBe('absolute');
    expect(px(child.marginTop)).toBeGreaterThanOrEqual(0);
    expect(px(child.marginLeft)).toBeGreaterThanOrEqual(0);
  }
}

function rowHeight(row: HTMLElement, scale: number): number {
  const minHeight = px(getComputedStyle(row).minHeight);
  const detail = row.querySelector('[data-testid="add-pick-slip-game-detail"]');
  const gameLine = row.querySelector('[data-testid="add-pick-slip-game-line"]');
  if (detail instanceof HTMLElement && gameLine instanceof HTMLElement) {
    const firstLine = Math.max(TEAM_BADGE_SIZE.sm, tallestLine(gameLine, scale));
    return firstLine + theme.spacing.xs + lineBox(detail, scale);
  }
  return Math.max(minHeight, tallestLine(row, scale));
}
