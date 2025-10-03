import { Signal } from '@types';

const API_PATH = '/api/signal';

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Signal API request failed');
  }

  return response.json();
};

export const getSignal = async (
  symbol: string,
  signalId: string | undefined,
): Promise<Signal | null> => {
  if (!signalId) {
    return null;
  }

  const response = await fetch(`${API_PATH}/${symbol}/${signalId}`, {
    method: 'GET',
    cache: 'no-store',
  });

  const data = await handleResponse<{ signal?: Signal }>(response);

  return data.signal ?? null;
};
