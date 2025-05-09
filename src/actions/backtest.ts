'use server';

import { OrderLogData } from '@types';
import { getCache } from '@utils/cache';

export const backtest = async (
  id: string,
  symbol: string,
): Promise<OrderLogData> => {
  const data = getCache('data', `_backtest_${symbol}_${id}`) as OrderLogData;

  return new Promise((resolve) => resolve(data));
};
