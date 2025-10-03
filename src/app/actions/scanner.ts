import { Items } from '@types';

const API_PATH = '/api/scanner';

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Scanner API request failed');
  }

  return response.json();
};

export const scan = async (): Promise<Items> => {
  const response = await fetch(API_PATH, {
    method: 'GET',
  });

  const data = await handleResponse<{ tickers?: Items }>(response);

  return data.tickers ?? [];
};
