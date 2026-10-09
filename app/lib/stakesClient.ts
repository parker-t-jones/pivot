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

export function stakeRequestError(error: unknown): string {
  if (error instanceof ApiRequestError) return stakeErrorCopy(error.code);
  return 'Could not save that bet.';
}
