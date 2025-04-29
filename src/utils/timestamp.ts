import { format } from 'date-fns';
import { KlineChartItem, KlineChartData } from '@types';

export const getItemTimestamp = (item: KlineChartItem) => item.timestamp;

export const getDataTimestamp = (data: KlineChartData) => {
  if (!data.length) {
    return null;
  }

  return getItemTimestamp(data[data.length - 1]);
};

export const formatUnix = (dt: number) => {
  return format(new Date(dt), 'd MMM u HH:mm:ss');
};
