/* Pivot web push. Scope is the origin. A visible Pivot tab gets the event
 * instead of a system notification, because the in-tab banner already covers it.
 *
 * Prime Video: keep in step with `browserPrimeWatchUrl` in shared/src/broadcast/watchLinks.ts.
 * `app.primevideo.com` and the get-the-app splash open the storefront.
 */
const PRIME_VIDEO_WEB_STOREFRONT = 'https://www.primevideo.com/storefront';

function browserPrimeWatchUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return url;
    if (parsed.hostname === 'app.primevideo.com') return PRIME_VIDEO_WEB_STOREFRONT;
    if (parsed.hostname === 'www.primevideo.com' && parsed.pathname.indexOf('/splash/') === 0) {
      return PRIME_VIDEO_WEB_STOREFRONT;
    }
  } catch (e) {
    return url;
  }
  return url;
}
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const title =
    typeof message.title === 'string' && message.title.length > 0 ? message.title : 'Pivot';
  const body = typeof message.body === 'string' ? message.body : '';
  const collapseKey =
    typeof message.collapseKey === 'string' && message.collapseKey.length > 0
      ? message.collapseKey
      : 'pivot';
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const visible = windows.filter((client) => client.visibilityState === 'visible');
      if (visible.length > 0) {
        for (const client of visible) {
          client.postMessage({ type: 'pivot-push', title, body, collapseKey, payload });
        }
        return;
      }
      await self.registration.showNotification(title, {
        body,
        tag: collapseKey,
        data: { collapseKey, payload },
      });
    })(),
  );
});

/**
 * https URL a notification click should open. A saved stream link wins. Otherwise the
 * generated watch URL. No link opens that game inside Pivot (`/?game=`).
 * Only flag_added and bet_in_play. Keep in step with `notificationClickUrl`.
 */
function watchUrlForNotificationClick(payload) {
  const eventType = payload && payload.event_type;
  if (eventType !== 'flag_added' && eventType !== 'bet_in_play') return null;
  const action = payload.action && typeof payload.action === 'object' ? payload.action : {};
  const saved = action.saved_url;
  if (typeof saved === 'string' && saved.startsWith('https://')) return saved;
  const generated = action.deep_link_url;
  if (typeof generated === 'string' && generated.startsWith('https://')) return generated;
  const gameId = payload.game_id;
  if (typeof gameId === 'string' && gameId.length > 0) {
    const url = new URL('/', self.location.origin);
    url.searchParams.set('game', gameId);
    return url.href;
  }
  return null;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const payload = data.payload || {};
  const watchUrl = watchUrlForNotificationClick(payload);
  const openUrl = typeof watchUrl === 'string' ? browserPrimeWatchUrl(watchUrl) : watchUrl;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      const gameId = payload.game_id;
      const inApp = typeof openUrl === 'string' && openUrl.startsWith(self.location.origin);
      if (existing && inApp) {
        if (typeof gameId === 'string' && gameId.length > 0) {
          existing.postMessage({ type: 'pivot-open-game', gameId });
        }
        if (typeof existing.navigate === 'function') await existing.navigate(openUrl);
        await existing.focus();
        return;
      }
      if (openUrl) {
        await self.clients.openWindow(openUrl);
        return;
      }
      if (existing) {
        await existing.focus();
        return;
      }
      await self.clients.openWindow('/');
    })(),
  );
});
