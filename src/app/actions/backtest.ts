import { API } from '@utils/api';
import { Item, OrderLogData, TestResult } from '@types';

const API_BASE = '/api/backtest';

export const getBacktestFiles = async (): Promise<Item[]> => {
  const data = await API.get<{ items?: Item[] }>(`${API_BASE}/files`);

  return data.items ?? [];
};

export const getOrderLog = async (
  name: string | undefined,
  strategyName: string | undefined,
): Promise<OrderLogData | null> => {
  if (!name || !strategyName) {
    return null;
  }

  const data = await API.get<{ orderLog?: OrderLogData }>(
    `${API_BASE}/order-log/${strategyName}/${name}`,
  );

  return data.orderLog ?? null;
};

export const getBacktest = async (
  name: string | undefined,
  strategyName: string | undefined,
): Promise<TestResult | null> => {
  if (!name || !strategyName) {
    return null;
  }

  const data = await API.get<{ result?: TestResult }>(
    `${API_BASE}/result/${strategyName}/${name}`,
  );

  return data.result ?? null;
};
