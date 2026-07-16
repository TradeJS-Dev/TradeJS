jest.mock('@tradejs/infra/redis', () => ({
  delKey: jest.fn(),
  getData: jest.fn(),
  getKeys: jest.fn(),
  setData: jest.fn(),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
  },
}));

import {
  buildBacktestCommandArgs,
  normalizeBacktestJobRequest,
  parseBacktestProgressLine,
} from '../backtestJobs';

describe('backtest jobs helpers', () => {
  it('normalizes days requests and defaults operational fields', () => {
    expect(
      normalizeBacktestJobRequest({
        strategyName: 'TrendLine',
        configId: 'TrendLine:base',
        days: '45',
        ai: true,
      }),
    ).toEqual({
      strategyName: 'TrendLine',
      configId: 'TrendLine:base',
      periodMode: 'days',
      days: 45,
      ai: true,
      fast: false,
      interval: '15',
      connector: 'binance',
    });
  });

  it('builds TradeJS CLI args with range flags and resume skip', () => {
    const request = normalizeBacktestJobRequest({
      strategyName: 'TrendLine',
      configId: 'TrendLine:base',
      periodMode: 'range',
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
      interval: '60',
      connector: 'binance',
      ai: true,
      fast: true,
      tickers: 'BTCUSDT,ETHUSDT',
      testsLimit: 100,
      parallel: 2,
    });

    expect(
      buildBacktestCommandArgs({
        request,
        userName: 'alice',
        skip: 30,
      }),
    ).toEqual([
      'backtest',
      '--config',
      'TrendLine:base',
      '--user',
      'alice',
      '--timeframe',
      '60',
      '--connector',
      'binance',
      '--progressStep',
      '1',
      '--startTime',
      '1700000000000',
      '--endTime',
      '1700086400000',
      '--ai',
      '--fast',
      '--tickers',
      'BTCUSDT,ETHUSDT',
      '--parallel',
      '2',
      '--skip',
      '30',
      '--tests',
      '70',
    ]);
  });

  it('parses progress output as cumulative progress when resuming', () => {
    expect(
      parseBacktestProgressLine(
        '\u001b[32m20/70 [======]28% avg 12.34$ win 56.7% 10.0',
        30,
      ),
    ).toEqual({
      completed: 50,
      total: 100,
      averageProfit: 12.34,
      winRate: 56.7,
    });

    expect(parseBacktestProgressLine('tests: 70', 30)).toEqual({
      total: 100,
    });
  });
});
