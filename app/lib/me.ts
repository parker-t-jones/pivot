import { apiClient } from './apiClient';
import type { StreamingService } from './streamingServices';

export interface QuietHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface Preferences {
  notificationMode: 'all' | 'high_leverage_only' | 'off';
  quietHours: QuietHours;
  autoSwitch: boolean;
}

export interface AppPresenceEntry {
  service: StreamingService;
  has_subscription: boolean;
}

/** `GET /me` response (Section 9, added Sprint 9 Phase 2 — see report). */
export interface MeResponse {
  user_id: string;
  email: string;
  subscription_tier: 'free' | 'pro';
  preferences: Preferences;
  app_presence: AppPresenceEntry[];
}

export async function fetchMe(): Promise<MeResponse> {
  return await apiClient.get<MeResponse>('/me');
}

export async function patchPreferences(patch: {
  notificationMode?: Preferences['notificationMode'];
  quietHours?: Partial<QuietHours>;
  autoSwitch?: boolean;
}): Promise<MeResponse> {
  return await apiClient.patch<MeResponse>('/me/preferences', patch);
}

export async function setAppPresence(
  services: { service: StreamingService; has_subscription: boolean }[],
): Promise<{ app_presence: AppPresenceEntry[] }> {
  return await apiClient.post('/me/app-presence', { services });
}

export async function deleteAccount(): Promise<void> {
  await apiClient.delete('/me');
}
