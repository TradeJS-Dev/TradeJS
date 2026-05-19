import { API } from '@tradejs/core/api';
import type { RuntimeStrategiesResponse } from '#app/lib/runtimeStrategies';

const API_PATH = '/api/strategies/runtime';

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
