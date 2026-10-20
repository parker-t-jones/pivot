// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddPickGameList, type AddPickGameRowModel } from './AddPickGameList';

vi.mock('react-native', () => import('react-native-web'));

function row(overrides: Partial<AddPickGameRowModel> = {}): AddPickGameRowModel {
  return {
    gameId: 'sea',
    away: 'SEA',
    home: 'DEN',
    awayTeamId: 'away-id',
    homeTeamId: 'home-id',
    detail: 'Thu 8:15 PM · PRIME',
    availability: 'open',
    context: null,
    ...overrides,
  };
}

describe('add a pick game list', () => {
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

  function renderList(
    mode: 'side' | 'game',
    rows: AddPickGameRowModel[],
    onPickSide: (gameId: string, teamId: string) => void,
    onPickGame: (gameId: string) => void,
  ): void {
    act(() => {
      root.render(
        <AddPickGameList
          groups={[{ label: 'THURSDAY NIGHT', rows }]}
          mode={mode}
          onPickGame={onPickGame}
          onPickSide={onPickSide}
        />,
      );
    });
  }

  it('picks the game and the side from one team half', () => {
    const onPickSide = vi.fn();
    const onPickGame = vi.fn();
    renderList('side', [row()], onPickSide, onPickGame);
    const away = host.querySelector('[data-testid="add-pick-side-sea-SEA"]');
    if (!(away instanceof HTMLElement)) throw new Error('missing away half');
    act(() => {
      away.click();
    });
    expect(onPickSide).toHaveBeenCalledWith('sea', 'away-id');
    expect(onPickGame).not.toHaveBeenCalled();
  });

  it('picks a total from anywhere on the row and does not pick a side', () => {
    const onPickSide = vi.fn();
    const onPickGame = vi.fn();
    renderList('game', [row()], onPickSide, onPickGame);
    const card = host.querySelector('[data-testid="add-pick-game-sea"]');
    if (!(card instanceof HTMLElement)) throw new Error('missing game row');
    act(() => {
      card.click();
    });
    expect(onPickGame).toHaveBeenCalledWith('sea');
    expect(onPickSide).not.toHaveBeenCalled();
  });

  it('leaves started and final games in place and not tappable', () => {
    const onPickSide = vi.fn();
    renderList(
      'side',
      [
        row({ availability: 'started' }),
        row({ gameId: 'done', availability: 'final', away: 'WAS', home: 'SF' }),
      ],
      onPickSide,
      vi.fn(),
    );
    expect(host.textContent).toContain('Started');
    expect(host.textContent).toContain('Final');
    const started = host.querySelector('[data-testid="add-pick-side-sea-SEA"]');
    if (!(started instanceof HTMLElement)) throw new Error('missing started half');
    act(() => {
      started.click();
    });
    expect(onPickSide).not.toHaveBeenCalled();
  });

  it('shows starter and existing-stake context under the row', () => {
    renderList(
      'side',
      [row({ context: '2 of your players · Already tracking ML' })],
      vi.fn(),
      vi.fn(),
    );
    expect(host.textContent).toContain('2 of your players · Already tracking ML');
  });
});
