import type { OrderLogData, TestResult } from '@tradejs/types';
import { buildBacktestTradeOutcomePoints } from '#shared/Charts/TradeOutcomeMarkers';
import { getChartData } from '.';

it('plots every closing balance at the same time and value as its marker', () => {
  const testResult = {
    test: { symbol: 'BTCUSDT', testId: 'primary' },
    orderLog: [
      [100, 100],
      [200, 107],
    ],
  } as TestResult;
  const orders = [
    { type: 'OPEN_LONG', timestamp: 110, amount: 99, profit: -1 },
    { type: 'CLOSE_LONG', timestamp: 120, amount: 112, profit: 13 },
    { type: 'CLOSE_SHORT', timestamp: 120, amount: 107, profit: -5 },
  ] as OrderLogData;
  const comparison = {
    test: { symbol: 'ETHUSDT', testId: 'compared' },
    orderLog: [
      [90, 103],
      [150, 105],
    ],
  } as TestResult;

  const { data } = getChartData({
    testResult,
    orders,
    compareList: [{ testResult: comparison, color: 'purple' }],
    startTimestamp: 100,
    endTimestamp: 190,
  });

  for (const { timestamp, equity } of buildBacktestTradeOutcomePoints(orders)) {
    expect(data).toContainEqual({
      timestamp,
      'BTCUSDT-primary': equity,
      'ETHUSDT-compared': 103,
    });
  }
  expect(data.at(-1)).toEqual({
    timestamp: 190,
    'BTCUSDT-primary': 107,
    'ETHUSDT-compared': 105,
  });
});
