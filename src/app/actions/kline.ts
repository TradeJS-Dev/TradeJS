import { handleResponse } from '@utils/api';
import { Kline, KlineChartData, KlineRequest } from '@types';

const API_PATH = '/api/kline';

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
