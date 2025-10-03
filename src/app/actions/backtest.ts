import { Item, OrderLogData, TestResult } from '@types';

const API_BASE = '/api/backtest';

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Backtest API request failed');
  }

  return response.json();
};

export const getBacktestFiles = async (): Promise<Item[]> => {
  const response = await fetch(`${API_BASE}/files`, {
    method: 'GET',
    cache: 'no-store',
  });

  const data = await handleResponse<{ items?: Item[] }>(response);

  return data.items ?? [];
};

export const getOrderLog = async (
  name: string | undefined,
): Promise<OrderLogData | null> => {
  if (!name) {
    return null;
  }

  const response = await fetch(`${API_BASE}/order-log/${name}`, {
    method: 'GET',
  });

  const data = await handleResponse<{ orderLog?: OrderLogData }>(response);

  return data.orderLog ?? null;
};

export const getBacktest = async (
  name: string | undefined,
): Promise<TestResult | null> => {
  if (!name) {
    return null;
  }

  const response = await fetch(`${API_BASE}/result/${name}`, {
    method: 'GET',
  });

  const data = await handleResponse<{ result?: TestResult }>(response);

  return data.result ?? null;
};
