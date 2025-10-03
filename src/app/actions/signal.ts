import { handleResponse } from '@utils/api';
import { Signal } from '@types';

const API_PATH = '/api/signal';

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
