// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardRowData } from '../lib/board';
import { BoardRow } from './BoardRow';

vi.mock('react-native', () => import('react-native-web'));

vi.mock('../lib/fonts', () => ({
  fonts: {
    teamNickname: 'sans-serif',
    sansBold: 'sans-serif',
    sansSemiBold: 'sans-serif',
    monoBold: 'monospace',
    monoSemiBold: 'monospace',
    monoMedium: 'monospace',
  },
}));

function row(stakeCount: number): BoardRowData {
  return {
    gameId: 'g1',
    kickoff: new Date('2026-10-20T00:15:00Z'),
    status: 'scheduled',
    awayTeamId: 'WAS',
    homeTeamId: 'SF',
    awayTeamColor: '#5A1414',
    homeTeamColor: '#AA0000',
    network: 'ESPN',
    stakeCount,
    stripeSide: stakeCount > 0 ? 'home' : null,
  };
}

describe('BoardRow pick count', () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });

  function labelFor(stakeCount: number): string {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(BoardRow, { row: row(stakeCount), showDivider: false }));
    });
    return host.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
  }

  it('counts picks in the row label', () => {
    expect(labelFor(0)).toContain('no picks');
    expect(labelFor(1)).toContain('1 pick');
    expect(labelFor(2)).toContain('2 picks');
    expect(document.body.textContent ?? '').not.toMatch(/stake/i);
  });
});
