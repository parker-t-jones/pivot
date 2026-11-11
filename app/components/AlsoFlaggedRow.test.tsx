// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MNF_BROADCAST } from '../fixtures/mnfHalftime';
import type { CurrentFlag, WatchCta } from '../lib/gameDisplay';
import { AlsoFlaggedRow } from './AlsoFlaggedRow';

vi.mock('react-native', () => import('react-native-web'));

// The real row reads font names from `lib/fonts`, which loads expo-font (needs `__DEV__`).
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

function flagFor(
  gameId: string,
  away: string,
  home: string,
  extra: Partial<CurrentFlag> = {},
): CurrentFlag {
  return {
    game_id: gameId,
    priority_score: 5,
    reasons: [],
    flagged_players: [],
    recommended_action: 'notify_only',
    game: {
      home_team: home,
      away_team: away,
      home_team_name: `${home} nickname`,
      away_team_name: `${away} nickname`,
      home_team_primary_color: '#112233',
      home_team_secondary_color: '#445566',
      away_team_primary_color: '#AA0000',
      away_team_secondary_color: '#00AA00',
      score: { home: 7, away: 10 },
      quarter: 3,
      time_remaining_sec: 420,
      possession_team: away,
      yards_to_endzone: 30,
      down: 3,
      distance: 4,
      in_red_zone: false,
    },
    ...extra,
  };
}

const WATCH: WatchCta = { kind: 'watch', broadcast: MNF_BROADCAST };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function render(node: React.ReactElement) {
  act(() => {
    root.render(node);
  });
}

function buttons(): Element[] {
  return Array.from(container.querySelectorAll('[role="button"]'));
}

describe('AlsoFlaggedRow', () => {
  it('renders nothing when there are no other flagged games', () => {
    render(<AlsoFlaggedRow flags={[]} onSwitch={vi.fn()} ctaFor={() => null} />);
    expect(container.textContent).toBe('');
  });

  it('draws one situation tile per flag under an Also flagged label', () => {
    render(
      <AlsoFlaggedRow
        flags={[flagFor('g-kc', 'KC', 'DEN'), flagFor('g-buf', 'BUF', 'MIA')]}
        onSwitch={vi.fn()}
        ctaFor={() => null}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Also flagged');
    for (const abbreviation of ['KC', 'DEN', 'BUF', 'MIA']) {
      expect(text).toContain(abbreviation);
    }
    expect(container.querySelector('#pivot-game-g-kc')).not.toBeNull();
    expect(container.querySelector('#pivot-game-g-buf')).not.toBeNull();
  });

  it('shows the clock, field position and down and distance on each tile', () => {
    render(
      <AlsoFlaggedRow
        flags={[flagFor('g-kc', 'KC', 'DEN')]}
        onSwitch={vi.fn()}
        ctaFor={() => null}
      />,
    );
    const tile = container.querySelector('#pivot-game-g-kc');
    expect(tile?.textContent).toContain('Q3 · 7:00');
    expect(tile?.textContent).toContain('DEN 30');
    expect(tile?.textContent).toContain('3rd & 4');
  });

  it('shows the opponent label and the bet chip when the flag has them', () => {
    render(
      <AlsoFlaggedRow
        flags={[
          flagFor('g-kc', 'KC', 'DEN', { opponent_label: 'OPPONENT · Pat Smith' }),
          flagFor('g-buf', 'BUF', 'MIA', {
            bets: [
              { stake_id: 's1', label: 'BUF ML' },
              { stake_id: 's2', label: 'Over 44.5' },
            ],
          }),
        ]}
        onSwitch={vi.fn()}
        ctaFor={() => null}
      />,
    );
    expect(container.querySelector('#pivot-game-g-kc')?.textContent).toContain(
      'OPPONENT · Pat Smith',
    );
    expect(container.querySelector('#pivot-game-g-buf')?.textContent).toContain('BET · BUF ML +1');
  });

  it('draws a Switch button with the service label when the slate has a watch link', () => {
    render(
      <AlsoFlaggedRow
        flags={[flagFor('g-kc', 'KC', 'DEN')]}
        onSwitch={vi.fn()}
        ctaFor={() => WATCH}
      />,
    );
    const found = buttons();
    expect(found).toHaveLength(1);
    expect(found[0]?.textContent).toContain('Watch on YouTube TV');
    expect(found[0]?.getAttribute('aria-label')).toBe('Switch to KC at DEN');
  });

  it('shows the airing as plain text, with no button, when there is no link to open', () => {
    render(
      <AlsoFlaggedRow
        flags={[flagFor('g-kc', 'KC', 'DEN')]}
        onSwitch={vi.fn()}
        ctaFor={() => ({ kind: 'airing', text: 'Not on your services' })}
      />,
    );
    expect(buttons()).toHaveLength(0);
    expect(container.textContent).toContain('Not on your services');
  });

  it('hides the button when the week slate does not have the game', () => {
    render(
      <AlsoFlaggedRow
        flags={[flagFor('g-kc', 'KC', 'DEN')]}
        onSwitch={vi.fn()}
        ctaFor={() => null}
      />,
    );
    expect(buttons()).toHaveLength(0);
    expect(container.textContent).not.toContain('Not on your services');
  });

  it('switches with the tapped tile flag and locks that button until the switch settles', async () => {
    let finish: () => void = () => undefined;
    const onSwitch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = flagFor('g-kc', 'KC', 'DEN');
    const second = flagFor('g-buf', 'BUF', 'MIA');
    render(<AlsoFlaggedRow flags={[first, second]} onSwitch={onSwitch} ctaFor={() => WATCH} />);

    const target = container.querySelector('[aria-label="Switch to BUF at MIA"]');
    expect(target).not.toBeNull();
    act(() => {
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(second);

    // Pending: the label is replaced by a spinner and a second tap does nothing.
    const pending = container.querySelector('[aria-label="Switch to BUF at MIA"]');
    expect(pending?.textContent ?? '').not.toContain('Watch on');
    act(() => {
      pending?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSwitch).toHaveBeenCalledTimes(1);
    // The other tile is untouched.
    expect(
      container.querySelector('[aria-label="Switch to KC at DEN"]')?.textContent ?? '',
    ).toContain('Watch on YouTube TV');

    await act(async () => {
      finish();
    });
    expect(
      container.querySelector('[aria-label="Switch to BUF at MIA"]')?.textContent ?? '',
    ).toContain('Watch on YouTube TV');
  });
});
