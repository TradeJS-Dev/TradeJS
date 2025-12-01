import { OHLCVKlineV5 } from 'bybit-api';
import { formatUnix } from '@utils/timestamp';
import { KlineChartItem } from '@types';

const parseKlineItem = (item: OHLCVKlineV5): KlineChartItem => ({
  dt: formatUnix(parseInt(item[0])),
  timestamp: parseInt(item[0]),
  open: parseFloat(item[1]),
  high: parseFloat(item[2]),
  low: parseFloat(item[3]),
  close: parseFloat(item[4]),
  volume: parseFloat(item[5]),
  turnover: parseFloat(item[6]),
});

export const mapKlineToChartData = (data: OHLCVKlineV5[]) =>
  data.map(parseKlineItem);
