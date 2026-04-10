import { API } from '@tradejs/core/api';
import { Signal } from '@tradejs/types';

const API_PATH = '/api/signal';

export const getSignal = async (
  symbol: string,
  signalId: string | undefined,
): Promise<Signal | null> => {
  if (!signalId) {
    return null;
  }

  const data = await API.get<{ signal?: Signal }>(
    `${API_PATH}/${symbol}/${signalId}`,
  );

  return data.signal ?? null;
};
