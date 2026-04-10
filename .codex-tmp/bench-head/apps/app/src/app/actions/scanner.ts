import { API } from '@tradejs/core/api';
import { Items } from '@tradejs/types';

const API_PATH = '/api/scanner';

export const scan = async (provider = 'bybit'): Promise<Items> => {
  const data = await API.get<{ tickers?: Items }>(`${API_PATH}/${provider}`);

  return data.tickers ?? [];
};
