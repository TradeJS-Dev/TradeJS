import { handleResponse } from '@utils/api';
import { Items } from '@types';

const API_PATH = '/api/scanner';

export const scan = async (): Promise<Items> => {
  const response = await fetch(API_PATH, {
    method: 'GET',
  });

  const data = await handleResponse<{ tickers?: Items }>(response);

  return data.tickers ?? [];
};
