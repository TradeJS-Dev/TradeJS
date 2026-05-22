import { API } from '@tradejs/core/api';
import type { StrategyChartsSnapshotResponse } from '@tradejs/types';
import type { RuntimeStrategiesResponse } from '#app/lib/runtimeStrategies';

const API_PATH = '/api/strategies/runtime';
const REPLAY_API_PATH = '/api/strategies/replay';
const AI_API_PATH = '/api/strategies/ai';

export const getRuntimeStrategies = async ({
  provider = 'bybit',
  hours = 168,
}: {
  provider?: string;
  hours?: number;
} = {}) =>
  API.get<RuntimeStrategiesResponse>(
    `${API_PATH}?provider=${encodeURIComponent(provider)}&hours=${encodeURIComponent(String(hours))}`,
  );

export const getReplayStrategies = async () =>
  API.get<StrategyChartsSnapshotResponse>(REPLAY_API_PATH);

export const getAiStrategies = async () =>
  API.get<StrategyChartsSnapshotResponse>(AI_API_PATH);

export const deleteStrategyCard = async (
  mode: 'replay' | 'ai',
  cardId: string | undefined,
): Promise<boolean> => {
  if (!cardId) {
    return false;
  }

  const data = await API.delete<{ deleted?: boolean }>(
    `/api/strategies/${encodeURIComponent(mode)}/${encodeURIComponent(cardId)}`,
  );

  return data.deleted === true;
};
