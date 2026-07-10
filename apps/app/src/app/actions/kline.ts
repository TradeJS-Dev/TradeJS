import { API } from '@tradejs/core/api';
import {
  KlineChartData,
  KlineRequest,
  MarketUniverse,
  Provider,
} from '@tradejs/types';

const API_PATH = '/api/kline';

export const kline = async ({
  provider = 'bybit',
  universe = 'crypto',
  symbol,
  interval,
  ...options
}: KlineRequest & { provider?: Provider; universe?: MarketUniverse }) => {
  const data = await API.post<{ data?: KlineChartData }>(
    `${API_PATH}/${provider}/${universe}/${symbol}/${interval}`,
    options,
  );

  return data.data ?? [];
};
