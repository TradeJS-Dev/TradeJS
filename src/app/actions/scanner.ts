import { API } from '@utils/api';
import { Items } from '@types';

const API_PATH = '/api/scanner';

export const scan = async (): Promise<Items> => {
  const data = await API.get<{ tickers?: Items }>(API_PATH);

  return data.tickers ?? [];
};
