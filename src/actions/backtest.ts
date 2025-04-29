'use server';

import { OrderLogData } from '@types';
import { getCache } from '@src/utils/cache';

export const backtest = async (
  id: string,
  symbol: string,
): Promise<OrderLogData> => {
  const data = getCache('backtest', `${symbol}_${id}`) as OrderLogData;

  return new Promise((resolve) => resolve(data));
};
