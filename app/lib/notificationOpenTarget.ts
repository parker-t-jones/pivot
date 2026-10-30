/**
 * Where a notification click goes. A saved or generated https link opens that stream.
 * No link opens this game inside Pivot (`/?game=`). Keep `app/public/sw.js` in step.
 */
export function notificationClickUrl(
  payload: {
    event_type?: string;
    game_id?: string;
    action?: { saved_url?: unknown; deep_link_url?: unknown };
  },
  origin: string,
): string | null {
  const eventType = payload.event_type;
  if (eventType !== 'flag_added' && eventType !== 'bet_in_play') return null;
  const action = payload.action ?? {};
  const saved = action.saved_url;
  if (typeof saved === 'string' && saved.startsWith('https://')) return saved;
  const generated = action.deep_link_url;
  if (typeof generated === 'string' && generated.startsWith('https://')) return generated;
  if (typeof payload.game_id === 'string' && payload.game_id.length > 0) {
    const url = new URL('/', origin);
    url.searchParams.set('game', payload.game_id);
    return url.href;
  }
  return null;
}

export function homeGameHref(gameId: string): `/(app)?game=${string}` {
  return `/(app)?game=${encodeURIComponent(gameId)}`;
}
