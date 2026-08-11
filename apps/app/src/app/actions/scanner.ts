import { API } from '@tradejs/core/api';
import { MarketUniverse } from '@tradejs/types';
import type { Items } from '#app/types/ui';

const API_PATH = '/api/scanner';

export const scan = async (
  provider = 'bybit',
  universe: MarketUniverse = 'crypto',
): Promise<Items> => {
  const data = await API.get<{ tickers?: Items }>(
    `${API_PATH}/${provider}/${universe}`,
  );

  return data.tickers ?? [];
};
