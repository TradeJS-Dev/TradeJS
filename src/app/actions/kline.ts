import { API } from '@utils/api';
import { Kline, KlineChartData, KlineRequest } from '@types';

const API_PATH = '/api/kline';

export const kline: Kline = async ({
  symbol,
  interval,
  ...options
}: KlineRequest) => {
  const data = await API.post<{ data?: KlineChartData }>(
    `${API_PATH}/${symbol}/${interval}`,
    options,
  );

  return data.data ?? [];
};
