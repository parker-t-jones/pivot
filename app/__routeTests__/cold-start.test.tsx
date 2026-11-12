// @vitest-environment happy-dom
import { act, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import RootLayout from '../app/_layout';
import IndexScreen from '../app/index';
import AppGroupLayout from '../app/(app)/_layout';

const state = vi.hoisted(() => ({
  fonts: false,
  loading: true,
  session: null as object | null,
  segments: ['(auth)'],
  leagues: 'checking',
  count: 1,
  push: 'checking',
  replace: vi.fn(),
}));
const Wrapper = ({ children }: PropsWithChildren) => <>{children}</>;
vi.mock('react-native', () => import('react-native-web'));
vi.mock('expo-font', () => ({ useFonts: () => [state.fonts] }));
vi.mock('expo-router', () => {
  const Stack = Object.assign(() => <div>Screen ready</div>, { Screen: () => null });
  return {
    Stack,
    Redirect: ({ href }: { href: string }) => <div>{href}</div>,
    useSegments: () => state.segments,
    useRouter: () => ({ replace: state.replace }),
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: (p: PropsWithChildren) => Wrapper(p),
}));
vi.mock('../components/WebPhoneColumn', () => ({
  WebPhoneColumn: (p: PropsWithChildren) => Wrapper(p),
}));
vi.mock('../contexts/SessionContext', () => ({
  SessionProvider: (p: PropsWithChildren) => Wrapper(p),
  useSession: () => ({ isLoading: state.loading, session: state.session }),
}));
vi.mock('../contexts/LeaguesGateContext', () => ({
  LeaguesGateProvider: (p: PropsWithChildren) => Wrapper(p),
  useLeaguesGate: () => ({ status: state.leagues, leagueCount: state.count }),
}));
vi.mock('../contexts/PushPermissionContext', () => ({
  PushPermissionProvider: (p: PropsWithChildren) => Wrapper(p),
  usePushPermission: () => ({ status: state.push }),
}));
vi.mock('../contexts/GameLinksContext', () => ({
  GameLinksProvider: (p: PropsWithChildren) => Wrapper(p),
}));
vi.mock('../contexts/SwitchingContext', () => ({
  SwitchingProvider: (p: PropsWithChildren) => Wrapper(p),
}));
vi.mock('../contexts/UpgradeSheetContext', () => ({
  UpgradeSheetProvider: (p: PropsWithChildren) => Wrapper(p),
}));
vi.mock('../components/StakeUndoToast', () => ({ StakeUndoToast: () => null }));
vi.mock('../components/NotificationBannerHost', () => ({ NotificationBannerHost: () => null }));
vi.mock('../components/NotificationResponseHandler', () => ({
  NotificationResponseHandler: () => null,
}));
vi.mock('../components/UpgradeSheet', () => ({ UpgradeSheet: () => null }));
vi.mock('../lib/deviceId', () => ({ getOrCreateDeviceId: vi.fn() }));
vi.mock('../lib/webPush', () => ({ registerServiceWorker: vi.fn() }));
vi.mock('../lib/fonts', () => ({ displayFontMap: {} }));
vi.mock('../lib/connectDeferredSession', () => ({ isConnectDeferredForSession: () => false }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('__DEV__', false);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  Object.assign(state, {
    fonts: false,
    loading: true,
    session: null,
    segments: ['(auth)'],
    leagues: 'checking',
    count: 1,
    push: 'checking',
  });
  state.replace.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function stage(expected: number, copy: string) {
  const field = host.querySelector('[data-testid="yard-line-loader"]');
  expect(field?.getAttribute('aria-label')).toBe('Loading');
  expect(field?.getAttribute('aria-valuenow')).toBe(String(expected));
  expect(field?.getAttribute('aria-valuemax')).toBe('5');
  expect(host.textContent).toContain(copy);
  const ball = host.querySelector<HTMLElement>('[data-testid="yard-line-ball"]');
  expect(ball).toBeTruthy();
  if (!ball) throw new Error('Expected a staged ball.');
  return Number.parseFloat(ball.style.left);
}
it('follows fonts, session, and the auth redirect only when the real gates change', () => {
  act(() => root.render(<RootLayout />));
  const fonts = stage(1, 'Loading fonts…');
  state.fonts = true;
  act(() => root.render(<RootLayout />));
  const session = stage(2, 'Checking your session…');
  expect(session).toBeGreaterThan(fonts);
  act(() => root.render(<RootLayout />));
  expect(stage(2, 'Checking your session…')).toBe(session);
  state.loading = false;
  state.session = {};
  act(() => root.render(<RootLayout />));
  expect(stage(3, 'Opening your screen…')).toBeGreaterThan(session);
  expect(state.replace).toHaveBeenCalledWith('/(app)');
  state.segments = ['(app)'];
  act(() => root.render(<RootLayout />));
  expect(host.textContent).toBe('Screen ready');
});
it('waits for both concurrent checks, then shows only a real onboarding redirect', () => {
  act(() => root.render(<AppGroupLayout />));
  const checking = stage(4, 'Checking your leagues and alerts…');
  state.leagues = 'ready';
  act(() => root.render(<AppGroupLayout />));
  expect(stage(4, 'Checking your leagues and alerts…')).toBe(checking);
  state.push = 'denied';
  state.count = 0;
  act(() => root.render(<AppGroupLayout />));
  const final = stage(5, 'Opening your screen…');
  expect(final).toBeGreaterThan(checking);
  const field = host.querySelector<HTMLElement>('[data-testid="yard-line-loader"]');
  const ball = host.querySelector<HTMLElement>('[data-testid="yard-line-ball"]');
  const endZone = host.querySelector<HTMLElement>('[data-testid="yard-line-end-zone"]');
  if (!field || !ball || !endZone) throw new Error('Expected the final staged loader.');
  expect(final + Number.parseFloat(ball.style.width)).toBeCloseTo(
    Number.parseFloat(field.style.width) - Number.parseFloat(endZone.style.width),
  );
  expect(state.replace).toHaveBeenCalledWith('/(app)/connect-team?onboarding=1');
  state.count = 1;
  act(() => root.render(<AppGroupLayout />));
  expect(host.textContent).toBe('Screen ready');
});
it('keeps index on the session stage and routes signed-out users to welcome', () => {
  act(() => root.render(<IndexScreen />));
  stage(2, 'Checking your session…');
  state.loading = false;
  act(() => root.render(<IndexScreen />));
  expect(host.textContent).toBe('/(auth)/welcome');
});
