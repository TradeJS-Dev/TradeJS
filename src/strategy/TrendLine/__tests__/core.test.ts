jest.mock('@utils/trendLineEngine', () => ({
  createTrendlineEngine: jest.fn(),
}));

jest.mock('@utils/strategyHelpers', () => ({
  buildDefaultIndicatorPeriods: jest.fn(() => ({})),
  createStrategyIndicatorsState: jest.fn(),
  getStrategyMarketSnapshot: jest.fn(),
  getDirectionalTpSlPrices: jest.fn(),
}));

jest.mock('../filters', () => ({
  filterByVeryVolatility: jest.fn(() => true),
}));

jest.mock('../coreHelpers', () => ({
  buildTrendlineSignal: jest.fn(),
  buildTrendlineEntryDecision: jest.fn(),
  buildTrendlineEntrySignalDecision: jest.fn(),
}));

import { createTrendlineEngine } from '@utils/trendLineEngine';
import {
  createStrategyIndicatorsState,
  getStrategyMarketSnapshot,
  getDirectionalTpSlPrices,
} from '@utils/strategyHelpers';
import { buildTrendlineEntrySignalDecision } from '../coreHelpers';
import { createTrendLineCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';

const makeCandle = (timestamp: number, price: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: price * 0.99,
  close: price,
  high: price * 1.01,
  low: price * 0.98,
  volume: 100 + price,
  turnover: price * 1000,
});

const makeConfig = (overrides: Record<string, any> = {}) => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

describe('createTrendLineCore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns skip when no trendline is found', async () => {
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => []) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });

    (createStrategyIndicatorsState as jest.Mock).mockReturnValue({
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
    });

    const connector = {
      getPosition: jest.fn(),
    } as any;

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      configFromBacktest: false,
      connector,
      data: [],
      btcData: [],
    });

    const candle = makeCandle(1_700_000_000_000, 100);
    const result = await core(candle as any, candle as any);

    expect(result).toEqual({ kind: 'skip', code: 'NO_TRENDLINE' });
    expect(connector.getPosition).not.toHaveBeenCalled();
  });

  it('returns entry decision for valid trendline setup', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const btcCandle = makeCandle(1_700_000_000_000, 20000);
    const bestLine = {
      id: 'line-1',
      mode: 'lows',
      distance: 1.5,
      touches: [{ timestamp: candle.timestamp - 1, value: 99 }],
      points: [{ timestamp: candle.timestamp - 1, value: 99 }],
    };

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [bestLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });

    const indicatorState = {
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(() => ({
        result: () => ({ maFast: [1], correlation: [0.1] }),
      })),
    };
    (createStrategyIndicatorsState as jest.Mock).mockReturnValue(indicatorState);

    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      currentPrice: candle.close,
    });

    (getDirectionalTpSlPrices as jest.Mock).mockReturnValue({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 3,
      qty: 2,
    });

    const fakeDecision = { kind: 'entry', code: 'TRENDLINE_SIGNAL' };
    (buildTrendlineEntrySignalDecision as jest.Mock).mockReturnValue(fakeDecision);

    const connector = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(),
    } as any;

    const config = makeConfig({
      ENV: 'BACKTEST',
      LOWS: {
        enable: true,
        direction: 'SHORT',
        TP: 4,
        SL: 1,
        minRiskRatio: 2,
      },
    });

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config,
      configFromBacktest: true,
      connector,
      data: [candle as any],
      btcData: [btcCandle as any],
    });

    const result = await core(candle as any, btcCandle as any);

    expect(result).toBe(fakeDecision);
    expect(indicatorState.onBar).toHaveBeenCalledWith(candle, btcCandle);
    expect(buildTrendlineEntrySignalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'TESTUSDT',
        bestLine,
        prices: expect.objectContaining({
          currentPrice: candle.close,
        }),
        configFromBacktest: true,
        qty: 2,
        config,
      }),
    );
  });
});
