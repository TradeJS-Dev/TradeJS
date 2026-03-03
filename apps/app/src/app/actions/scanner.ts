import { API } from '@utils/api';
import { Items } from '@types';

const API_PATH = '/api/scanner';

export const scan = async (provider = 'bybit'): Promise<Items> => {
  const data = await API.get<{ tickers?: Items }>(`${API_PATH}/${provider}`);

  return data.tickers ?? [];
};
