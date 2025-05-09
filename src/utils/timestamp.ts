import { format } from 'date-fns';
import { getUnixTime, subDays } from 'date-fns';
import { KlineChartItem, KlineChartData } from '@types';

export const getTimestamp = (days: number = 0) => {
  if (days > 0) {
    return getUnixTime(subDays(new Date(), days)) * 1000;
  }

  return getUnixTime(new Date()) * 1000
}

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
