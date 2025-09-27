import { format } from 'date-fns';
import { getUnixTime, subDays } from 'date-fns';
import { BACKTEST_PRELOAD_DAYS } from '@constants';
import {
  KlineChartItem,
  KlineChartData,
  OrderLogData,
  SimpleOrderLogData,
} from '@types';

const TIMELINE_STEP = 86_400_000;

export const getTimestamp = (days: number = 0) => {
  if (days > 0) {
    return getUnixTime(subDays(new Date(), days)) * 1000;
  }

  return getUnixTime(new Date()) * 1000;
};

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

export const getTimeline = (
  start = getTimestamp(BACKTEST_PRELOAD_DAYS),
  end = getTimestamp(),
  step = TIMELINE_STEP,
) => {
  const res = new Array<number>();

  for (let ind = start; ind <= end; ind += step) {
    res.push(ind);
  }

  return res;
};

export const compactOrderLog = (
  timeline: number[],
  orderLog: OrderLogData,
): SimpleOrderLogData => {
  let prevValue = orderLog[0].amount || 100;

  return timeline.map((timestamp, ind) => {
    if (ind < 1) {
      return [timestamp, prevValue];
    }

    const order = orderLog.findLast(
      (log) =>
        log.timestamp <= timeline[ind] && log.timestamp > timeline[ind - 1],
    );

    if (!order) {
      return [timestamp, prevValue];
    }

    prevValue = order.amount;

    return [timestamp, prevValue];
  });
};
