// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OnboardingTourScreen from '../app/(app)/onboarding-tour';
import { TOUR_CARDS } from '../lib/tourCards';

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

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
const searchParams = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('expo-router', () => ({
  useRouter: () => router,
  useLocalSearchParams: () => searchParams.value,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  searchParams.value = {};
  router.push.mockClear();
  router.replace.mockClear();
  router.back.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

async function render(params: Record<string, string> = {}) {
  searchParams.value = params;
  await act(async () => {
    root.render(<OnboardingTourScreen />);
  });
}

function clickByText(text: string) {
  const el = Array.from(container.querySelectorAll('div')).find((row) => row.textContent === text);
  expect(el).toBeDefined();
  return act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('OnboardingTourScreen', () => {
  it('renders all 4 cards in order via Next, then offers the two end actions', async () => {
    await render({ onboarding: '1' });

    for (let i = 0; i < TOUR_CARDS.length; i++) {
      const card = TOUR_CARDS[i];
      if (!card) throw new Error(`missing tour card at index ${i}`);
      expect(container.textContent).toContain(card.title);
      if (i < TOUR_CARDS.length - 1) {
        expect(container.textContent).not.toContain('Try a demo game day');
        await clickByText('Next');
      }
    }

    expect(container.textContent).toContain('Try a demo game day');
    expect(container.textContent).toContain('Go to Home');
  });

  it('Skip during onboarding goes to onboarding-all-set', async () => {
    await render({ onboarding: '1' });
    await clickByText('Skip');
    expect(router.replace).toHaveBeenCalledWith('/(app)/onboarding-all-set');
  });

  it('Skip outside onboarding (Settings replay) goes back instead', async () => {
    await render({});
    await clickByText('Skip');
    expect(router.back).toHaveBeenCalled();
  });

  it('"Try a demo game day" on the last card opens the demo', async () => {
    await render({ onboarding: '1' });
    for (let i = 0; i < TOUR_CARDS.length - 1; i++) {
      await clickByText('Next');
    }
    await clickByText('Try a demo game day');
    expect(router.replace).toHaveBeenCalledWith('/(app)/demo-game-day');
  });

  it('"Go to Home" during onboarding leaves to all-set, not Home directly', async () => {
    await render({ onboarding: '1' });
    for (let i = 0; i < TOUR_CARDS.length - 1; i++) {
      await clickByText('Next');
    }
    await clickByText('Go to Home');
    expect(router.replace).toHaveBeenCalledWith('/(app)/onboarding-all-set');
  });
});
