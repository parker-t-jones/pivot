import type { FlagEventPayload } from './flagEventPayload';
import { isFlagEventPayload } from './flagEventPayload';

const SOUND_KEY = 'pivot.alert-sound';
const SEEN_LIMIT = 100;

export interface InTabAlert {
  title: string;
  body: string;
  payload: FlagEventPayload;
}

export interface PivotPushMessage {
  type: 'pivot-push';
  title: string;
  body: string;
  payload: FlagEventPayload;
}

const seen = new Set<string>();
const listeners = new Set<(alert: InTabAlert) => void>();

/** Routing nudges only, and only while this tab is the one the person is looking at. */
export function shouldShowInTabAlert(input: {
  eventId: string;
  eventType: string;
  visible: boolean;
  alreadySeen: boolean;
}): boolean {
  if (!input.visible) return false;
  if (input.eventId.length === 0) return false;
  if (input.eventType !== 'flag_added' && input.eventType !== 'bet_in_play') return false;
  if (input.alreadySeen) return false;
  return true;
}

export function subscribeInTabAlerts(listener: (alert: InTabAlert) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Socket delivery and a service-worker `postMessage` both call this. The first one for an
 * event id shows the banner. The second is dropped.
 */
export function offerInTabAlert(alert: InTabAlert, visible: boolean): boolean {
  const eventId = alert.payload.event_id;
  if (
    !shouldShowInTabAlert({
      eventId,
      eventType: alert.payload.event_type,
      visible,
      alreadySeen: seen.has(eventId),
    })
  ) {
    return false;
  }
  seen.add(eventId);
  if (seen.size > SEEN_LIMIT) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  for (const listener of listeners) listener(alert);
  return true;
}

export function isPivotPushMessage(data: unknown): data is PivotPushMessage {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record['type'] === 'pivot-push' &&
    typeof record['title'] === 'string' &&
    typeof record['body'] === 'string' &&
    isFlagEventPayload(record['payload'])
  );
}

export function readAlertSoundEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeAlertSoundEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  } catch {
    // Private mode can reject the write. The next banner stays on the default.
  }
}

/** Short beep. A browser may reject audio outside a gesture; the banner still shows. */
export function playAlertSound(): void {
  if (!readAlertSoundEnabled()) return;
  const Ctx = globalThis.AudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
    oscillator.onended = () => {
      void ctx.close();
    };
  } catch {
    // Autoplay rejection leaves the banner in place.
  }
}

export function resetInTabAlertsForTests(): void {
  seen.clear();
  listeners.clear();
}
