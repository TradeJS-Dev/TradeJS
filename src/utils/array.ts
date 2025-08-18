import _ from 'lodash';
import chalk from 'chalk';
import { KlineChartData, Interval } from '@types';

export const intervalToMs = (interval: Interval): number => {
  const minutes: Record<
    '1' | '3' | '5' | '15' | '30' | '60' | '120' | '240' | '360' | '720',
    number
  > = {
    '1': 1,
    '3': 3,
    '5': 5,
    '15': 15,
    '30': 30,
    '60': 60,
    '120': 120,
    '240': 240,
    '360': 360,
    '720': 720,
  };

  if (interval in minutes) {
    return minutes[interval as keyof typeof minutes] * 60 * 1000;
  }

  switch (interval) {
    case 'D':
      return 24 * 60 * 60 * 1000;
    case 'W':
      return 7 * 24 * 60 * 60 * 1000;
    case 'M':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown interval: ${interval}`);
  }
};

export const mergeData = (a1: KlineChartData, a2: KlineChartData) => {
  const res = {
    ..._.keyBy(a1, 'timestamp'),
    ..._.keyBy(a2, 'timestamp'),
  };

  return Object.values(res).sort((b1, b2) => b1.timestamp - b2.timestamp);
};

export const isWrongData = (
  interval: Interval,
  data: KlineChartData,
): boolean => {
  if (data.length < 2) return false;

  const step = intervalToMs(interval);

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1].timestamp;
    const curr = data[i].timestamp;

    if (curr - prev !== step) {
      chalk.red('wrong data');

      return true;
    }
  }

  return false;
};
