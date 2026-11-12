// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Animated } from 'react-native';
import { expect, it, vi } from 'vitest';

import { Skeleton, SkeletonGroup } from './Skeleton';

const native = vi.hoisted(() => ({ subscribe: vi.fn(), preference: vi.fn() }));

vi.mock('react-native', async () => {
  const web = await import('react-native-web');
  return {
    ...web,
    Platform: { ...web.Platform, OS: 'ios' },
    AccessibilityInfo: {
      addEventListener: native.subscribe,
      isReduceMotionEnabled: native.preference,
    },
  };
});

it('waits for native reduce motion, reacts to events, and stops the pulse on cleanup', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let change: (reduced: boolean) => void = () => undefined;
  let resolvePreference: (reduced: boolean) => void = () => undefined;
  const remove = vi.fn();
  const subscription = native.subscribe.mockImplementation((_event, listener) => {
    change = listener;
    return { remove };
  });
  const preference = native.preference.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePreference = resolve;
      }),
  );
  const start = vi.fn();
  const stop = vi.fn();
  const loop = vi.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: vi.fn() });
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <SkeletonGroup>
          <Skeleton style={{ height: 40 }} />
        </SkeletonGroup>,
      ),
    );
    expect(start).not.toHaveBeenCalled();
    await act(async () => resolvePreference(false));
    expect(start).toHaveBeenCalledOnce();
    act(() => change(true));
    expect(stop).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="skeleton-still"]')?.getAttribute('style')).toContain(
      'opacity: 1',
    );
    act(() => change(false));
    act(() => root.unmount());
    expect(stop).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledOnce();
  } finally {
    subscription.mockReset();
    preference.mockReset();
    loop.mockRestore();
  }
});
