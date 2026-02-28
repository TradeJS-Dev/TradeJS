jest.mock('@utils/trendLine/engine', () => ({
  createTrendlineEngine: jest.fn(),
}));

jest.mock('@utils/strategyHelpers', () => {
  const buildEntrySignalDecision = jest.fn();
  const getStrategyMarketSnapshot = jest.fn();

  return {
    createStrategyAPI: jest.fn(() => ({
      skip: jest.fn((code) => ({ kind: 'skip', code })),
      entry: buildEntrySignalDecision,
      getMarketData: getStrategyMarketSnapshot,
      nextIndicators: jest.fn(),
      getCurrentPosition: jest.fn(),
      isCurrentPositionExists: jest.fn(),
      getDirectionalTpSlPrices,
      createLastTradeController: jest.fn(() => ({
        isInCooldown: jest.fn(() => false),
        markTrade: jest.fn(),
        getLastTradeTimestamp: jest.fn(() => null),
      })),
    })),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: jest.fn(() => false),
      markTrade: jest.fn(),
      getLastTradeTimestamp: jest.fn(() => null),
    })),
    getStrategyMarketSnapshot,
    getDirectionalTpSlPrices: jest.fn(),
    buildEntrySignalDecision,
  };
});

jest.mock('../filters', () => ({
  filterByVeryVolatility: jest.fn(() => true),
}));

import { createTrendlineEngine } from '@utils/trendLine/engine';
import {
  buildEntrySignalDecision,
  getStrategyMarketSnapshot,
  getDirectionalTpSlPrices,
} from '@utils/strategyHelpers';
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

const makeStrategyApi = () => {
  return {
    skip: (code: string) => ({ kind: 'skip', code }),
    entry: (params: any) =>
      buildEntrySignalDecision({
        ...params,
        code: params.code ?? 'TRENDLINE_SIGNAL',
      }),
    getMarketData: (params: any) => getStrategyMarketSnapshot(params),
    nextIndicators: jest.fn(),
    getCurrentPosition: jest.fn(),
    isCurrentPositionExists: jest.fn(async () => false),
    getDirectionalTpSlPrices: (params: any) => getDirectionalTpSlPrices(params),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: jest.fn(() => false),
      markTrade: jest.fn(),
      getLastTradeTimestamp: jest.fn(() => null),
    })),
  } as any;
};

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

    const indicatorsState = {
      setCurrentBar: jest.fn(),
      onBar: jest.fn(),
      next: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(),
      isInitialized: jest.fn(() => true),
    };

    const connector = {
      getPosition: jest.fn(),
    } as any;

    const strategyApi = makeStrategyApi();
    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector,
      data: [],
      btcData: [],
      strategyApi,
      indicatorsState: indicatorsState as any,
    });

    const candle = makeCandle(1_700_000_000_000, 100);
    const result = await core(candle as any, candle as any);

    expect(result).toEqual({ kind: 'skip', code: 'NO_TRENDLINE' });
    expect(strategyApi.isCurrentPositionExists).not.toHaveBeenCalled();
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

    const indicatorsState = {
      setCurrentBar: jest.fn(),
      onBar: jest.fn(),
      next: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(() => ({ maFast: [1], correlation: [0.1] })),
      latestNumber: jest.fn(() => 0.1),
      isInitialized: jest.fn(() => true),
    };

    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    (getDirectionalTpSlPrices as jest.Mock).mockReturnValue({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 3,
      qty: 2,
    });

    const fakeDecision = { kind: 'entry', code: 'TRENDLINE_SIGNAL' };
    (buildEntrySignalDecision as jest.Mock).mockReturnValue(fakeDecision);

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
      isConfigFromBacktest: true,
      connector,
      data: [candle as any],
      btcData: [btcCandle as any],
      strategyApi: makeStrategyApi(),
      indicatorsState: indicatorsState as any,
    });

    const result = await core(candle as any, btcCandle as any);

    expect(result).toBe(fakeDecision);
    expect(indicatorsState.onBar).toHaveBeenCalledWith();
    expect(buildEntrySignalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TRENDLINE_SIGNAL',
        direction: 'SHORT',
        timestamp: candle.timestamp,
        prices: expect.objectContaining({
          currentPrice: candle.close,
        }),
        figures: expect.objectContaining({
          lines: expect.any(Array),
          points: expect.any(Array),
        }),
        orderPlan: expect.objectContaining({ qty: 2 }),
      }),
    );
  });
});
