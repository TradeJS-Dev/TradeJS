import { OHLCVKlineV5 } from 'bybit-api';
import { formatUnix } from '@src/utils/timestamp';
import { KlineChartItem } from '@types';

const parseKlineItem = (item: OHLCVKlineV5): KlineChartItem => ({
  dt: formatUnix(Number.parseInt(item[0])),
  timestamp: Number.parseInt(item[0]),
  open: Number.parseFloat(item[1]),
  high: Number.parseFloat(item[2]),
  low: Number.parseFloat(item[3]),
  close: Number.parseFloat(item[4]),
  volume: Number.parseFloat(item[5]),
  turnover: Number.parseFloat(item[6]),
});

export const mapKlineToChartData = (data: OHLCVKlineV5[]) =>
  data.map(parseKlineItem);
