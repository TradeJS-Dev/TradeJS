import {
  compactOrderLog,
  getBacktestPreloadStart,
  getDataTimestamp,
  getItemTimestamp,
  getTimeline,
  getTimestamp,
  toMs,
} from '../timestamp';
import { KlineChartData, KlineChartItem, OrderLogData } from '@tradejs/types';

const createCandle = (timestamp: number): KlineChartItem => ({
  timestamp,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
  turnover: 1,
  dt: new Date(timestamp).toISOString(),
});

describe('timestamp utils', () => {
  describe('toMs', () => {
    it('converts unix seconds to milliseconds and keeps ms as is', () => {
      expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
      expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    });
  });

  describe('getTimestamp', () => {
    it('returns current timestamp in milliseconds', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-07T10:20:30.000Z'));

      expect(getTimestamp()).toBe(Date.parse('2026-02-07T10:20:30.000Z'));

      jest.useRealTimers();
    });

    it('returns timestamp shifted by provided number of days', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-07T10:20:30.000Z'));

      expect(getTimestamp(2)).toBe(Date.parse('2026-02-05T10:20:30.000Z'));

      jest.useRealTimers();
    });
  });

  describe('getItemTimestamp and getDataTimestamp', () => {
    it('reads timestamp from item and last item in data', () => {
      const first = createCandle(1_000);
      const data: KlineChartData = [
        first,
        createCandle(2_000),
        createCandle(3_000),
      ];

      expect(getItemTimestamp(first)).toBe(1_000);
      expect(getDataTimestamp(data)).toBe(3_000);
    });

    it('returns null for empty data list', () => {
      expect(getDataTimestamp([])).toBeNull();
    });
  });

  describe('getTimeline', () => {
    it('creates inclusive timeline with custom step', () => {
      expect(getTimeline(0, 10, 5)).toEqual([0, 5, 10]);
    });
  });

  describe('getBacktestPreloadStart', () => {
    it('uses a warmup window before the test start', () => {
      const start = Date.parse('2026-04-01T00:00:00.000Z');

      expect(getBacktestPreloadStart(start, 30)).toBe(
        Date.parse('2026-03-02T00:00:00.000Z'),
      );
    });
  });

  describe('compactOrderLog', () => {
    it('maps timeline points to the latest known amount', () => {
      const timeline = [100, 200, 300, 400];
      const orderLog: OrderLogData = [
        { timestamp: 90, amount: 120 } as OrderLogData[number],
        { timestamp: 250, amount: 130 } as OrderLogData[number],
        { timestamp: 380, amount: 125 } as OrderLogData[number],
      ];

      expect(compactOrderLog(timeline, orderLog)).toEqual([
        [100, 120],
        [200, 120],
        [300, 130],
        [400, 125],
      ]);
    });

    it('starts from default amount when log is empty', () => {
      expect(compactOrderLog([100, 200], [])).toEqual([
        [100, 100],
        [200, 100],
      ]);
    });
  });
});
