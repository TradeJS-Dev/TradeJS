import { Kline, KlineChartData, KlineRequest } from '@types';

const API_PATH = '/api/kline';

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Kline API request failed');
  }

  return response.json();
};

export const kline: Kline = async ({
  symbol,
  interval,
  ...options
}: KlineRequest) => {
  const response = await fetch(`${API_PATH}/${symbol}/${interval}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  const data = await handleResponse<{ data?: KlineChartData }>(response);

  return data.data ?? [];
};
