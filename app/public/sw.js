/* Pivot web push. Scope is the origin. A visible Pivot tab gets the event
 * instead of a system notification, because the in-tab banner already covers it.
 */
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const title = typeof message.title === 'string' && message.title.length > 0 ? message.title : 'Pivot';
  const body = typeof message.body === 'string' ? message.body : '';
  const collapseKey = typeof message.collapseKey === 'string' && message.collapseKey.length > 0
    ? message.collapseKey
    : 'pivot';
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

  event.waitUntil((async () => {
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
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const payload = data.payload || {};
  const eventType = payload.event_type;
  const watchUrl = payload.action && payload.action.deep_link_url;
  const openWatch = (eventType === 'flag_added' || eventType === 'bet_in_play')
    && typeof watchUrl === 'string'
    && watchUrl.startsWith('https://');

  event.waitUntil((async () => {
    if (openWatch) {
      await self.clients.openWindow(watchUrl);
      return;
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (existing) {
      await existing.focus();
      return;
    }
    await self.clients.openWindow('/');
  })());
});
