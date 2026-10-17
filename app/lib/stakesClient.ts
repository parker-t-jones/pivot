import { apiClient, ApiRequestError } from './apiClient';
import { stakeErrorCopy, type ManualStake, type StakeRequest, type StakesResponse } from './stakes';

export async function fetchStakes(week: number): Promise<StakesResponse> {
  return await apiClient.get<StakesResponse>(`/stakes?week=${week}`);
}

export async function createStake(body: StakeRequest): Promise<{ stake: ManualStake }> {
  return await apiClient.post<{ stake: ManualStake }>('/stakes', body);
}

export async function deleteStake(id: string): Promise<void> {
  await apiClient.delete(`/stakes/${id}`);
}

/**
 * Tab-close delete. `beforeunload` drops an in-flight `fetch` unless `keepalive` is set,
 * and the session lookup has to happen before that event.
 */
export function deleteStakeKeepalive(id: string, accessToken: string): void {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!base || accessToken.length === 0) return;
  void fetch(`${base}/stakes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    keepalive: true,
  });
}

export function stakeRequestError(error: unknown): string {
  if (error instanceof ApiRequestError) return stakeErrorCopy(error.code);
  return 'Could not save that bet.';
}
