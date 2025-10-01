'use server';

import { getData } from '@utils/data';
import { Signal } from '@types';

const DIR = 'data/signals';

export const getSignal = async (
  symbol: string,
  signalId: string | undefined,
): Promise<Signal | null> => {
  if (!signalId) {
    return null;
  }

  const signal: Signal = await getData(DIR, `${symbol}_${signalId}`);

  return signal;
};
