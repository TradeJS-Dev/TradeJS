import _ from 'lodash';
import { KlineChartData } from '@types';

export const mergeData = (a1: KlineChartData, a2: KlineChartData) => {
  const res = {
    ..._.keyBy(a1, 'timestamp'),
    ..._.keyBy(a2, 'timestamp'),
  };

  return Object.values(res).sort((b1, b2) => b1.timestamp - b2.timestamp);
};
