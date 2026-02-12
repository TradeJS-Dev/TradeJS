import { API } from '@utils/api';
import { KlineChartData, KlineRequest, Provider } from '@types';

const API_PATH = '/api/kline';

export const kline = async ({
  provider = 'bybit',
  symbol,
  interval,
  ...options
}: KlineRequest & { provider?: Provider }) => {
  const data = await API.post<{ data?: KlineChartData }>(
    `${API_PATH}/${provider}/${symbol}/${interval}`,
    options,
  );

  return data.data ?? [];
};
